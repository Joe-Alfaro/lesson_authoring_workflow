// Version and history times: "today 13:52", "yesterday 09:10" or "Oct 25, 13:52" (local time).

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

function clock(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
}

/** "today 13:52" (or "Today 13:52" with `capital`). */
export function formatWhen(iso: string, { capital = false } = {}): string {
  const date = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  let day: string
  if (sameDay(date, now)) day = capital ? 'Today' : 'today'
  else if (sameDay(date, yesterday)) day = capital ? 'Yesterday' : 'yesterday'
  else day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ','
  return `${day} ${clock(date)}`
}

/** "13:52" today, "Oct 25, 13:52" on other days (the restore dialog title). */
export function formatShort(iso: string): string {
  const date = new Date(iso)
  return sameDay(date, new Date()) ? clock(date) : formatWhen(iso)
}
