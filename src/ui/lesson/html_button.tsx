'use client'

import { Icon } from './lesson_icons'

const EXPORT_STYLE = `body{font:17px/28px Georgia,serif;color:#1c2430;max-width:760px;margin:40px auto;padding:0 24px}
h1{font-size:32px;line-height:40px}h2{margin-top:32px}.sec-h{border-bottom:3px solid #aeb7c2}
.caption,.kicker,.meta{font:14px/20px system-ui,sans-serif;color:#4a5568}.meta span+span::before{content:" | "}
.chip{display:inline-block;border:1px solid #aeb7c2;border-radius:6px;padding:0 6px;margin:2px;font:600 13px system-ui,sans-serif;background:#fff}
.blk .g{font-weight:700;margin-right:6px}.blk.ex{margin-left:28px;font-style:italic}.blk.ex .g{display:block;font:600 13px system-ui,sans-serif;font-style:normal}
.box{border:1px solid #d5dbe2;border-left:3px solid #4a5568;padding:12px 16px;margin:16px 0}.bt{font-weight:700}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #d5dbe2;padding:8px;text-align:left;vertical-align:top}
.ribbon,.ico,.sw{display:none}dl{display:grid;grid-template-columns:180px 1fr;gap:8px 16px}dd{margin:0}`

/** R16-style download of the lesson as a standalone HTML file, built from the rendered article. */
export function HtmlButton({ fileName, title }: { fileName: string; title: string }) {
  function download() {
    const article = document.querySelector('article.doc')
    if (!article) return
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${EXPORT_STYLE}</style></head><body>${article.outerHTML}</body></html>`
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <button type="button" className="btn sm hide-m" onClick={download}>
      <Icon name="download" />
      HTML
    </button>
  )
}
