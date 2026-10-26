'use client'
// AI assist in the live editor (mockups R20-ai-toolbar, R20-ai-instruction, R20-ai-pending,
// R20-ai-suggestion, R21-regenerate-section, R21-section-preview). The previews are local
// decorations (assist_plugin.ts); accepting is one transaction that syncs through Yjs.
import type { Editor, JSONContent } from '@tiptap/core'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { lessonToDoc, parseData } from '../../editor/convert'
import { SECTION_NODE } from '../../editor/schema'
import { SECTION_NAMES, type SectionKind } from '../../lesson/labels'
import type { LessonContent, Section } from '../../lesson/schema'
import { Icon } from '../lesson/lesson_icons'
import {
  acceptSection,
  acceptSuggestion,
  anchorRange,
  assistableRange,
  assistPreviewKey,
  blockIdAt,
  createAssistPreviewPlugin,
  rangeText,
  setPreview,
} from './assist_plugin'
import { PreviewDocument } from './lesson_documents'
import { useModal } from './use_modal'
import type { EditorViewContext } from './node_views'

type SelectionAction = 'rewrite' | 'shorten' | 'simplify' | 'instruction'

interface Run {
  action: SelectionAction
  instruction?: string
  from: number
  to: number
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const data = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? `The AI request failed (${response.status}).`)
  return data
}

function actionName(action: SelectionAction, grade: number): string {
  if (action === 'rewrite') return 'Rewrite'
  if (action === 'shorten') return 'Shorten'
  if (action === 'simplify') return `Simplify for grade ${grade}`
  return 'Ask AI'
}

/** Registers the preview plugin on the live editor; React portals cards into the hosts. */
function usePreviewHosts(editor: Editor) {
  const hosts = useMemo(
    () => ({ card: document.createElement('div'), proposal: document.createElement('div') }),
    [],
  )
  useEffect(() => {
    const plugin = createAssistPreviewPlugin(hosts)
    editor.registerPlugin(plugin)
    return () => {
      if (!editor.isDestroyed) editor.unregisterPlugin(assistPreviewKey)
    }
  }, [editor, hosts])
  return hosts
}

// ---------- R20 selection actions ----------

function SelectionToolbar({
  grade,
  top,
  left,
  focusFirst,
  onAction,
  onAsk,
  onClose,
}: {
  grade: number
  top: number
  left: number
  focusFirst: number
  onAction: (action: SelectionAction) => void
  onAsk: () => void
  onClose: () => void
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const [current, setCurrent] = useState(0)
  useEffect(() => {
    if (focusFirst > 0) refs.current[0]?.focus()
  }, [focusFirst])
  const items: { label: string; icon?: 'sparkle' | 'pencil'; run: () => void }[] = [
    { label: 'Rewrite', icon: 'sparkle', run: () => onAction('rewrite') },
    { label: 'Shorten', run: () => onAction('shorten') },
    { label: `Simplify for grade ${grade}`, run: () => onAction('simplify') },
    { label: 'Ask AI...', icon: 'pencil', run: onAsk },
  ]
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (step === undefined && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    let next = (current + (step ?? 0) + items.length) % items.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = items.length - 1
    setCurrent(next)
    refs.current[next]?.focus()
  }
  return (
    <div
      className="float toolbar ai-toolbar"
      role="toolbar"
      aria-label="Selection actions"
      style={{ top, left }}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.map((item, index) => (
        <button
          key={item.label}
          ref={(element) => {
            refs.current[index] = element
          }}
          type="button"
          className={`tb${index === 0 ? ' on' : ''}`}
          tabIndex={index === current ? 0 : -1}
          onFocus={() => setCurrent(index)}
          onClick={item.run}
        >
          {item.icon ? <Icon name={item.icon} /> : null}
          {item.label}
        </button>
      ))}
    </div>
  )
}

function AskDialog({
  top,
  left,
  onRun,
  onClose,
}: {
  top: number
  left: number
  onRun: (instruction: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState('')
  return (
    <form
      className="float toolbar ai-ask"
      role="dialog"
      aria-label="Ask AI about the selection"
      style={{ top, left }}
      onSubmit={(event) => {
        event.preventDefault()
        if (value.trim()) onRun(value.trim())
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <span className="ai-mark" aria-hidden="true">
        <Icon name="sparkle" />
      </span>
      <input
        className="input"
        aria-label="Instruction for the AI"
        placeholder="Tell the AI what to change"
        value={value}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="btn primary sm">
        Run
      </button>
      <button type="button" className="btn quiet sm" aria-label="Close" onClick={onClose}>
        <Icon name="close" />
      </button>
    </form>
  )
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'pending'; run: Run }
  | { kind: 'suggestion'; run: Run }
  | { kind: 'error'; message: string }

function SelectionAssist({
  editor,
  lessonId,
  grade,
  host,
  wrap,
}: {
  editor: Editor
  lessonId: string
  grade: number
  host: HTMLElement
  wrap: HTMLElement
}) {
  const [range, setRange] = useState<{ from: number; to: number } | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [asking, setAsking] = useState(false)
  const [focusToolbar, setFocusToolbar] = useState(0)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const request = useRef<{ id: number; abort: AbortController | null }>({ id: 0, abort: null })
  const acceptRef = useRef<HTMLButtonElement>(null)

  const place = useCallback(
    (from: number) => {
      const coords = editor.view.coordsAtPos(from)
      const box = wrap.getBoundingClientRect()
      setPosition({ top: coords.top - box.top - 50, left: Math.max(0, coords.left - box.left - 8) })
    },
    [editor, wrap],
  )

  useEffect(() => {
    function update() {
      const busy = assistPreviewKey.getState(editor.state)?.selection
      const next = busy ? null : assistableRange(editor.state)
      setRange((current) =>
        current?.from === next?.from && current?.to === next?.to ? current : next,
      )
      if (next) place(next.from)
      else setAsking(false)
    }
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
    }
  }, [editor, place])

  // Alt+/ opens the toolbar on a keyboard selection and focuses Rewrite.
  useEffect(() => {
    const dom = editor.view.dom
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey || event.code !== 'Slash') return
      const next = assistableRange(editor.state)
      if (!next) return
      event.preventDefault()
      setRange(next)
      place(next.from)
      setFocusToolbar((count) => count + 1)
    }
    dom.addEventListener('keydown', onKeyDown)
    return () => dom.removeEventListener('keydown', onKeyDown)
  }, [editor, place])

  useEffect(() => {
    if (phase.kind === 'suggestion') acceptRef.current?.focus()
  }, [phase])

  // The previewed text changed under a collaborator's edit: drop the request, say so, and leave
  // assist ready for the next selection.
  useEffect(() => {
    function onTransaction() {
      const lost = assistPreviewKey.getState(editor.state)?.lost
      if (!lost) return
      request.current.abort?.abort()
      request.current = { id: request.current.id + 1, abort: null }
      setPhase({ kind: 'error', message: lost })
      queueMicrotask(() => {
        if (!editor.isDestroyed) setPreview(editor.view, { lost: null })
      })
    }
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
    }
  }, [editor])

  const runAction = useCallback(
    async (run: Run) => {
      request.current.abort?.abort()
      const id = request.current.id + 1
      const abort = new AbortController()
      request.current = { id, abort }
      setAsking(false)
      setRange(null)
      setPhase({ kind: 'pending', run })
      // Anchored in the shared document, so collaborators' edits move it with the text.
      const anchor = anchorRange(editor.state, run.from, run.to)
      setPreview(editor.view, {
        selection: { kind: 'pending', from: run.from, to: run.to, anchor },
        lost: null,
      })
      try {
        const { suggestion } = await postJson<{ suggestion: string }>(
          `/api/lessons/${lessonId}/assist/selection`,
          {
            action: run.action,
            text: rangeText(editor.state, run.from, run.to),
            instruction: run.instruction,
            blockId: blockIdAt(editor.state, run.from),
          },
          abort.signal,
        )
        if (request.current.id !== id || editor.isDestroyed) return
        // Where the text is now: it may have moved with collaborators' edits. If its own text
        // changed, the preview was dropped and the user told (never fall back to old positions).
        const mapped = assistPreviewKey.getState(editor.state)?.selection
        if (!mapped) return
        setPreview(editor.view, {
          selection: {
            kind: 'suggestion',
            from: mapped.from,
            to: mapped.to,
            anchor: mapped.anchor,
            suggestion,
          },
        })
        setPhase({ kind: 'suggestion', run: { ...run, from: mapped.from, to: mapped.to } })
      } catch (error) {
        if (request.current.id !== id || editor.isDestroyed) return
        setPreview(editor.view, { selection: null })
        setPhase({ kind: 'error', message: (error as Error).message })
      }
    },
    [editor, lessonId],
  )

  function start(action: SelectionAction, instruction?: string) {
    if (!range) return
    void runAction({ action, instruction, ...range })
  }

  function finish(collapseAt?: number) {
    request.current.abort?.abort()
    request.current = { id: request.current.id + 1, abort: null }
    setPhase({ kind: 'idle' })
    if (editor.isDestroyed) return
    const tr = editor.state.tr.setMeta(assistPreviewKey, { selection: null })
    editor.view.dispatch(tr)
    if (collapseAt !== undefined) {
      editor.commands.setTextSelection(Math.min(collapseAt, editor.state.doc.content.size))
      editor.view.focus()
    }
  }

  function accept() {
    request.current = { id: request.current.id + 1, abort: null }
    // Refused when the text changed meanwhile; the `lost` watcher then shows why.
    if (acceptSuggestion(editor.view)) setPhase({ kind: 'idle' })
  }

  function onCardKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      const preview = assistPreviewKey.getState(editor.state)?.selection
      finish(preview?.to)
    }
  }

  let card: React.ReactNode = null
  if (phase.kind === 'pending') {
    card = (
      <div className="float ai-card" role="status" aria-live="polite">
        <div className="row">
          <span className="ai-mark" aria-hidden="true">
            <Icon name="sparkle" />
          </span>
          <b>{actionName(phase.run.action, grade)}</b>
          <span className="spacer" />
          <button type="button" className="btn quiet sm" onClick={() => finish(phase.run.to)}>
            Cancel
          </button>
        </div>
        <div className="progress indet">
          <i />
        </div>
        <p className="caption">
          Writing a suggestion. Nothing in the lesson changes until you accept it.
        </p>
      </div>
    )
  } else if (phase.kind === 'suggestion') {
    card = (
      <div
        className="float ai-card"
        role="dialog"
        aria-label="AI suggestion"
        onKeyDown={onCardKeyDown}
      >
        <div className="row">
          <span className="ai-mark" aria-hidden="true">
            <Icon name="sparkle" />
          </span>
          <b>{actionName(phase.run.action, grade)}</b>
          <span className="caption">Suggested change shown in the text above</span>
        </div>
        <div className="row ai-actions">
          <button ref={acceptRef} type="button" className="btn primary sm" onClick={accept}>
            <Icon name="check" />
            Accept
          </button>
          <button type="button" className="btn sm" onClick={() => finish(phase.run.to)}>
            <Icon name="close" />
            Reject
          </button>
          <button
            type="button"
            className="btn quiet sm"
            onClick={() => {
              const preview = assistPreviewKey.getState(editor.state)?.selection
              void runAction({
                ...phase.run,
                from: preview?.from ?? phase.run.from,
                to: preview?.to ?? phase.run.to,
              })
            }}
          >
            <Icon name="refresh" />
            Try again
          </button>
          <span className="spacer" />
          <span className="caption ai-hint">
            Enter to accept, Esc to reject. Accepting can be undone in one step.
          </span>
        </div>
      </div>
    )
  }

  return (
    <>
      {createPortal(
        <>
          {range && !asking && phase.kind !== 'pending' && phase.kind !== 'suggestion' ? (
            <SelectionToolbar
              grade={grade}
              top={position.top}
              left={position.left}
              focusFirst={focusToolbar}
              onAction={(action) => start(action)}
              onAsk={() => setAsking(true)}
              onClose={() => {
                setRange(null)
                editor.view.focus()
              }}
            />
          ) : null}
          {range && asking ? (
            <AskDialog
              top={position.top}
              left={position.left}
              onRun={(instruction) => start('instruction', instruction)}
              onClose={() => {
                setAsking(false)
                editor.view.focus()
              }}
            />
          ) : null}
          {phase.kind === 'error' ? (
            <div className="notice err ai-error" role="alert">
              <Icon name="warning" />
              <div className="grow">{phase.message}</div>
              <button
                type="button"
                className="btn quiet sm"
                onClick={() => setPhase({ kind: 'idle' })}
              >
                Dismiss
              </button>
            </div>
          ) : null}
        </>,
        wrap,
      )}
      {card ? createPortal(card, host) : null}
    </>
  )
}

// ---------- R21 regenerate one section ----------

interface SectionTarget {
  sectionId: string
  kind: SectionKind
}

function RegenerateDialog({
  target,
  busy,
  error,
  promptVersion,
  onCancel,
  onRun,
}: {
  target: SectionTarget
  busy: boolean
  error: string | null
  promptVersion: number
  onCancel: () => void
  onRun: (instruction: string) => void
}) {
  const titleId = useId()
  const fieldId = useId()
  const [instruction, setInstruction] = useState('')
  const name = SECTION_NAMES[target.kind]
  const dialogRef = useRef<HTMLFormElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  useModal(dialogRef, onCancel, { initialFocus: fieldRef })
  // After a failed request the submit button was disabled; put focus back in the dialog.
  useEffect(() => {
    if (error) fieldRef.current?.focus()
  }, [error])
  return (
    <div className="scrim">
      <form
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={(event) => {
          event.preventDefault()
          onRun(instruction.trim())
        }}
      >
        <header>
          <h2 className="h3" id={titleId}>
            Regenerate {name}
          </h2>
          <p className="sub">
            Only this section is rewritten. The rest of the lesson stays as it is, and you review
            the result before it replaces anything.
          </p>
        </header>
        <div className="body">
          <label className="lbl" htmlFor={fieldId}>
            Instruction <span className="muted opt">(optional)</span>
          </label>
          <textarea
            ref={fieldRef}
            id={fieldId}
            className="textarea"
            rows={3}
            value={instruction}
            placeholder={`What should change in ${name}?`}
            onChange={(event) => setInstruction(event.target.value)}
          />
          <p className="help">
            Uses prompt v{promptVersion} and this lesson&rsquo;s outline row, standards and the
            sections around it.
          </p>
          {busy ? (
            <p className="caption" role="status">
              Writing a new {name}. Nothing in the lesson changes until you accept it.
            </p>
          ) : null}
          {error ? (
            <p className="errmsg" role="alert">
              <Icon name="warning" />
              <span>{error}</span>
            </p>
          ) : null}
        </div>
        <footer>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            <Icon name="sparkle" />
            {busy ? 'Regenerating…' : 'Regenerate section'}
          </button>
        </footer>
      </form>
    </div>
  )
}

interface Proposal extends SectionTarget {
  instruction: string
  section: Section
  doc: JSONContent
  sectionJson: JSONContent
  showCurrent: boolean
}

/** A lesson doc holding only the proposed section; its JSON node for the live schema. */
function proposalDocs(base: LessonContent, section: Section) {
  const doc = lessonToDoc({ ...base, body: { ...base.body, sections: [section], homework: null } })
  let sectionJson: JSONContent | null = null
  function find(node: JSONContent) {
    if (sectionJson) return
    if (node.type === SECTION_NODE && node.attrs?.id === section.id) sectionJson = node
    node.content?.forEach(find)
  }
  find(doc)
  return { doc, sectionJson: sectionJson ?? doc }
}

function useSectionRegenerate(editor: Editor, lessonId: string, content: LessonContent) {
  const [dialog, setDialog] = useState<SectionTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)

  async function run(target: SectionTarget, instruction: string) {
    setBusy(true)
    setError(null)
    try {
      const { section } = await postJson<{ section: Section }>(
        `/api/lessons/${lessonId}/assist/section`,
        { sectionId: target.sectionId, instruction: instruction || undefined },
      )
      if (editor.isDestroyed) return
      setDialog(null)
      setProposal({
        ...target,
        instruction,
        section,
        ...proposalDocs(content, section),
        showCurrent: false,
      })
      setPreview(editor.view, { proposal: { sectionId: target.sectionId, showCurrent: false } })
    } catch (err) {
      setError((err as Error).message)
      setDialog(target)
    } finally {
      setBusy(false)
    }
  }

  function close() {
    setProposal(null)
    if (!editor.isDestroyed) setPreview(editor.view, { proposal: null })
  }

  return {
    dialog,
    busy,
    error,
    proposal,
    open(target: SectionTarget) {
      setError(null)
      setDialog(target)
    },
    cancel() {
      setDialog(null)
    },
    run,
    accept() {
      if (!proposal) return
      acceptSection(editor.view, proposal.sectionJson)
      setProposal(null)
      editor.view.focus()
    },
    reject: close,
    tryAgain() {
      if (!proposal) return
      const target = { sectionId: proposal.sectionId, kind: proposal.kind }
      close()
      setDialog(target)
      void run(target, proposal.instruction)
    },
    toggleCurrent() {
      if (!proposal) return
      const showCurrent = !proposal.showCurrent
      setProposal({ ...proposal, showCurrent })
      setPreview(editor.view, { proposal: { sectionId: proposal.sectionId, showCurrent } })
    },
  }
}

function sectionMinutes(editor: Editor, sectionId: string, fallback: number): number {
  let minutes = fallback
  editor.state.doc.descendants((node) => {
    if (node.type.name !== SECTION_NODE) return true
    if (node.attrs.id === sectionId) {
      const data = parseData(node.toJSON())
      if (typeof data.minutes === 'number') minutes = data.minutes
    }
    return false
  })
  return minutes
}

// ---------- the layer ----------

export interface AssistLayerHandle {
  regenerateSection(sectionId: string, kind: SectionKind): void
}

export function AssistLayer({
  editor,
  lessonId,
  grade,
  content,
  previewCtx,
  wrap,
  handleRef,
  promptVersion,
}: {
  editor: Editor
  lessonId: string
  grade: number
  /** The unit's current prompt version, named in the regenerate dialog (R21). */
  promptVersion: number
  content: LessonContent
  previewCtx: EditorViewContext
  /** The document column: the toolbar and alerts are placed in it. */
  wrap: HTMLElement
  handleRef: RefObject<AssistLayerHandle | null>
}) {
  const hosts = usePreviewHosts(editor)
  const regen = useSectionRegenerate(editor, lessonId, content)
  const openRegen = regen.open
  useEffect(() => {
    handleRef.current = {
      regenerateSection: (sectionId, kind) => openRegen({ sectionId, kind }),
    }
    return () => {
      handleRef.current = null
    }
  }, [handleRef, openRegen])

  const proposal = regen.proposal
  const regionRef = useRef<HTMLDivElement>(null)
  const proposalAcceptRef = useRef<HTMLButtonElement>(null)
  const proposalKey = proposal?.section
  useEffect(() => {
    if (!proposalKey) return
    regionRef.current?.scrollIntoView({ block: 'center' })
    // Focus moves from the closed dialog to the decision it asked for.
    proposalAcceptRef.current?.focus({ preventScroll: true })
  }, [proposalKey])

  const name = proposal ? SECTION_NAMES[proposal.kind] : ''
  return (
    <>
      <SelectionAssist
        editor={editor}
        lessonId={lessonId}
        grade={grade}
        host={hosts.card}
        wrap={wrap}
      />
      {regen.dialog ? (
        <RegenerateDialog
          key={regen.dialog.sectionId}
          target={regen.dialog}
          busy={regen.busy}
          error={regen.error}
          promptVersion={promptVersion}
          onCancel={regen.cancel}
          onRun={(instruction) => void regen.run(regen.dialog!, instruction)}
        />
      ) : null}
      {proposal
        ? createPortal(
            <>
              <div
                ref={regionRef}
                className="notice ok ai-proposal"
                role="region"
                aria-label={`Proposed ${name}`}
              >
                <Icon name="sparkle" />
                <div className="grow">
                  <b>Proposed {name}.</b> Highlighted blocks replace the current section when you
                  accept. Minutes stay at{' '}
                  {sectionMinutes(editor, proposal.sectionId, proposal.section.minutes)}.
                  <div className="row ai-actions">
                    <button
                      ref={proposalAcceptRef}
                      type="button"
                      className="btn primary sm"
                      onClick={regen.accept}
                    >
                      <Icon name="check" />
                      Accept
                    </button>
                    <button type="button" className="btn sm" onClick={regen.reject}>
                      <Icon name="close" />
                      Reject
                    </button>
                    <button type="button" className="btn quiet sm" onClick={regen.tryAgain}>
                      <Icon name="refresh" />
                      Try again
                    </button>
                    <button
                      type="button"
                      className="btn quiet sm"
                      aria-pressed={proposal.showCurrent}
                      onClick={regen.toggleCurrent}
                    >
                      Show current version
                    </button>
                  </div>
                </div>
              </div>
              {proposal.showCurrent ? null : (
                <div className="prop">
                  <PreviewDocument
                    content={proposal.doc}
                    ctx={previewCtx}
                    className="lesson-pm proposal-doc"
                  />
                </div>
              )}
            </>,
            hosts.proposal,
          )
        : null}
    </>
  )
}
