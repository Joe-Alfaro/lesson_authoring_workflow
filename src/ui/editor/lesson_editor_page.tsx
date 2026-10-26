'use client'
// The lesson editor page (R14, R15, R17, R18, R23 lock; mockups R17-lesson-editor,
// R15-standard-picker, R14-version-history, R14-restore-confirm, R23-approved-locked).
// AI assist (R20-R22) plugs in later through `assistSlot` in the lesson bar and new side panel tabs.
import type { Editor, JSONContent } from '@tiptap/core'
import { TextSelection, type Command } from '@tiptap/pm/state'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Role } from '../../auth/roles'
import type { LessonStatus } from '../../db/schema'
import {
  addBlock,
  addPart,
  addPartStandard,
  childrenAt,
  findById,
  removeBlock,
  removeListItemAt,
  removePart,
  removePartStandard,
  setPartMinutes,
  type Located,
} from '../../editor/commands'
import { docToLesson, lessonToDoc, parseData } from '../../editor/convert'
import { describeBlockingField, type BlockingField } from '../../editor/snapshot_errors'
import { PART_NODE, SECTION_NODE, STANDARD_GROUP_NODE } from '../../editor/schema'
import {
  addStandard,
  removeStandard,
  type StandardGroup,
  type StandardRef,
} from '../../editor/standards'
import {
  lessonLabel,
  partName,
  SECTION_NAMES,
  sectionAnchor,
  type SectionKind,
} from '../../lesson/labels'
import type { LessonContent } from '../../lesson/schema'
import { availableActions, isEditableStatus, type WorkflowAction } from '../../workflow/transitions'
import { Icon } from '../lesson/lesson_icons'
import { setStandardReference } from '../lesson/standard_tooltip'
import { StatusPill } from '../lesson/status_pill'
import { avatarColour, initials } from '../people'
import { useLessonCollab, type SaveState } from './collab'
import { formatShort, formatWhen } from './format_time'
import { LiveDocument, PreviewDocument } from './lesson_documents'
import type { EditorViewContext } from './node_views'
import { RestoreDialog } from './restore_dialog'
import { SidePanel, type HistoryItem, type PanelTab, type VersionItem } from './side_panel'
import { StandardPicker, type PickerTarget } from './standard_picker'

export interface EditorLesson {
  id: string
  unitId: string
  unitNumber: number
  number: number | null
  status: LessonStatus
  content: LessonContent
  assignee: { id: string; name: string } | null
  provenance: string | null
  approval: { name: string; at: string } | null
}

export interface EditorUser {
  id: string
  name: string
  role: Role
}

const ACTION_LABELS: Partial<Record<WorkflowAction, string>> = {
  submit: 'Submit for review',
  resubmit: 'Resubmit for review',
  approve: 'Approve lesson',
  reopen: 'Reopen for edits',
}

/** Actions that save a version of the latest edits first (D-024), so the editor flushes. */
const FLUSH_FIRST: WorkflowAction[] = ['submit', 'resubmit', 'approve']

/** Pause after an edit before re-checking whether the lesson can be saved. */
const BLOCKING_CHECK_MS = 300

const SAVE_LABELS: Record<SaveState, string> = {
  connecting: 'Connecting…',
  saving: 'Saving…',
  saved: 'All changes saved',
  offline: 'Offline, reconnecting…',
}

interface OutlineSection {
  id: string
  kind: SectionKind
  minutes: number
  parts: { id: string; name: string }[]
}

function outlineOf(editor: Editor | null, content: LessonContent): OutlineSection[] {
  if (!editor) {
    return content.body.sections.map((section) => ({
      id: section.id ?? section.kind,
      kind: section.kind,
      minutes: section.minutes,
      parts: section.parts
        .filter(() => section.kind === 'learning_in_action')
        .map((part, index) => ({
          id: part.id ?? String(index),
          name: partName(part.label, undefined) || `Part ${index + 1}`,
        })),
    }))
  }
  const sections: OutlineSection[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name !== SECTION_NODE) return true
    const data = parseData(node.toJSON())
    const kind = data.kind as SectionKind
    const parts: OutlineSection['parts'] = []
    node.forEach((child) => {
      if (child.type.name !== PART_NODE || kind !== 'learning_in_action') return
      let name = ''
      child.forEach((field) => {
        if (field.attrs.key === 'label') name = partName(field.textContent, undefined)
      })
      parts.push({ id: String(child.attrs.id), name: name || `Part ${parts.length + 1}` })
    })
    sections.push({ id: String(node.attrs.id), kind, minutes: Number(data.minutes ?? 0), parts })
    return false
  })
  return sections
}

function Rail({ outline, homework }: { outline: OutlineSection[]; homework: boolean }) {
  const total = outline.reduce((sum, section) => sum + section.minutes, 0)
  const [current, setCurrent] = useState<string>(outline[0] ? sectionAnchor(outline[0].kind) : '')
  useEffect(() => {
    function onScroll() {
      const anchors = [...outline.map((section) => sectionAnchor(section.kind)), 'sec-homework']
      const passed = anchors.filter((anchor) => {
        const element = document.getElementById(anchor)
        return element && element.getBoundingClientRect().top < 160
      })
      setCurrent(passed[passed.length - 1] ?? anchors[0] ?? '')
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [outline])

  return (
    <nav className="rail" aria-label="Lesson outline">
      <h4>Front matter</h4>
      <a href="#front-matter">Standards and texts</a>
      <a href="#objectives">Objectives</a>
      <a href="#pacing">Pacing</a>
      <h4 className="rail-seq">Lesson sequence</h4>
      {outline.map((section) => (
        <div key={section.id}>
          <a
            href={`#${sectionAnchor(section.kind)}`}
            className={current === sectionAnchor(section.kind) ? 'on' : ''}
            aria-current={current === sectionAnchor(section.kind) ? 'location' : undefined}
          >
            <span className={`bar bar-${sectionAnchor(section.kind)}`} />
            {SECTION_NAMES[section.kind]}
            <span className="min">{section.minutes} min</span>
          </a>
          {section.parts.map((part) => (
            <a key={part.id} href={`#part-${part.id}`} className="child">
              {part.name}
            </a>
          ))}
        </div>
      ))}
      {homework ? (
        <a href="#sec-homework" className={current === 'sec-homework' ? 'on' : ''}>
          <span className="bar bar-sec-homework" />
          Homework
          <span className="min" />
        </a>
      ) : null}
      <div className="rail-pacing">
        <div
          className="ribbon"
          role="img"
          aria-label={`Pacing: ${outline.map((s) => `${SECTION_NAMES[s.kind]} ${s.minutes}`).join(', ')} minutes`}
        >
          {outline.map((section) => (
            <i
              key={section.id}
              className={sectionAnchor(section.kind).replace('sec-', '')}
              style={{ flex: section.minutes }}
            />
          ))}
        </div>
        <div className="caption">
          {total} of {total} minutes
        </div>
      </div>
    </nav>
  )
}

function Presence({ names }: { names: { id: string; name: string }[] }) {
  if (names.length === 0) return null
  return (
    <div
      className="avs"
      role="group"
      aria-label={`Also editing: ${names.map((person) => person.name).join(', ')}`}
    >
      {names.map((person) => (
        <span
          key={person.id}
          className={`av ${avatarColour(person.id)}`}
          title={person.name}
          aria-hidden="true"
        >
          {initials(person.name)}
        </span>
      ))}
    </div>
  )
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Request failed (${response.status})`)
  }
  return (await response.json()) as T
}

export function LessonEditorPage({
  lesson,
  user,
  collabUrl,
  standards,
  assistSlot,
}: {
  lesson: EditorLesson
  user: EditorUser
  collabUrl: string
  standards: StandardRef[]
  /** Extension point for the AI assist toolbar (R20-R22, next milestone). */
  assistSlot?: ReactNode
}) {
  const router = useRouter()
  const label = lessonLabel(lesson.number)
  const editable = isEditableStatus(lesson.status)
  const collabUser = useMemo(() => ({ id: user.id, name: user.name }), [user.id, user.name])
  const collab = useLessonCollab(lesson.id, collabUrl, collabUser)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [outline, setOutline] = useState(() => outlineOf(null, lesson.content))
  const [panel, setPanel] = useState<PanelTab | null>(null)
  const [versions, setVersions] = useState<VersionItem[] | null>(null)
  const [history, setHistory] = useState<HistoryItem[] | null>(null)
  const [preview, setPreview] = useState<{ version: VersionItem; doc: JSONContent } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [blocking, setBlocking] = useState<BlockingField | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => setStandardReference(standards), [standards])

  // Node views and the picker run commands on whatever editor is current.
  const editorRef = useRef<Editor | null>(null)
  const onEditor = useCallback((next: Editor | null) => {
    editorRef.current = next
    setEditor(next)
  }, [])
  const run = useCallback((command: Command) => {
    const current = editorRef.current
    return current ? command(current.state, current.view.dispatch) : false
  }, [])
  const focusAfter = useCallback((applied: boolean) => {
    const current = editorRef.current
    if (applied && current) {
      current.view.focus()
      current.commands.scrollIntoView()
    }
    return applied
  }, [])

  const ctx = useMemo<EditorViewContext>(
    () => ({
      editable,
      unitNumber: lesson.unitNumber,
      lessonLabel: label,
      addStandard(group: StandardGroup, anchor: HTMLElement) {
        const chosen: string[] = []
        editorRef.current?.state.doc.descendants((node, pos) => {
          if (node.type.name === STANDARD_GROUP_NODE && node.attrs.key === group) {
            const located: Located = { pos, node }
            childrenAt(located).forEach((chip) => chosen.push(String(chip.node.attrs.code)))
            return false
          }
          return true
        })
        setPicker({ group, anchor, chosen })
      },
      removeStandard: (group, code) => run(removeStandard(group, code)),
      removePart: (partId) => run(removePart(partId)),
      // The caret moves into the new block or part (the commands select it), so typing goes there.
      addPart: (sectionId) => focusAfter(run(addPart(sectionId))),
      addBlock: (after, type) => focusAfter(run(addBlock(after, type))),
      removeBlock: (blockId) => run(removeBlock(blockId)),
      addPartStandard(partId: string, _name: string, anchor: HTMLElement) {
        const part = editorRef.current ? findById(editorRef.current.state.doc, partId) : null
        const chosen =
          (parseData(part?.node.toJSON() ?? {}).standards as string[] | undefined) ?? []
        setPicker({ group: 'part', partId, anchor, chosen })
      },
      removePartStandard: (partId, code) => run(removePartStandard(partId, code)),
      setPartMinutes: (partId, minutes) => run(setPartMinutes(partId, minutes)),
      removeListItem: (pos) => focusAfter(run(removeListItemAt(pos))),
    }),
    [editable, focusAfter, label, lesson.unitNumber, run],
  )
  const previewCtx = useMemo<EditorViewContext>(() => ({ ...ctx, editable: false }), [ctx])

  useEffect(() => {
    if (!editor) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      // R17: an empty required field keeps the lesson from saving; say which one.
      const result = docToLesson(editor.getJSON())
      const next = result.ok ? null : describeBlockingField(editor.state.doc, result.errors)
      setBlocking((current) =>
        current?.label === next?.label && current?.pos === next?.pos ? current : next,
      )
    }
    const update = () => {
      const next = outlineOf(editor, lesson.content)
      setOutline((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
      clearTimeout(timer)
      timer = setTimeout(check, BLOCKING_CHECK_MS)
    }
    update()
    editor.on('update', update)
    return () => {
      clearTimeout(timer)
      editor.off('update', update)
    }
  }, [editor, lesson.content])

  function goToBlockingField() {
    const current = editorRef.current
    if (!current) return
    // Recomputed now: the last check can be up to BLOCKING_CHECK_MS behind the latest typing.
    const result = docToLesson(current.getJSON())
    const field = result.ok ? null : describeBlockingField(current.state.doc, result.errors)
    setBlocking(field)
    if (!field) return
    const pos = Math.min(field.pos, current.state.doc.content.size)
    const $pos = current.state.doc.resolve(pos)
    const selection = $pos.parent.isTextblock
      ? TextSelection.create(current.state.doc, pos)
      : TextSelection.near($pos)
    current.view.dispatch(current.state.tr.setSelection(selection).scrollIntoView())
    current.view.focus()
  }

  const loadVersions = useCallback(async () => {
    const body = await readJson<{ versions: VersionItem[] }>(
      await fetch(`/api/lessons/${lesson.id}/versions`, { cache: 'no-store' }),
    )
    setVersions(body.versions)
  }, [lesson.id])

  const loadHistory = useCallback(async () => {
    const body = await readJson<{ events: HistoryItem[] }>(
      await fetch(`/api/lessons/${lesson.id}/history`, { cache: 'no-store' }),
    )
    setHistory(body.events)
  }, [lesson.id])

  function showPanel(tab: PanelTab | null) {
    setPanel(tab)
    if (tab === 'versions') void loadVersions().catch(() => setVersions([]))
    if (tab === 'history') void loadHistory().catch(() => setHistory([]))
  }

  async function openVersion(version: VersionItem) {
    const body = await readJson<{ content: LessonContent }>(
      await fetch(`/api/lessons/${lesson.id}/versions/${version.id}`, { cache: 'no-store' }),
    )
    setPreview({ version, doc: lessonToDoc(body.content) })
    window.scrollTo({ top: 0 })
  }

  async function restore() {
    if (!preview) return
    setRestoreBusy(true)
    setRestoreError(null)
    try {
      // The route's own snapshot (D-024) then captures the latest edits.
      await collab.flush()
      await readJson(
        await fetch(`/api/lessons/${lesson.id}/versions/${preview.version.id}/restore`, {
          method: 'POST',
        }),
      )
      setConfirming(false)
      setPreview(null)
      await loadVersions()
    } catch (error) {
      setRestoreError((error as Error).message)
    } finally {
      setRestoreBusy(false)
    }
  }

  async function takeAction(action: WorkflowAction) {
    setActionBusy(true)
    setActionError(null)
    try {
      if (FLUSH_FIRST.includes(action)) await collab.flush()
      await readJson(
        await fetch(`/api/lessons/${lesson.id}/transitions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        }),
      )
      router.refresh()
    } catch (error) {
      setActionError((error as Error).message)
    } finally {
      setActionBusy(false)
    }
  }

  const actions = availableActions(lesson.status, user.role).filter(
    (action) => ACTION_LABELS[action],
  )
  const reviewerLocked = lesson.status === 'approved' && actions.length === 0
  const initialDoc = useMemo(() => lessonToDoc(lesson.content), [lesson.content])

  return (
    <div className="editor-page">
      <div className="lesson-bar">
        <Link className="btn quiet sm" href={`/units/${lesson.unitId}`}>
          Unit {lesson.unitNumber}
        </Link>
        <span className="muted" aria-hidden="true">
          /
        </span>
        <span className="t">{label}</span>
        <StatusPill status={lesson.status} />
        {lesson.assignee ? (
          <span className="row caption assigned">
            Assigned to
            <span className={`av sm ${avatarColour(lesson.assignee.id)}`} aria-hidden="true">
              {initials(lesson.assignee.name)}
            </span>
            <span className="sub">{lesson.assignee.name}</span>
          </span>
        ) : null}
        {lesson.provenance ? <span className="caption">{lesson.provenance}</span> : null}
        <span className="spacer" />
        {assistSlot}
        <Presence names={collab.others} />
        {editable && blocking ? (
          <button
            type="button"
            className="btn quiet sm save-blocked"
            aria-live="polite"
            onClick={goToBlockingField}
          >
            <Icon name="warning" />
            Not saved: {blocking.label}
          </button>
        ) : (
          <span className="caption row save-state" aria-live="polite">
            <Icon name={editable ? 'cloud' : 'lock'} />
            {editable ? SAVE_LABELS[collab.saveState] : 'Locked'}
          </span>
        )}
        <button
          type="button"
          className={`btn quiet sm${panel === 'versions' ? ' on' : ''}`}
          aria-label="Version history"
          aria-pressed={panel === 'versions'}
          onClick={() => showPanel(panel === 'versions' ? null : 'versions')}
        >
          <Icon name="history" />
        </button>
        <Link className="btn sm" href={`/lessons/${lesson.id}/view`}>
          <Icon name="eye" />
          Lesson view
        </Link>
        {reviewerLocked ? (
          <span className="caption locked-hint">Locked. Ask an approver to reopen.</span>
        ) : null}
        {lesson.status === 'in_review' && actions.length === 0 ? (
          <span className="caption">Waiting for an approver</span>
        ) : null}
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            className={action === 'reopen' ? 'btn' : 'btn primary'}
            disabled={actionBusy}
            onClick={() => void takeAction(action)}
          >
            {ACTION_LABELS[action]}
          </button>
        ))}
      </div>
      {actionError ? (
        <p className="notice err action-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <div
        className={`workspace${panel ? '' : ' no-side'}${editable && !preview ? '' : ' locked'}`}
      >
        <Rail outline={outline} homework={lesson.content.body.homework !== null} />
        <main className="docwrap">
          {!editable ? (
            <div className="notice info lock-notice" role="status">
              <Icon name="lock" />
              <div>
                {lesson.status === 'approved' ? (
                  <>
                    <b>This lesson is approved, so editing is locked.</b>{' '}
                    {lesson.approval
                      ? `${lesson.approval.name} approved it ${formatWhen(lesson.approval.at, { at: true })}. `
                      : ''}
                    Reopening moves it back to In review so reviewers can edit.
                  </>
                ) : (
                  <>
                    <b>This lesson is being generated, so editing is locked.</b> It opens for
                    editing when generation finishes.
                  </>
                )}
              </div>
            </div>
          ) : null}
          {preview ? (
            <div className="notice info preview-notice">
              <Icon name="history" />
              <div className="grow">
                <b>
                  Viewing the version from {formatWhen(preview.version.createdAt)} by{' '}
                  {preview.version.author?.name ?? 'System'}.
                </b>{' '}
                Read-only.
                <div className="row preview-actions">
                  {editable ? (
                    <button
                      type="button"
                      className="btn primary sm"
                      onClick={() => {
                        setRestoreError(null)
                        setConfirming(true)
                      }}
                    >
                      <Icon name="restore" />
                      Restore this version
                    </button>
                  ) : null}
                  <button type="button" className="btn sm" onClick={() => setPreview(null)}>
                    Back to current
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {preview ? (
            <article
              className="doc"
              aria-label={`${label}, version from ${formatWhen(preview.version.createdAt)}`}
            >
              <PreviewDocument content={preview.doc} ctx={previewCtx} />
            </article>
          ) : null}
          <article className="doc" aria-label={`${label} editor`} hidden={preview !== null}>
            {collab.synced && collab.provider ? (
              <LiveDocument
                key={lesson.status}
                collab={collab}
                ctx={ctx}
                label={`${label} editor`}
                user={collabUser}
                initialContent={initialDoc}
                onEditor={onEditor}
              />
            ) : (
              <p className="caption">Opening the lesson…</p>
            )}
          </article>
        </main>
        {panel ? (
          <SidePanel
            tab={panel}
            onTab={showPanel}
            versions={versions}
            history={history}
            selectedVersion={preview?.version.id ?? null}
            onOpenVersion={(version) => void openVersion(version)}
          />
        ) : null}
      </div>

      {picker ? (
        <StandardPicker
          target={picker}
          reference={standards}
          onClose={() => setPicker(null)}
          onPick={(code) => {
            if (picker.group === 'part') run(addPartStandard(picker.partId ?? '', code, standards))
            else run(addStandard(picker.group, code, standards))
            setPicker(null)
          }}
        />
      ) : null}
      {confirming && preview ? (
        <RestoreDialog
          when={formatShort(preview.version.createdAt)}
          busy={restoreBusy}
          error={restoreError}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void restore()}
        />
      ) : null}
    </div>
  )
}
