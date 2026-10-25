/**
 * Minimal RFC 4180 reader: quoted fields may hold commas, doubled quotes and line breaks. Accepts
 * CRLF and LF line endings and a leading byte-order mark. Cells are returned as written (no trim).
 */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith('﻿') ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let index = 0

  while (index < source.length) {
    const char = source[index]!
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"'
        index += 2
        continue
      }
      if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      index += 1
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') {
        index += 1
      }
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
    index += 1
  }
  if (field !== '' || row.length > 0) {
    rows.push([...row, field])
  }
  return rows
}

/**
 * Trims a cell and turns every U+00A0 (the sample outline uses it as filler, also mid-cell) into a
 * normal space (D-028).
 */
export function cleanCell(value: string | undefined): string {
  return (value ?? '').replace(/\u00a0/g, ' ').trim()
}
