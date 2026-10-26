'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { PromptTemplate } from '../../generation/prompt_template'
import type { LessonType } from '../../lesson/schema'
import { Breadcrumbs } from '../breadcrumbs'
import { errorText, sendJson } from '../dashboard/api'
import { formatDayTime, lessonNumbersText } from '../dashboard/format'
import { Modal } from '../dashboard/modal'
import { EyeIcon } from '../icons'

export interface PromptVersionView {
  id: string
  version: number
  template: PromptTemplate
  savedBy: string | null
  savedAt: string
  /** Numbered lessons whose current content this version generated. */
  lessonNumbers: number[]
  /** Every lesson (flex days included) whose current content this version generated. */
  lessonCount: number
}

interface PromptEditorProps {
  unit: { id: string; unitNumber: number; heading: string }
  currentVersion: number
  viewingVersion: number
  /** Newest first. */
  versions: PromptVersionView[]
  now: string
}

const TYPE_TABS: { type: LessonType; label: string }[] = [
  { type: 'spark', label: 'Spark' },
  { type: 'core_reading', label: 'Core Reading' },
  { type: 'core_writing', label: 'Core Writing' },
  { type: 'academic_discussion', label: 'Academic Discussion' },
  { type: 'writing', label: 'Writing' },
  { type: 'flex', label: 'Flex day' },
]

const AUTOMATIC = [
  "The lesson's outline row: type, description, texts, homework, vocabulary",
  'Full text of every focus and supporting standard',
  "ELD standards from the outline, and the ELD file's fields when they aren't empty",
  "The arc's description",
  'The previous and next lesson descriptions',
]

interface Draft {
  system: string
  styleGuide: string
  typeGuidance: Partial<Record<LessonType, string>>
}

function draftOf(template: PromptTemplate): Draft {
  return {
    system: template.system,
    styleGuide: template.styleGuide,
    typeGuidance: { ...template.typeGuidance },
  }
}

/** Editors may add a trailing line break; it doesn't count as a change. */
function same(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').trimEnd() === (b ?? '').trimEnd()
}

/**
 * A plain-text editable area (role textbox, multi-line). It is uncontrolled: the text it starts
 * with is set by remounting it (the editor is keyed by version), and edits are reported on input.
 */
function PromptText({
  initial,
  readOnly,
  edited,
  onChange,
  labelledBy,
  label,
}: {
  initial: string
  readOnly: boolean
  edited: boolean
  onChange: (value: string) => void
  labelledBy?: string
  label?: string
}) {
  return (
    <div
      className={`ptext${readOnly ? ' ro' : ''}${edited ? ' edited' : ''}`}
      role="textbox"
      aria-multiline="true"
      aria-labelledby={labelledBy}
      aria-label={label}
      aria-readonly={readOnly || undefined}
      contentEditable={readOnly ? false : 'plaintext-only'}
      suppressContentEditableWarning
      spellCheck
      tabIndex={readOnly ? 0 : undefined}
      // innerText keeps the line breaks the browser shows; textContent covers DOMs without it.
      onInput={(event) =>
        onChange(event.currentTarget.innerText ?? event.currentTarget.textContent ?? '')
      }
    >
      {initial}
    </div>
  )
}

function usedBy(count: number): string {
  return `Used by ${count === 1 ? '1 lesson' : `${count} lessons`}.`
}

function VersionEditor({
  unit,
  currentVersion,
  viewingVersion,
  versions,
  now,
  onDiscard,
}: PromptEditorProps & { onDiscard: () => void }) {
  const id = useId()
  const router = useRouter()
  const nowDate = useMemo(() => new Date(now), [now])
  const viewing = versions.find((item) => item.version === viewingVersion) ?? versions[0]!
  const current = versions.find((item) => item.version === currentVersion) ?? versions[0]!
  const readOnly = viewing.version !== currentVersion
  const base = viewing.template
  const [draft, setDraft] = useState<Draft>(() => draftOf(base))
  const [tab, setTab] = useState<LessonType>('core_reading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Where an in-app link was going when the leave prompt opened. */
  const [leavingTo, setLeavingTo] = useState<string | null>(null)
  const tabRefs = useRef(new Map<LessonType, HTMLButtonElement>())

  const editedTabs = TYPE_TABS.filter(
    ({ type }) => !same(draft.typeGuidance[type], base.typeGuidance[type]),
  ).map(({ type }) => type)
  const dirty =
    !readOnly &&
    (!same(draft.system, base.system) ||
      !same(draft.styleGuide, base.styleGuide) ||
      editedTabs.length > 0)
  const nextVersion = currentVersion + 1

  useEffect(() => {
    if (!dirty) {
      return
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // R10: leaving by an in-app link with unsaved edits asks Save, Discard or Stay first.
  useEffect(() => {
    if (!dirty) {
      return
    }
    function onClick(event: globalThis.MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) {
        return
      }
      const link = (event.target as Element | null)?.closest?.('a[href]')
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank') {
        return
      }
      const url = new URL(link.href, window.location.href)
      const here = new URL(window.location.href)
      if (url.origin !== here.origin || url.href.split('#')[0] === here.href.split('#')[0]) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setLeavingTo(`${url.pathname}${url.search}`)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [dirty])

  /** Saves the draft as the next version; true when it was saved. */
  async function save(): Promise<boolean> {
    setSaving(true)
    setError(null)
    const typeGuidance: Partial<Record<LessonType, string>> = {}
    Object.entries({ ...base.typeGuidance, ...draft.typeGuidance }).forEach(([type, text]) => {
      const key = type as LessonType
      const value = same(text, base.typeGuidance[key]) ? base.typeGuidance[key] : text?.trimEnd()
      if (value) {
        typeGuidance[key] = value
      }
    })
    const template: PromptTemplate = {
      system: same(draft.system, base.system) ? base.system : draft.system.trimEnd(),
      styleGuide: same(draft.styleGuide, base.styleGuide)
        ? base.styleGuide
        : draft.styleGuide.trimEnd(),
      typeGuidance,
    }
    const result = await sendJson(`/api/units/${unit.id}/prompt-versions`, 'POST', { template })
    setSaving(false)
    if (!result.ok) {
      setError(errorText(result))
      return false
    }
    router.refresh()
    return true
  }

  async function leave(action: 'save' | 'discard') {
    const href = leavingTo
    if (!href) {
      return
    }
    if (action === 'save' && !(await save())) {
      setLeavingTo(null)
      return
    }
    setLeavingTo(null)
    if (action === 'discard') {
      onDiscard()
    }
    router.push(href)
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = TYPE_TABS.findIndex((item) => item.type === tab)
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) {
      return
    }
    event.preventDefault()
    const next = TYPE_TABS[(index + step + TYPE_TABS.length) % TYPE_TABS.length]!
    setTab(next.type)
    tabRefs.current.get(next.type)?.focus()
  }

  const promptHref = `/units/${unit.id}/prompt`

  return (
    <main className="page prompt-page">
      <Breadcrumbs
        trail={[
          { label: 'Units', href: '/units' },
          { label: `Unit ${unit.unitNumber}`, href: `/units/${unit.id}` },
          { label: 'Prompt' },
        ]}
      />
      <div className="phead">
        <div>
          <h1 className="h1">Prompt for {unit.heading}</h1>
          <p className="sub">Used for every lesson generated or regenerated in this unit.</p>
        </div>
        <span className="spacer" />
        {readOnly ? (
          <Link className="btn" href={promptHref}>
            Back to current version
          </Link>
        ) : (
          <>
            {dirty ? (
              <span className="caption">
                Saving creates v{nextVersion}. Lessons already generated keep the version they used.
              </span>
            ) : null}
            {dirty ? (
              <button type="button" className="btn" onClick={onDiscard}>
                Discard changes
              </button>
            ) : null}
            <button
              type="button"
              className="btn primary"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              Save as v{nextVersion}
            </button>
          </>
        )}
      </div>
      {error ? (
        <p className="notice err" role="alert">
          {error}
        </p>
      ) : null}
      {readOnly ? (
        <div className="notice info pbanner">
          <EyeIcon />
          <div>
            <b>You&apos;re viewing v{viewing.version}. It&apos;s read-only.</b>{' '}
            {viewing.lessonNumbers.length === 0
              ? 'No lessons were generated with it.'
              : `${lessonNumbersText(viewing.lessonNumbers)} ${viewing.lessonNumbers.length === 1 ? 'was' : 'were'} generated with it. Regenerating ${viewing.lessonNumbers.length === 1 ? 'it' : 'them'} uses the current version, v${currentVersion}.`}
          </div>
        </div>
      ) : null}

      <div className="pgrid">
        <nav className="panel vers" aria-label="Prompt versions">
          <h2>Versions</h2>
          {dirty ? (
            <a
              className="ver on"
              href="#draft"
              aria-current="true"
              onClick={(e) => e.preventDefault()}
            >
              <span className="vt">
                Draft<span className="tag d">Unsaved changes</span>
              </span>
              <span className="caption">Only you see this until you save.</span>
            </a>
          ) : null}
          {versions.map((item) => {
            const isViewing = !dirty && item.version === viewing.version
            return (
              <Link
                key={item.id}
                className={`ver${isViewing ? ' on' : ''}`}
                href={
                  item.version === currentVersion
                    ? promptHref
                    : `${promptHref}?version=${item.version}`
                }
                aria-current={isViewing ? 'true' : undefined}
              >
                <span className="vt">
                  v{item.version}
                  {item.version === current.version ? <span className="tag">Current</span> : null}
                </span>
                <span className="caption" suppressHydrationWarning>
                  {item.savedBy ?? 'Default template'},{' '}
                  {formatDayTime(new Date(item.savedAt), nowDate)}. {usedBy(item.lessonCount)}
                </span>
              </Link>
            )
          })}
        </nav>

        <div className="panel pmain">
          <section className="psec">
            <h2 id={`${id}-system`}>System instructions</h2>
            <p className="help">The model&apos;s role and the rules every lesson must follow.</p>
            <PromptText
              initial={base.system}
              readOnly={readOnly}
              edited={!same(draft.system, base.system)}
              labelledBy={`${id}-system`}
              onChange={(system) => setDraft((value) => ({ ...value, system }))}
            />
          </section>
          <section className="psec">
            <h2 id={`${id}-style`}>Style guide</h2>
            <p className="help">Voice, block conventions and how much to write per section.</p>
            <PromptText
              initial={base.styleGuide}
              readOnly={readOnly}
              edited={!same(draft.styleGuide, base.styleGuide)}
              labelledBy={`${id}-style`}
              onChange={(styleGuide) => setDraft((value) => ({ ...value, styleGuide }))}
            />
          </section>
          <section className="psec">
            <h2 id={`${id}-types`}>Lesson-type guidance</h2>
            <p className="help">Added to the prompt for lessons of that type in the outline.</p>
            <div
              className="ptabs"
              role="tablist"
              aria-labelledby={`${id}-types`}
              onKeyDown={onTabKeyDown}
            >
              {TYPE_TABS.map((item) => (
                <button
                  key={item.type}
                  ref={(node) => {
                    if (node) {
                      tabRefs.current.set(item.type, node)
                    }
                  }}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${item.type}`}
                  aria-selected={tab === item.type}
                  aria-controls={`${id}-panel`}
                  tabIndex={tab === item.type ? 0 : -1}
                  onClick={() => setTab(item.type)}
                >
                  {item.label}
                  {editedTabs.includes(item.type) ? (
                    <span className="e" aria-hidden="true" />
                  ) : null}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`}>
              {TYPE_TABS.map((item) => (
                <div key={item.type} hidden={tab !== item.type}>
                  <PromptText
                    initial={base.typeGuidance[item.type] ?? ''}
                    readOnly={readOnly}
                    edited={editedTabs.includes(item.type)}
                    label={`${item.label} guidance`}
                    onChange={(text) =>
                      setDraft((value) => ({
                        ...value,
                        typeGuidance: { ...value.typeGuidance, [item.type]: text },
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="panel pauto" aria-labelledby={`${id}-auto`}>
          <h2 id={`${id}-auto`}>Added to every lesson automatically</h2>
          <p className="caption">
            These come from the outline and the standards data. You don&apos;t need to repeat them.
          </p>
          <ul>
            {AUTOMATIC.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </aside>
      </div>
      {leavingTo ? (
        <LeaveDialog
          nextVersion={nextVersion}
          saving={saving}
          onSave={() => void leave('save')}
          onDiscard={() => void leave('discard')}
          onStay={() => setLeavingTo(null)}
        />
      ) : null}
    </main>
  )
}

/** Save, Discard or Stay when leaving with unsaved prompt edits; Stay is the safe choice. */
function LeaveDialog({
  nextVersion,
  saving,
  onSave,
  onDiscard,
  onStay,
}: {
  nextVersion: number
  saving: boolean
  onSave: () => void
  onDiscard: () => void
  onStay: () => void
}) {
  const id = useId()
  const stayRef = useRef<HTMLButtonElement>(null)
  return (
    <Modal
      role="alertdialog"
      labelledBy={`${id}-title`}
      describedBy={`${id}-text`}
      initialFocus={stayRef}
      onClose={onStay}
    >
      <header>
        <h2 className="h3" id={`${id}-title`}>
          Save your changes to the prompt?
        </h2>
      </header>
      <div className="body">
        <p id={`${id}-text`}>
          You edited the prompt but haven&apos;t saved it. Saving creates v{nextVersion}; discarding
          throws the edits away.
        </p>
      </div>
      <footer>
        <button ref={stayRef} type="button" className="btn" onClick={onStay}>
          Stay
        </button>
        <button type="button" className="btn" onClick={onDiscard}>
          Discard changes
        </button>
        <button type="button" className="btn primary" disabled={saving} onClick={onSave}>
          Save as v{nextVersion}
        </button>
      </footer>
    </Modal>
  )
}

/** R10 prompt editor: version list, the editable template, and what is added automatically. */
export function PromptEditor(props: PromptEditorProps) {
  const [resets, setResets] = useState(0)
  const viewing = props.versions.find((item) => item.version === props.viewingVersion)
  // A new version, another version or Discard starts the editor again from that version's text.
  return (
    <VersionEditor
      key={`${viewing?.id}:${resets}`}
      {...props}
      onDiscard={() => setResets((count) => count + 1)}
    />
  )
}
