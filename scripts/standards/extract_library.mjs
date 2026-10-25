// Extracts grade 6 of the Model School Library Standards for California Public Schools
// (the codes the sample outline lists under "CA Media Literacy Standards", e.g. "2.1.a").
// Usage: node scripts/standards/extract_library.mjs <librarystandards.pdf> <out.json>
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { joinLines } from './pdf_words.mjs'

const STANDARD_NAMES = {
  1: 'Students access information.',
  2: 'Students evaluate information.',
  3: 'Students use information.',
  4: 'Students integrate information literacy skills into all areas of learning.',
}

function extract(pdf) {
  const text = execFileSync('pdftotext', ['-layout', pdf, '-'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  })
  const lines = text.split('\n')
  // The grade 6 section runs from the "Grade Six" heading (after the table of contents) to
  // the "Grades Seven and Eight" heading.
  const start = lines.findIndex((l, i) => /^\s*Grade Six\s*$/.test(l) && i > 200)
  const end = lines.findIndex((l, i) => i > start && /^\s*Grades Seven\s*$/.test(l))
  if (start < 0 || end < 0) throw new Error('grade 6 section not found')

  const items = []
  let current = null
  for (const raw of lines.slice(start + 1, end)) {
    const line = raw.trim()
    const std = line.match(/^([1-4]\.\d)\s+(.*)$/)
    const sub = line.match(/^([a-z])\.\s+(.*)$/)
    if (std) {
      current = { code: std[1], lines: [std[2]] }
      items.push(current)
    } else if (sub && current) {
      const parent = current.parent ?? current.code
      current = { code: `${parent}.${sub[1]}`, parent, lines: [sub[2]] }
      items.push(current)
    } else if (!line || /^(\d+|grade Six)$/i.test(line)) {
      // Blank lines, page numbers and running heads: an item may continue on the next page.
    } else if (/^(STANDARD|[1-4]\s|Students |The student will)/.test(line)) {
      current = null // standard banner and its intro sentence
    } else if (current) {
      current.lines.push(line)
    }
  }
  return items.map((item) => {
    const standardNumber = item.code[0]
    const entry = {
      code: `LIB.6.${item.code}`,
      outline_code: item.code,
      framework: 'CA_SCHOOL_LIBRARY',
      grade: 6,
      strand: `Standard ${standardNumber}`,
      strand_name: STANDARD_NAMES[standardNumber],
      text: joinLines(item.lines).replace(/:$/, ''),
    }
    if (item.parent) entry.parent_code = `LIB.6.${item.parent}`
    return entry
  })
}

const [pdf, outPath] = process.argv.slice(2)
if (!pdf || !outPath) {
  console.error('usage: node extract_library.mjs <librarystandards.pdf> <out.json>')
  process.exit(2)
}
const standards = extract(pdf)
writeFileSync(outPath, JSON.stringify(standards, null, 2) + '\n')
console.log(`wrote ${standards.length} standards to ${outPath}`)
