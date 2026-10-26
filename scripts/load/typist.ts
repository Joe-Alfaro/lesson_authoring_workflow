// Types into a lesson's Yjs document the way a reviewer's editor does: one transaction per
// keystroke at a cursor that follows the typist's own text (a relative position), so two people
// typing in the same paragraph each keep their words together, as in the browser (R18).
import * as Y from 'yjs'
import { LESSON_FRAGMENT } from '../../src/editor/ydoc'

function firstText(element: Y.XmlElement): Y.XmlText | null {
  return element.toArray().find((child): child is Y.XmlText => child instanceof Y.XmlText) ?? null
}

/**
 * The text of the lesson's first paragraph block (a body paragraph the reviewer would edit), or
 * the first non-empty text field when the lesson has no paragraph block.
 */
export function findTypingTarget(doc: Y.Doc): Y.XmlText {
  let fallback: Y.XmlText | null = null
  let paragraph: Y.XmlText | null = null
  const walk = (node: Y.XmlElement | Y.XmlFragment): void => {
    for (const child of node.toArray()) {
      if (paragraph) return
      if (!(child instanceof Y.XmlElement)) continue
      if (child.nodeName === 'block_paragraph') {
        const field = child
          .toArray()
          .find((f): f is Y.XmlElement => f instanceof Y.XmlElement && f.nodeName === 'field_text')
        const text = field ? firstText(field) : null
        if (text) {
          paragraph = text
          return
        }
      }
      if (!fallback && child.nodeName === 'field_text') fallback = firstText(child)
      walk(child)
    }
  }
  walk(doc.getXmlFragment(LESSON_FRAGMENT))
  const target = paragraph ?? fallback
  if (!target) throw new Error('The lesson has no text to type into')
  return target
}

export class Typist {
  private cursor: Y.RelativePosition | null = null

  constructor(
    private readonly doc: Y.Doc,
    private readonly text: Y.XmlText,
  ) {}

  private index(): number {
    if (!this.cursor) return this.text.length
    const absolute = Y.createAbsolutePositionFromRelativePosition(this.cursor, this.doc)
    return absolute ? absolute.index : this.text.length
  }

  private placeAfter(index: number): void {
    // assoc -1: the cursor sticks to the character on its left (the typist's own last one).
    this.cursor =
      index === 0
        ? Y.createRelativePositionFromTypeIndex(this.text, 0, 0)
        : Y.createRelativePositionFromTypeIndex(this.text, index, -1)
  }

  /** One keystroke: one character at the cursor. */
  type(char: string): void {
    const at = this.index()
    this.doc.transact(() => this.text.insert(at, char))
    this.placeAfter(at + char.length)
  }

  /** Backspace: deletes the character before the cursor. */
  backspace(): void {
    const at = this.index()
    if (at === 0) return
    this.doc.transact(() => this.text.delete(at - 1, 1))
    this.placeAfter(at - 1)
  }

  /** The cursor as a JSON relative position (what the caret extension puts in awareness). */
  cursorJson(): unknown {
    return this.cursor ? Y.relativePositionToJSON(this.cursor) : null
  }
}
