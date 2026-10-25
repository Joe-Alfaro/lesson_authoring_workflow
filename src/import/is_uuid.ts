const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ids come from URLs; checking the shape first turns a malformed id into "not found". */
export function isUuid(value: string): boolean {
  return UUID.test(value)
}
