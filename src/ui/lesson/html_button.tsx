'use client'

import { download, lessonExportHref } from '../download'
import { Icon } from './lesson_icons'

/** R16: the lesson as standalone HTML from the export route (one renderer, src/export). */
export function HtmlButton({ lessonId }: { lessonId: string }) {
  return (
    <button
      type="button"
      className="btn sm hide-m"
      onClick={() => download(lessonExportHref(lessonId, 'html'))}
    >
      <Icon name="download" />
      HTML
    </button>
  )
}
