'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import type { BadInputReason } from '../../import/http'
import type { ImportPreview } from '../../import/import_service'
import { ImportForm, type FormErrors, type ImportFormValues } from './import_form'
import { ImportPreviewView } from './import_preview'
import { OutlineHelp } from './outline_help'
import { ParsingPanel } from './parsing_panel'
import { Breadcrumbs } from '../breadcrumbs'

/** R1: the copy for a sheet that can't be read without signing in to Google. */
const SHARE_ERROR =
  'This sheet isn\'t shared by link, so it can\'t be read. In Google Sheets choose Share, set General access to "Anyone with the link", then import again. No unit was created.'

type Phase =
  | { kind: 'form'; errors: FormErrors }
  | { kind: 'parsing' }
  | { kind: 'preview'; preview: ImportPreview }

interface ApiError {
  error?: string
  reason?: BadInputReason
}

/** Puts a 400 answer from POST /api/imports under the field it is about. */
function errorsFrom(body: ApiError, values: ImportFormValues): FormErrors {
  const message = body.error ?? 'The outline could not be read.'
  if (body.reason === 'sheet_not_shared') {
    return { link: SHARE_ERROR }
  }
  if (body.reason === 'eld_sheet_not_shared') {
    return { eldLink: SHARE_ERROR }
  }
  if (body.reason === 'eld_link') {
    return { eldLink: message }
  }
  if (body.reason === 'eld_file') {
    return values.eldLink === null ? { eld: message } : { eldLink: message }
  }
  return values.source === 'link' ? { link: message } : { csv: message }
}

function missingInput(values: ImportFormValues): FormErrors | null {
  if (values.source === 'link' && values.link.trim() === '') {
    return { link: 'Paste the link to the outline sheet.' }
  }
  if (values.source === 'csv' && !values.csvFile) {
    return { csv: 'Choose the outline CSV file.' }
  }
  if (values.eldLink !== null && values.eldLink.trim() === '') {
    return { eldLink: 'Paste the link to the ELD tab, or remove it.' }
  }
  return null
}

function requestBody(values: ImportFormValues): FormData {
  const form = new FormData()
  if (values.source === 'link') {
    form.append('url', values.link.trim())
  } else if (values.csvFile) {
    form.append('file', values.csvFile)
  }
  if (values.eldFile) {
    form.append('eld', values.eldFile)
  } else if (values.eldLink) {
    form.append('eldUrl', values.eldLink.trim())
  }
  return form
}

/**
 * R1, R4, R5 import: form, parsing, then the preview, all on /units/import. Nothing is saved
 * until "Create unit"; leaving the preview cancels the pending import.
 */
export function ImportFlow() {
  const router = useRouter()
  const [values, setValues] = useState<ImportFormValues>({
    source: 'link',
    link: '',
    csvFile: null,
    eldFile: null,
    eldLink: null,
  })
  const [phase, setPhase] = useState<Phase>({ kind: 'form', errors: {} })
  const [busy, setBusy] = useState<'create' | 'cancel' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const reading = useRef<AbortController | null>(null)

  async function readOutline() {
    const missing = missingInput(values)
    if (missing) {
      setPhase({ kind: 'form', errors: missing })
      return
    }
    const controller = new AbortController()
    reading.current = controller
    setPhase({ kind: 'parsing' })
    try {
      const response = await fetch('/api/imports', {
        method: 'POST',
        body: requestBody(values),
        signal: controller.signal,
      })
      const body: unknown = await response.json()
      if (controller.signal.aborted) {
        return
      }
      if (!response.ok) {
        setPhase({ kind: 'form', errors: errorsFrom(body as ApiError, values) })
        return
      }
      setActionError(null)
      setPhase({ kind: 'preview', preview: body as ImportPreview })
    } catch {
      if (!controller.signal.aborted) {
        setPhase({
          kind: 'form',
          errors: errorsFrom({ error: 'The outline could not be sent. Try again.' }, values),
        })
      }
    }
  }

  function cancelReading() {
    reading.current?.abort()
    setPhase({ kind: 'form', errors: {} })
  }

  async function createUnit(preview: ImportPreview) {
    setBusy('create')
    setActionError(null)
    const response = await fetch(`/api/imports/${preview.importId}/confirm`, { method: 'POST' })
    if (!response.ok) {
      setBusy(null)
      setActionError(
        response.status === 404
          ? 'This import expired or was already used. Read the outline again.'
          : 'The unit could not be created. Try again.',
      )
      return
    }
    const { unitId } = (await response.json()) as { unitId: string }
    router.push(`/units/${unitId}`)
  }

  async function cancelImport(preview: ImportPreview) {
    setBusy('cancel')
    await fetch(`/api/imports/${preview.importId}`, { method: 'DELETE' }).catch(() => undefined)
    router.push('/units')
  }

  if (phase.kind === 'preview') {
    return (
      <ImportPreviewView
        preview={phase.preview}
        busy={busy}
        error={actionError}
        onCreate={() => void createUnit(phase.preview)}
        onCancel={() => void cancelImport(phase.preview)}
      />
    )
  }

  return (
    <main className="page">
      <Breadcrumbs trail={[{ label: 'Units', href: '/units' }, { label: 'Import' }]} />
      <h1 className="h1">Import an outline</h1>
      <div className="imp">
        {phase.kind === 'parsing' ? (
          <ParsingPanel
            sourceLabel={
              values.source === 'link'
                ? 'the Google Sheets link'
                : (values.csvFile?.name ?? 'the file')
            }
            firstStep={values.source === 'link' ? 'Fetched the sheet' : 'Read the file'}
            onCancel={cancelReading}
          />
        ) : (
          <ImportForm
            values={values}
            errors={phase.errors}
            onChange={setValues}
            onSubmit={() => void readOutline()}
            onCancel={() => router.push('/units')}
          />
        )}
        <OutlineHelp />
      </div>
    </main>
  )
}
