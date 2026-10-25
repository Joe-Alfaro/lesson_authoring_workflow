// Extracts grade 6 CA CCSS for ELA/Literacy from the CDE PDF into JSON.
// Usage: node scripts/standards/extract_ccss.mjs <finalelaccssstandards.pdf> <out.json>
import { writeFileSync } from 'node:fs'
import { findPhrase, joinLines, pageWords, toLines } from './pdf_words.mjs'

// PDF page numbers (1-based, not the printed page labels) holding the grade 6 column of
// each strand, with a title phrase that must appear on the page as a sanity check.
const SECTIONS = [
  {
    strand: 'RL',
    prefix: 'RL.6',
    title: 'Reading Standards for Literature',
    pages: [53, 54],
    header: 'Grade 6 Students',
  },
  {
    strand: 'RI',
    prefix: 'RI.6',
    title: 'Reading Standards for Informational Text',
    pages: [57, 58],
    header: 'Grade 6 Students',
  },
  {
    strand: 'W',
    prefix: 'W.6',
    title: 'Writing Standards 6–12',
    pages: [62, 63, 64, 65, 66],
    header: 'Grade 6 Students',
  },
  {
    strand: 'SL',
    prefix: 'SL.6',
    title: 'Speaking and Listening Standards',
    pages: [72, 73],
    header: 'Grade 6 Students',
  },
  {
    strand: 'L',
    prefix: 'L.6',
    title: 'Language Standards 6–12',
    pages: [77, 78, 79],
    header: 'Grade 6 Students',
  },
  {
    strand: 'RH',
    prefix: 'RH.6-8',
    title: 'Reading Standards for Literacy in History/Social Studies',
    pages: [87, 88],
    header: 'Grade 6–8 Students',
  },
  {
    strand: 'RST',
    prefix: 'RST.6-8',
    title: 'Reading Standards for Literacy in Science and Technical Subjects',
    pages: [89, 90],
    header: 'Grade 6–8 Students',
  },
]

const STRAND_NAMES = {
  RL: 'Reading Standards for Literature',
  RI: 'Reading Standards for Informational Text',
  W: 'Writing',
  SL: 'Speaking and Listening',
  L: 'Language',
  RH: 'Reading Standards for Literacy in History/Social Studies',
  RST: 'Reading Standards for Literacy in Science and Technical Subjects',
}

const MARKER = /^(\d+|[a-z])\.$/

/** Returns the text lines of the first (grade 6 or grade 6–8) column of a page. */
function firstColumnLines(pdf, page, section) {
  const words = pageWords(pdf, page)
  const titleWords = findPhrase(words, section.title.split(' ').slice(0, 3).join(' '))
  if (!titleWords) throw new Error(`page ${page}: title "${section.title}" not found`)
  // Page 62 overprints its header ("Grade66Students"), so fall back to the first "Students".
  const header =
    findPhrase(words, section.header) ??
    words
      .filter(
        (s) =>
          s.text === 'Students' &&
          words.some(
            (g) => g.text === 'Grade' && Math.abs(g.yMin - s.yMin) < 3 && s.xMin - g.xMax < 60,
          ),
      )
      .sort((a, b) => a.xMin - b.xMin)
      .slice(0, 1)
  if (!header.length) throw new Error(`page ${page}: header "${section.header}" not found`)
  const top = Math.max(...header.map((w) => w.yMax))
  const footer = words.filter((w) => w.text === '|' && w.yMin > 500)
  const bottom = footer.length ? Math.min(...footer.map((w) => w.yMin)) - 2 : Infinity
  const body = words.filter((w) => w.yMin > top && w.yMin < bottom)

  const headerRight = Math.max(...header.map((w) => w.xMax))
  const markers = body.filter((w) => MARKER.test(w.text))
  const left = Math.min(...markers.filter((w) => w.xMin < headerRight).map((w) => w.xMin)) - 20
  const right = Math.min(...markers.filter((w) => w.xMin > headerRight).map((w) => w.xMin)) - 2
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    throw new Error(`page ${page}: could not find column bounds`)
  }
  const column = body.filter((w) => w.xMin >= left && w.xMax <= right + 4 && w.xMin < right)
  return toLines(column).map((l) => l.words.map((w) => w.text))
}

function extract(pdf) {
  const out = []
  for (const section of SECTIONS) {
    let current = null // { code, lines }
    let parentNumber = null
    const items = []
    for (const page of section.pages) {
      for (const tokens of firstColumnLines(pdf, page, section)) {
        const m = tokens[0].match(MARKER)
        if (m && /^\d+$/.test(m[1])) {
          parentNumber = m[1]
          current = {
            code: `${section.prefix}.${parentNumber}`,
            lines: [tokens.slice(1).join(' ')],
          }
          items.push(current)
        } else if (m && parentNumber) {
          current = {
            code: `${section.prefix}.${parentNumber}.${m[1]}`,
            lines: [tokens.slice(1).join(' ')],
          }
          items.push(current)
        } else if (current) {
          current.lines.push(tokens.join(' '))
        }
      }
    }
    for (const item of items) {
      let text = joinLines(item.lines)
      const caAddition = /\sCA$/.test(text)
      text = text.replace(/\s*CA$/, '')
      const languageProgressiveSkill = /\*$/.test(text)
      text = text.replace(/\*$/, '')
      if (/^\(Not applicable/.test(text)) continue
      const entry = {
        code: item.code,
        framework: 'CCSS_ELA',
        grade: 6,
        strand: section.strand,
        strand_name: STRAND_NAMES[section.strand],
        text,
      }
      if (section.prefix.includes('6-8')) entry.grade_band = '6-8'
      if (/\.[a-z]$/.test(item.code)) {
        entry.parent_code = item.code.replace(/\.[a-z]$/, '')
      }
      if (caAddition) entry.ca_addition = true
      if (languageProgressiveSkill) entry.language_progressive_skill = true
      out.push(entry)
    }
  }
  return out
}

const [pdf, outPath] = process.argv.slice(2)
if (!pdf || !outPath) {
  console.error('usage: node extract_ccss.mjs <ccss.pdf> <out.json>')
  process.exit(2)
}
const standards = extract(pdf)
writeFileSync(outPath, JSON.stringify(standards, null, 2) + '\n')
console.log(`wrote ${standards.length} standards to ${outPath}`)
