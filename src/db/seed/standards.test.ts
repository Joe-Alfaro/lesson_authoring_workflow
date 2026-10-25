import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readStandardsDir } from './standards'

const FIXTURE_DIR = resolve(import.meta.dirname, '../../../tests/fixtures/standards')

describe('readStandardsDir', () => {
  it('reads every JSON file in the directory', async () => {
    const records = await readStandardsDir(FIXTURE_DIR)
    expect(records.map((record) => record.code)).toEqual([
      'RL.6.1',
      'L.6.4',
      'ELD.PI.6.6',
      'LIB.6.2.1.a',
    ])
  })

  it('keeps fields beyond the core ones in details', async () => {
    const records = await readStandardsDir(FIXTURE_DIR)
    expect(records.find((record) => record.code === 'LIB.6.2.1.a')).toEqual({
      code: 'LIB.6.2.1.a',
      framework: 'CA_SCHOOL_LIBRARY',
      grade: 6,
      strand: 'Standard 2',
      text: 'Fixture text for a school library standard.',
      details: { outline_code: '2.1.a', strand_name: 'Fixture strand name.' },
    })
  })

  it('rejects a file that does not match the standards format', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'standards-'))
    await writeFile(join(dir, 'bad.json'), JSON.stringify([{ code: 'RL.6.1', framework: 'X' }]))
    await expect(readStandardsDir(dir)).rejects.toThrow(/Invalid standards file .*bad\.json/)
  })

  it('ignores non-JSON files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'standards-'))
    await writeFile(join(dir, 'notes.txt'), 'not json')
    expect(await readStandardsDir(dir)).toEqual([])
  })
})
