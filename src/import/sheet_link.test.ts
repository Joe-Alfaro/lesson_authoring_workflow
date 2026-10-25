// R1: import from a Google Sheets share link. Unit tests stub fetch (no network).
// Contract: src/import/README.md.
import { describe, expect, it, vi } from 'vitest'
import { sampleOutlineCsv } from '../../tests/import_fixtures'
import { parseOutline } from './parse_outline'
import { SheetAccessError, SheetLinkError, fetchSheetCsv, toCsvExportUrl } from './sheet_link'

// A made-up sheet id; no real sheet link appears in tracked files (R1).
const ID = '1AbC-dEf_123456789xyz'
const BASE = `https://docs.google.com/spreadsheets/d/${ID}`
const EXPORT = `${BASE}/export?format=csv`

const NOT_SHARED = /must be shared.*anyone with the link/i

function csvResponse(body: string) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/csv' } })
}

describe('toCsvExportUrl', () => {
  it.each([
    ['share link', `${BASE}/edit?usp=sharing`, EXPORT],
    ['edit link', `${BASE}/edit`, EXPORT],
    ['view link', `${BASE}/view`, EXPORT],
    ['bare id link', BASE, EXPORT],
    ['tab in the fragment', `${BASE}/edit#gid=456`, `${EXPORT}&gid=456`],
    ['tab in query and fragment', `${BASE}/edit?gid=456#gid=456`, `${EXPORT}&gid=456`],
    ['share link with a tab', `${BASE}/edit?usp=sharing#gid=0`, `${EXPORT}&gid=0`],
    ['surrounding whitespace', `  ${BASE}/edit  `, EXPORT],
    ['already an export link', `${EXPORT}&gid=7`, `${EXPORT}&gid=7`],
  ])('converts a %s', (_name, link, expected) => {
    expect(toCsvExportUrl(link)).toBe(expected)
  })

  it.each([
    ['another host', 'https://example.com/spreadsheets/d/abc/edit'],
    ['a Google Doc', 'https://docs.google.com/document/d/abc/edit'],
    ['not a URL', 'lesson outline'],
    ['empty', ''],
  ])('rejects %s', (_name, link) => {
    expect(() => toCsvExportUrl(link)).toThrow(SheetLinkError)
  })
})

describe('fetchSheetCsv', () => {
  it('fetches the CSV export URL without credentials and returns the body', async () => {
    const fetchImpl = vi.fn(async () => csvResponse(sampleOutlineCsv()))

    const csv = await fetchSheetCsv(`${BASE}/edit?usp=sharing#gid=0`, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit | undefined]
    expect(String(url)).toBe(`${EXPORT}&gid=0`)
    expect(new Headers(init?.headers).get('authorization')).toBeNull()
    expect(csv).toBe(sampleOutlineCsv())
  })

  it('imports the same outline from a link as from the uploaded file', async () => {
    const fetchImpl = vi.fn(async () => csvResponse(sampleOutlineCsv()))
    const fromLink = parseOutline(await fetchSheetCsv(`${BASE}/edit`, fetchImpl))
    expect(fromLink).toEqual(parseOutline(sampleOutlineCsv()))
  })

  it('explains that the sheet must be shared when Google answers with its sign-in page', async () => {
    // A private sheet redirects to the Google sign-in page, which fetch follows to a 200 HTML page.
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          '<!DOCTYPE html><html><head><title>Sign in</title></head><body></body></html>',
          {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          },
        ),
    )
    const error = await fetchSheetCsv(`${BASE}/edit`, fetchImpl).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SheetAccessError)
    expect((error as Error).message).toMatch(NOT_SHARED)
  })

  it('treats an HTML body as not shared even without an HTML content type', async () => {
    const fetchImpl = vi.fn(async () => csvResponse('<html><body>Sign in</body></html>'))
    await expect(fetchSheetCsv(`${BASE}/edit`, fetchImpl)).rejects.toThrow(NOT_SHARED)
  })

  it.each([401, 403, 404, 500])(
    'explains that the sheet must be shared on HTTP %i',
    async (status) => {
      const fetchImpl = vi.fn(async () => new Response('Not found', { status }))
      const error = await fetchSheetCsv(`${BASE}/edit`, fetchImpl).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(SheetAccessError)
      expect((error as Error).message).toMatch(NOT_SHARED)
    },
  )

  it('rejects a non-Sheets link before fetching', async () => {
    const fetchImpl = vi.fn(async () => csvResponse(''))
    await expect(fetchSheetCsv('https://example.com/x.csv', fetchImpl)).rejects.toThrow(
      SheetLinkError,
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

// D-028: account-switch links (/u/<n>/) and "Publish to the web" links (/d/e/<id>/pub).
const PUB_ID = '2PACX-1vAbCdEf_123456789xyz'
const PUB = `https://docs.google.com/spreadsheets/d/e/${PUB_ID}`
const PUB_EXPORT = `${PUB}/pub?output=csv`

describe('toCsvExportUrl with /u/<n>/ and publish links', () => {
  it.each([
    ['/u/0/ edit link', `https://docs.google.com/spreadsheets/u/0/d/${ID}/edit`, EXPORT],
    [
      '/u/1/ share link with a tab',
      `https://docs.google.com/spreadsheets/u/1/d/${ID}/edit?usp=sharing#gid=456`,
      `${EXPORT}&gid=456`,
    ],
    ['publish link (web page)', `${PUB}/pubhtml`, PUB_EXPORT],
    ['publish link (CSV)', `${PUB}/pub?output=csv`, PUB_EXPORT],
    ['publish link (other format)', `${PUB}/pub?output=xlsx`, PUB_EXPORT],
    [
      'publish link for one tab',
      `${PUB}/pubhtml?gid=456&single=true`,
      `${PUB_EXPORT}&gid=456&single=true`,
    ],
    [
      'publish CSV link for one tab',
      `${PUB}/pub?gid=456&single=true&output=csv`,
      `${PUB_EXPORT}&gid=456&single=true`,
    ],
    [
      '/u/0/ publish link',
      `https://docs.google.com/spreadsheets/u/0/d/e/${PUB_ID}/pubhtml`,
      PUB_EXPORT,
    ],
  ])('converts a %s', (_name, link, expected) => {
    expect(toCsvExportUrl(link)).toBe(expected)
  })

  it('does not read the "e" of a publish link as a sheet id', () => {
    expect(toCsvExportUrl(`${PUB}/pubhtml`)).not.toContain('/d/e/export')
  })

  it('fetches a publish link from its CSV output', async () => {
    const fetchImpl = vi.fn(async () => csvResponse(sampleOutlineCsv()))
    await fetchSheetCsv(`${PUB}/pubhtml`, fetchImpl)
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(String(url)).toBe(PUB_EXPORT)
  })
})
