// Front matter `texts` from the outline row (R7, Lesson structure item 1; D-039 (3)).
import type { LessonFrontMatter } from '../lesson/schema'

type LessonText = LessonFrontMatter['texts'][number]

/** The author from a banner like "G6, U4: <anchor text> by <author>" (the last " by "). */
export function authorFromBanner(banner: string): string | null {
  const firstLine = banner.split('\n')[0] ?? ''
  return firstLine.match(/^.*\s+by\s+(.+)$/i)?.[1]?.trim() || null
}

/** The first page range ("pp. 16–22") in a lesson description, verbatim. */
function pageRange(description: string): string | undefined {
  return description.match(/\bpp\.\s*\d+\s*[–-]\s*\d+/)?.[0]
}

const QUOTED = /[“"]([^”"]+)[”"]/

function trimPunctuation(text: string): string {
  return text.trim().replace(/[\s,.;:]+$/, '')
}

/**
 * One Text Set Choice bullet: a quoted title is the title and the text after " in " that follows
 * it is the source (up to a parenthetical note); without quotes the whole bullet is the title.
 */
function textFromBullet(bullet: string): LessonText {
  const quoted = bullet.match(QUOTED)
  if (!quoted) {
    return { title: bullet, kind: 'short_form' }
  }
  const after = bullet.slice((quoted.index ?? 0) + quoted[0].length)
  const source = after.match(/^\s+in\s+(.+)$/s)?.[1]?.split(/\s\(/)[0]
  return {
    title: trimPunctuation(quoted[1]!),
    ...(source && trimPunctuation(source) ? { source: trimPunctuation(source) } : {}),
    kind: 'short_form',
  }
}

/** The anchor novel (author, page range) and one text per Text Set Choice bullet. */
export function textsFromOutline(input: {
  anchorTextTitle: string
  author: string | null
  description: string
  textSet: string
}): LessonText[] {
  const pages = pageRange(input.description)
  const novel: LessonText = {
    title: input.anchorTextTitle,
    ...(input.author ? { source: input.author } : {}),
    kind: 'novel',
    ...(pages ? { pages } : {}),
  }
  // Lines that are not bullets (a note to the writer, "Independent Reading List") are not texts.
  const bullets = input.textSet
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('•'))
    .map((line) => line.replace(/^•\s*/, '').trim())
    .filter(Boolean)
  return [novel, ...bullets.map(textFromBullet)]
}
