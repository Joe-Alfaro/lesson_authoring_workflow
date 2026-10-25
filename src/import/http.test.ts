// The 400 `reason` lets the import form put an error under the right field (R1, R5).
import { describe, expect, it } from 'vitest'
import { BadInputError, badRequest } from './http'
import { EldSheetError } from './import_service'
import { EldParseError } from './parse_eld'
import { OutlineParseError } from './parse_outline'
import { SheetAccessError, SheetLinkError } from './sheet_link'

async function reasonOf(error: Error): Promise<unknown> {
  const response = badRequest(error)
  expect(response.status).toBe(400)
  return ((await response.json()) as { reason: unknown }).reason
}

describe('badRequest reasons', () => {
  it.each([
    ['an outline sheet that is not shared', new SheetAccessError('Private.'), 'sheet_not_shared'],
    ['an outline link that is not a sheet', new SheetLinkError('Bad link.'), 'sheet_link'],
    ['an outline that does not parse', new OutlineParseError('No header.'), 'input'],
    ['a missing upload', new BadInputError('No file.'), 'input'],
    ['an ELD file that does not parse', new EldParseError('No header.'), 'eld_file'],
    [
      'an ELD sheet that is not shared',
      new EldSheetError(new SheetAccessError('Private.')),
      'eld_sheet_not_shared',
    ],
    ['an ELD link that is not a sheet', new EldSheetError(new SheetLinkError('Bad.')), 'eld_link'],
  ])('names %s', async (_name, error, reason) => {
    expect(await reasonOf(error)).toBe(reason)
  })

  it('rethrows anything that is not bad input', () => {
    expect(() => badRequest(new Error('boom'))).toThrow('boom')
  })
})
