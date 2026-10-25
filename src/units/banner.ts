/** The anchor text's author from the banner's first line ("G6, U4: <title> by <author>"). */
export function bannerAuthor(banner: string): string | null {
  const firstLine = banner.split('\n')[0] ?? ''
  return firstLine.match(/\s+by\s+(.+)$/i)?.[1]?.trim() ?? null
}
