import type { lessonStandardKind } from '../db/schema'

export type StandardKind = (typeof lessonStandardKind.enumValues)[number]

export interface NormalizeOptions {
  kind: StandardKind
  grade: number
  isKnown: (code: string) => boolean
}

export interface NormalizedStandards {
  codes: string[]
  unknownCodes: string[]
}

// `RL.6.1`, `W.6.2.a`, `W.6.2.a–f` (letter range), `RH.6-8.1`.
const FULL_CODE = /^([A-Z]+)\.(\d+(?:-\d+)?)\.(\d+)(?:\.([a-z])(?:[–-]([a-z]))?)?$/
// A bare `6.2` or `6.2.a` after a full code reuses that code's strand (`RL.6.1, 6.2`).
const SHORT_CODE = /^(\d+)\.(\d+)(?:\.([a-z]))?$/
// The outline writes school library (media literacy) standards as bare `2.1.a`.
const LIBRARY_CODE = /^\d+\.\d+(?:\.[a-z])?$/
const ELD_CODES = /ELD\.PI{1,2}\.\d+\.\d+(?:\.[a-z])?/g

function letterRange(from: string, to: string): string[] {
  const start = from.charCodeAt(0)
  const end = to.charCodeAt(0)
  if (end < start) {
    return [from]
  }
  return Array.from({ length: end - start + 1 }, (_, i) => String.fromCharCode(start + i))
}

function tokensOf(cell: string): string[] {
  return cell.split(/[\s,;]+/).filter(Boolean)
}

function elaCodes(cell: string): string[] {
  let strand: string | null = null
  return tokensOf(cell).flatMap((token) => {
    const full = token.match(FULL_CODE)
    if (full) {
      const [, prefix, grade, number, from, to] = full
      strand = prefix!
      const base = `${prefix}.${grade}.${number}`
      return from ? letterRange(from, to ?? from).map((letter) => `${base}.${letter}`) : [base]
    }
    const short = token.match(SHORT_CODE)
    if (short && strand) {
      const [, grade, number, letter] = short
      return [`${strand}.${grade}.${number}${letter ? `.${letter}` : ''}`]
    }
    // Unrecognized text is kept as written so it surfaces as an unknown code (R3).
    return [token]
  })
}

function mediaCodes(cell: string, grade: number): string[] {
  return tokensOf(cell).map((token) => (LIBRARY_CODE.test(token) ? `LIB.${grade}.${token}` : token))
}

/** One entry per line: `• ELD.PI.6.6 – Exchange information…` -> `ELD.PI.6.6`. */
function eldCodes(cell: string): string[] {
  return cell
    .split('\n')
    .map((line) => line.replace(/^[•\-*\s]+/, '').trim())
    .filter(Boolean)
    .flatMap((line) => {
      // The code list ends at the " – description" separator.
      const head = line.split(/\s+[–-]\s+/)[0] ?? ''
      const codes = head.match(ELD_CODES)
      // An entry that is not an ELD code is kept as written and surfaces as unknown (R3).
      return codes ? [...codes] : tokensOf(head)
    })
}

function rawCodes(text: string, kind: StandardKind, grade: number): string[] {
  if (kind === 'eld') {
    return eldCodes(text)
  }
  if (kind === 'media') {
    return mediaCodes(text, grade)
  }
  return elaCodes(text)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

/** Turns one outline standards cell into codes, in cell order without duplicates (R3). */
export function normalizeStandards(
  cell: string,
  { kind, grade, isKnown }: NormalizeOptions,
): NormalizedStandards {
  const text = cell.trim()
  if (text === '') {
    return { codes: [], unknownCodes: [] }
  }
  const codes = unique(rawCodes(text, kind, grade))
  return { codes, unknownCodes: codes.filter((code) => !isKnown(code)) }
}
