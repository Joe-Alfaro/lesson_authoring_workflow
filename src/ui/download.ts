// R16 downloads: an anchor with `download` lets the browser save the route's file, named by its
// content-disposition header, without leaving the page.

export type ExportFormat = 'json' | 'html'

export function lessonExportHref(lessonId: string, format: ExportFormat): string {
  return `/api/lessons/${encodeURIComponent(lessonId)}/export?format=${format}`
}

export function unitExportHref(unitId: string, format: ExportFormat): string {
  return `/api/units/${encodeURIComponent(unitId)}/export?format=${format}`
}

export function download(href: string): void {
  const link = document.createElement('a')
  link.href = href
  link.download = ''
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
}
