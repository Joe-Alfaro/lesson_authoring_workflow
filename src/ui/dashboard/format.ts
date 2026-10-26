// Formatting shared by the unit dashboard, the start dialog and the prompt editor.

const MODEL_CLASSES: [RegExp, string][] = [
  [/haiku/i, 'Haiku-class'],
  [/sonnet/i, 'Sonnet-class'],
  [/opus/i, 'Opus-class'],
]

/** "$0.51": dollars with two decimals (D-027: real values, never placeholders). */
export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`
}

/** "claude-haiku-5-5" -> "Haiku-class"; an unknown model id is shown as is. */
export function modelLabel(model: string): string {
  return MODEL_CLASSES.find(([pattern]) => pattern.test(model))?.[1] ?? model
}

/** "lesson" or "lessons" with the count in front: "1 lesson", "3 lessons". */
export function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "12, 15 and 18". */
export function joinAnd(items: (string | number)[]): string {
  const words = items.map(String)
  if (words.length <= 1) {
    return words.join('')
  }
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** "Lesson 15" or "Lessons 12, 15 and 18". */
export function lessonNumbersText(numbers: number[]): string {
  return `${numbers.length === 1 ? 'Lesson' : 'Lessons'} ${joinAnd(numbers)}`
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

/** "10:42" in the viewer's clock. */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false })
}

/** "today at 10:31", "yesterday at 16:40" or "Oct 21 at 9:05". */
export function formatDayTime(date: Date, now: Date): string {
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(date, now)) {
    return `today at ${formatClock(date)}`
  }
  if (sameDay(date, yesterday)) {
    return `yesterday at ${formatClock(date)}`
  }
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${day} at ${formatClock(date)}`
}

/** The table's Updated column: "Just now", "6 min ago", "1 h ago", "Today 9:12", "Yesterday". */
export function formatUpdated(date: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000)
  if (minutes < 1) {
    return 'Just now'
  }
  if (minutes < 60) {
    return `${minutes} min ago`
  }
  if (minutes < 120) {
    return '1 h ago'
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(date, now)) {
    return `Today ${formatClock(date)}`
  }
  if (sameDay(date, yesterday)) {
    return 'Yesterday'
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
