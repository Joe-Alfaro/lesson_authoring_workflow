// R3: normalize standards codes. Contract: src/import/README.md.
import { describe, expect, it } from 'vitest'
import { knownStandardCodes, sampleOutlineCsv } from '../../tests/import_fixtures'
import { normalizeStandards, type StandardKind } from './normalize_standards'
import { parseOutline } from './parse_outline'

const known = knownStandardCodes()
const isKnown = (code: string) => known.has(code)

function normalize(cell: string, kind: StandardKind = 'focus') {
  return normalizeStandards(cell, { kind, grade: 6, isKnown })
}

describe('normalizeStandards (R3)', () => {
  it.each<[string, StandardKind, string, string[]]>([
    [
      'bare N.N reuses the previous strand',
      'focus',
      'RL.6.1, 6.2 L.6.4',
      ['RL.6.1', 'RL.6.2', 'L.6.4'],
    ],
    [
      'a plain list',
      'supporting',
      'L.6.4.b, RI.6.1, RI.6.4, SL.6.1.a',
      ['L.6.4.b', 'RI.6.1', 'RI.6.4', 'SL.6.1.a'],
    ],
    [
      'duplicates removed, first order kept',
      'focus',
      'RL.6.2, RL.6.1, RL.6.2, L.6.4, RL.6.1',
      ['RL.6.2', 'RL.6.1', 'L.6.4'],
    ],
    [
      'en-dash letter range',
      'supporting',
      'W.6.2.a–f',
      ['W.6.2.a', 'W.6.2.b', 'W.6.2.c', 'W.6.2.d', 'W.6.2.e', 'W.6.2.f'],
    ],
    ['hyphen letter range', 'supporting', 'L.6.2.a-b', ['L.6.2.a', 'L.6.2.b']],
    [
      'range then codes, double space',
      'supporting',
      'SL.6.1.a–d, SL.6.2,  SL.6.4',
      ['SL.6.1.a', 'SL.6.1.b', 'SL.6.1.c', 'SL.6.1.d', 'SL.6.2', 'SL.6.4'],
    ],
    ['non-breaking spaces around codes', 'focus', ' RL.6.1, RL.6.3 ', ['RL.6.1', 'RL.6.3']],
    ['empty cell', 'focus', '', []],
    ['whitespace-only cell', 'focus', '   ', []],
    [
      'ELD code with its description',
      'eld',
      'ELD.PI.6.6 – Exchange information and ideas orally',
      ['ELD.PI.6.6'],
    ],
    [
      'ELD bullet list',
      'eld',
      '• ELD.PI.6.6 – Exchange information and ideas orally\n• ELD.PI.6.7 – Analyze how meaning is conveyed\n• ELD.PII.6.4 – Expand noun phrases and descriptive language',
      ['ELD.PI.6.6', 'ELD.PI.6.7', 'ELD.PII.6.4'],
    ],
    [
      'ELD duplicates removed',
      'eld',
      '• ELD.PI.6.6 – Describe ideas\n• ELD.PI.6.6 – Explain ideas using evidence',
      ['ELD.PI.6.6'],
    ],
    ['bare media literacy code maps to LIB', 'media', '2.1.a', ['LIB.6.2.1.a']],
    ['media literacy list', 'media', '2.1.a, 2.1.b', ['LIB.6.2.1.a', 'LIB.6.2.1.b']],
  ])('%s', (_name, kind, cell, expected) => {
    const result = normalize(cell, kind)
    expect(result.codes).toEqual(expected)
    expect(result.unknownCodes).toEqual([])
  })

  it('keeps a code missing from the reference data and reports it as unknown', () => {
    expect(normalize('RL.6.9, RL.6.9.a, L.6.4')).toEqual({
      codes: ['RL.6.9', 'RL.6.9.a', 'L.6.4'],
      unknownCodes: ['RL.6.9.a'],
    })
  })

  it('reports each unknown code once', () => {
    expect(normalize('RL.6.9.a, RL.6.9.a, XY.6.1').unknownCodes).toEqual(['RL.6.9.a', 'XY.6.1'])
  })

  it('maps media codes with the unit grade', () => {
    const result = normalizeStandards('3.3.a', { kind: 'media', grade: 7, isKnown: () => true })
    expect(result.codes).toEqual(['LIB.7.3.3.a'])
  })
})

describe('normalizeStandards on every standards cell of the sample outline', () => {
  const outline = parseOutline(sampleOutlineCsv())
  const columns = [
    ['focusStandards', 'focus'],
    ['supportingStandards', 'supporting'],
    ['mediaLiteracyStandards', 'media'],
    ['eldStandards', 'eld'],
  ] as const

  it('resolves every code except RL.6.9.a (data/standards/README.md)', () => {
    const unknown = new Set<string>()
    const all = new Set<string>()
    for (const item of outline.items) {
      for (const [field, kind] of columns) {
        const result = normalize(item[field], kind)
        result.codes.forEach((code) => all.add(code))
        result.unknownCodes.forEach((code) => unknown.add(code))
      }
    }
    expect([...unknown]).toEqual(['RL.6.9.a'])
    expect(all.size).toBe(85)
  })

  it('normalizes the lesson 1 ELD cell to its three codes', () => {
    const lesson1 = outline.items.find((item) => item.lessonNumber === 1)
    expect(normalize(lesson1?.eldStandards ?? '', 'eld').codes).toEqual([
      'ELD.PI.6.6',
      'ELD.PI.6.7',
      'ELD.PII.6.4',
    ])
  })
})
