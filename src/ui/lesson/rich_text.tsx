import { Fragment } from 'react'
import { parseInline } from '../../editor/inline'

/** Lesson text with **bold** and *italic* rendered as <strong> and <em>. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((node, index) => {
        const marks = new Set((node.marks ?? []).map((mark) => mark.type))
        let content: React.ReactNode = node.text
        if (marks.has('italic')) content = <em>{content}</em>
        if (marks.has('bold')) content = <strong>{content}</strong>
        return <Fragment key={index}>{content}</Fragment>
      })}
    </>
  )
}
