// Extracts grade 6 CA ELD Standards (Parts I and II) from the CDE PDF into JSON.
// Usage: node scripts/standards/extract_eld.mjs <eldstndspublication14.pdf> <out.json>
import { writeFileSync } from 'node:fs'
import { joinLines, pageWords, repairLigatures, toLines } from './pdf_words.mjs'

// PDF page numbers (1-based) for grade 6. Overview: Section 1 lists each standard's general
// description. Continuum: Section 2 has the Emerging/Expanding/Bridging text.
const OVERVIEW_PAGES = [95, 96]
const CONTINUUM_PAGES = [
  { part: 'PI', pages: [97, 98, 99, 100, 101] },
  { part: 'PII', pages: [102, 103, 104] },
]
const LEVELS = ['emerging', 'expanding', 'bridging']
const PART_NAMES = {
  PI: 'Part I: Interacting in Meaningful Ways',
  PII: 'Part II: Learning About How English Works',
}
const NUMBER = /^(\d+)\.$/
const LETTER = /^([a-e])\.?$/

// Arrows ("observe → observation") are drawn as glyphs pdftotext cannot extract; they show up
// as a ~13pt gap between words. One arrow sits at a line end, where no gap is visible.
const ARROW_GAP = [12, 14.5]
const FIXUPS = [
  ['chemical insecticides Organic vegetables', 'chemical insecticides → Organic vegetables'],
]

function withArrows(words) {
  const tokens = [words[0].text]
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].xMin - words[i - 1].xMax
    if (gap >= ARROW_GAP[0] && gap <= ARROW_GAP[1]) tokens.push('→')
    tokens.push(words[i].text)
  }
  return tokens
}

function clean(lines) {
  let text = repairLigatures(joinLines(lines))
  for (const [from, to] of FIXUPS) text = text.replace(from, to)
  return text
}

/** Section 1: general description and sub-strand (A. Collaborative, ...) per standard. */
function overview(pdf) {
  const result = { PI: {}, PII: {} }
  let part = null
  let substrand = null
  let current = null
  for (const page of OVERVIEW_PAGES) {
    const words = pageWords(pdf, page)
    const corresponding = words.find((w) => w.text === 'Corresponding')
    const right = corresponding ? corresponding.xMin - 5 : Infinity
    for (const line of toLines(words.filter((w) => w.xMax < right))) {
      const tokens = line.words.map((w) => w.text)
      const text = tokens.join(' ')
      if (text.startsWith('Part III')) part = null
      else if (text.startsWith('Part II:')) part = 'PII'
      else if (text.startsWith('Part I:')) part = 'PI'
      if (!part) {
        current = null
        continue
      }
      if (/^(\d+|\*.*)$/.test(tokens[0])) {
        current = null // footnote ("1", "*The California English Language Development ...")
      } else if (/^[ABC]\.$/.test(tokens[0])) {
        substrand = clean([text])
        current = null
      } else if (NUMBER.test(tokens[0])) {
        current = {
          number: tokens[0].match(NUMBER)[1],
          substrand,
          lines: [tokens.slice(1).join(' ')],
        }
        result[part][current.number] = current
      } else if (current && !text.startsWith('Part I')) {
        current.lines.push(text)
      }
    }
  }
  for (const part of Object.values(result)) {
    for (const item of Object.values(part)) item.text = clean(item.lines)
  }
  return result
}

/** Splits one cell's lines into a title, the full text, and lettered sub-parts. */
function parseCell(lines) {
  const subs = []
  const body = []
  for (const tokens of lines) {
    const m = tokens[0].match(LETTER)
    // "b Express ..." is printed without its period once; require a capitalized next word.
    if (m && tokens.length > 1 && (tokens[0].endsWith('.') || /^[A-Z]/.test(tokens[1]))) {
      subs.push({ letter: m[1], lines: [tokens.slice(1).join(' ')] })
    } else if (subs.length) {
      subs.at(-1).lines.push(tokens.join(' '))
    } else {
      body.push(tokens.join(' '))
    }
  }
  const sub = Object.fromEntries(subs.map((s) => [s.letter, clean(s.lines)]))
  const text = subs.length
    ? subs.map((s) => `${s.letter}. ${sub[s.letter]}`).join(' ')
    : clean(body)
  return { text, sub }
}

/** Section 2: per level, per standard number, the cell text. */
function continuum(pdf, pages) {
  const cells = {} // number -> level -> { title, lines }
  for (const page of pages) {
    const words = pageWords(pdf, page)
    const headers = LEVELS.map((lvl) => {
      const w = words.find((x) => x.text.toLowerCase() === lvl)
      if (!w) throw new Error(`page ${page}: "${lvl}" header not found`)
      return w
    })
    const top = Math.max(...headers.map((h) => h.yMax))
    const footer = words.filter((w) => /^(Chapter|Grade)$/.test(w.text) && w.yMin > 520)
    const bottom = footer.length ? Math.min(...footer.map((w) => w.yMin)) - 2 : Infinity
    const body = words.filter((w) => w.yMin > top && w.yMin < bottom)
    const numberXs = body.filter((w) => NUMBER.test(w.text)).map((w) => w.xMin)
    // Column left edge: the right-most standard number left of (or at) each level header.
    const lefts = headers.map((h) => Math.max(...numberXs.filter((x) => x <= h.xMin)) - 5)
    if (lefts.some((x) => !Number.isFinite(x)) || new Set(lefts).size !== 3) {
      throw new Error(`page ${page}: could not find level columns`)
    }
    LEVELS.forEach((level, i) => {
      const colWords = body.filter((w) => w.xMin >= lefts[i] && (i === 2 || w.xMin < lefts[i + 1]))
      let current = null
      for (const line of toLines(colWords)) {
        const tokens = withArrows(line.words)
        const m = tokens[0].match(NUMBER)
        if (m) {
          cells[m[1]] ??= {}
          current = cells[m[1]][level] = { title: [tokens.slice(1).join(' ')], lines: [] }
        } else if (
          current &&
          !current.lines.length &&
          /^[a-z]/.test(tokens[0]) &&
          !LETTER.test(tokens[0])
        ) {
          current.title.push(tokens.join(' ')) // wrapped title, e.g. "Supporting opinions and persuading / others"
        } else if (current) {
          current.lines.push(tokens)
        }
      }
    })
  }
  return cells
}

function extract(pdf) {
  const descriptions = overview(pdf)
  const out = []
  for (const { part, pages } of CONTINUUM_PAGES) {
    const cells = continuum(pdf, pages)
    for (const number of Object.keys(cells).sort((a, b) => a - b)) {
      const desc = descriptions[part][number]
      if (!desc) throw new Error(`${part}.${number}: no overview description`)
      const levels = Object.fromEntries(LEVELS.map((l) => [l, parseCell(cells[number][l].lines)]))
      const code = `ELD.${part}.6.${number}`
      const entry = {
        code,
        framework: 'CA_ELD',
        grade: 6,
        strand: part,
        strand_name: PART_NAMES[part],
        substrand: desc.substrand,
        title: clean(cells[number].emerging.title),
        text: desc.text,
      }
      for (const l of LEVELS) entry[l] = levels[l].text
      out.push(entry)
      for (const letter of Object.keys(levels.emerging.sub)) {
        const subEntry = {
          code: `${code}.${letter}`,
          framework: 'CA_ELD',
          grade: 6,
          strand: part,
          strand_name: PART_NAMES[part],
          substrand: desc.substrand,
          parent_code: code,
          title: entry.title,
          text: `${desc.text} (${letter}) ${levels.expanding.sub[letter] ?? levels.emerging.sub[letter]}`,
        }
        for (const l of LEVELS) subEntry[l] = levels[l].sub[letter] ?? null
        out.push(subEntry)
      }
    }
  }
  return out
}

const [pdf, outPath] = process.argv.slice(2)
if (!pdf || !outPath) {
  console.error('usage: node extract_eld.mjs <eld.pdf> <out.json>')
  process.exit(2)
}
const standards = extract(pdf)
writeFileSync(outPath, JSON.stringify(standards, null, 2) + '\n')
console.log(`wrote ${standards.length} standards to ${outPath}`)
