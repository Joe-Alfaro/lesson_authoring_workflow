// Collab document names (`lesson:<id>`), shared by the editor, the collab server and the workflow.
const DOCUMENT_PREFIX = 'lesson:'

export function lessonDocumentName(lessonId: string): string {
  return `${DOCUMENT_PREFIX}${lessonId}`
}

/** The lesson id of a `lesson:<id>` document name, or null for any other name. */
export function lessonIdOf(documentName: string): string | null {
  return documentName.startsWith(DOCUMENT_PREFIX)
    ? documentName.slice(DOCUMENT_PREFIX.length)
    : null
}
