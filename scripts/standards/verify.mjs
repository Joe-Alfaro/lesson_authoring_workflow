// Checks that every standard code in the sample outline resolves in data/standards/*.json.
// Usage: node scripts/standards/verify.mjs [lesson_outline.csv]
// Exits 1 if a code is unresolved and not listed under KNOWN_UNRESOLVED (documented in
// data/standards/README.md).
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const csvPath = process.argv[2] ?? join(root, 'data', 'sample_unit', 'lesson_outline.csv')
const standardsDir = join(root, 'data', 'standards')

// Codes the outline uses that do not exist in the official grade 6 documents.
const KNOWN_UNRESOLVED = new Set(['RL.6.9.a'])

const COLUMNS = {
  'Focus Standards (assessed)': 'ela',
  'Additional Supported CA ELA Standards': 'ela',
  'CA Media Literacy Standards': 'library',
  'Designated ELD Standards': 'eld',
}

/** Minimal RFC 4180 parser (quoted fields may contain commas, quotes and newlines). */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) rows.push([...row, field])
  return rows
}

const letters = (from, to) =>
  Array.from({ length: to.charCodeAt(0) - from.charCodeAt(0) + 1 }, (_, i) =>
    String.fromCharCode(from.charCodeAt(0) + i),
  )

/** ELA cell -> codes. "RL.6.1, 6.2 L.6.4" -> RL.6.1, RL.6.2, L.6.4; "W.6.2.a–f" -> W.6.2.a..f. */
function elaCodes(cell, problems) {
  const codes = []
  let strand = null
  for (const token of cell.split(/[\s,;]+/).filter(Boolean)) {
    const full = token.match(/^([A-Z]+)\.(\d+)\.(\d+)(?:\.([a-z])(?:[–-]([a-z]))?)?$/)
    const short = token.match(/^(\d+)\.(\d+)(?:\.([a-z]))?$/)
    if (full) {
      const [, s, grade, num, from, to] = full
      strand = s
      const base = `${s}.${grade}.${num}`
      if (!from) codes.push(base)
      else for (const l of letters(from, to ?? from)) codes.push(`${base}.${l}`)
    } else if (short && strand) {
      codes.push(`${strand}.${short[1]}.${short[2]}${short[3] ? `.${short[3]}` : ''}`)
    } else {
      problems.push(`unparsed token "${token}" in "${cell}"`)
    }
  }
  return codes
}

/** "2.1.a, 2.1.b" (Model School Library Standards) -> LIB.6.2.1.a, LIB.6.2.1.b. */
function libraryCodes(cell, problems) {
  const codes = []
  for (const token of cell.split(/[\s,;]+/).filter(Boolean)) {
    if (/^\d\.\d(\.[a-z])?$/.test(token)) codes.push(`LIB.6.${token}`)
    else problems.push(`unparsed token "${token}" in "${cell}"`)
  }
  return codes
}

/** "• ELD.PI.6.6 – Exchange information..." -> ELD.PI.6.6. */
function eldCodes(cell, problems) {
  const codes = []
  for (const line of cell
    .split('\n')
    .map((l) => l.replace(/^[•\s]+/, '').trim())
    .filter(Boolean)) {
    const m = line.match(/^(ELD\.PI{1,2}\.\d+\.\d+(?:\.[a-z])?)(?:\s*[–-]\s.*)?$/)
    if (m) codes.push(m[1])
    else problems.push(`unparsed ELD entry "${line}"`)
  }
  return codes
}

const known = new Map()
for (const file of readdirSync(standardsDir).filter((f) => f.endsWith('.json'))) {
  for (const s of JSON.parse(readFileSync(join(standardsDir, file), 'utf8'))) {
    if (known.has(s.code)) throw new Error(`duplicate code ${s.code} in ${file}`)
    known.set(s.code, file)
  }
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'))
const header = rows[1] // row 1 is a banner
const problems = []
const used = new Map() // code -> count
for (const row of rows.slice(2)) {
  for (const [name, kind] of Object.entries(COLUMNS)) {
    const idx = header.indexOf(name)
    if (idx < 0) throw new Error(`column "${name}" not found`)
    const cell = (row[idx] ?? '').trim()
    if (!cell) continue
    const parse = { ela: elaCodes, library: libraryCodes, eld: eldCodes }[kind]
    for (const code of parse(cell, problems)) used.set(code, (used.get(code) ?? 0) + 1)
  }
}

const resolved = [...used.keys()].filter((c) => known.has(c))
const missing = [...used.keys()].filter((c) => !known.has(c))
const unexpected = missing.filter((c) => !KNOWN_UNRESOLVED.has(c))

console.log(`standards loaded: ${known.size} codes from ${standardsDir}`)
console.log(
  `outline codes: ${used.size} distinct, ${resolved.length} resolved, ${missing.length} unresolved`,
)
for (const code of missing) {
  const note = KNOWN_UNRESOLVED.has(code) ? 'known, see data/standards/README.md' : 'UNEXPECTED'
  console.log(`  unresolved: ${code} (used ${used.get(code)}x; ${note})`)
}
for (const p of problems) console.log(`  parse problem: ${p}`)
if (unexpected.length || problems.length) process.exit(1)
console.log('OK')
