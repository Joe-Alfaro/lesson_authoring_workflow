import { firstPageRange } from '../import/import_service'

/**
 * How a lesson is named before it has a generated title: the description's first line plus its
 * page range, as the dashboard mockups draw it ("Chapter 1, pp. 1–8").
 */
export function outlineTitle(description: string): string {
  const firstLine = description.split('\n')[0]?.trim() ?? ''
  const pages = firstPageRange(description)
  if (!pages || firstPageRange(firstLine)) {
    return firstLine
  }
  return `${firstLine}, ${pages}`
}
