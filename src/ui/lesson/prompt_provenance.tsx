import { modelLabel } from '../dashboard/format'

export interface Provenance {
  promptVersion: number
  model: string
}

/** "Prompt v3, Haiku-class": the prompt version and model a lesson was generated with (R10). */
export function promptProvenanceText(provenance: Provenance): string {
  return `Prompt v${provenance.promptVersion}, ${modelLabel(provenance.model)}`
}

/**
 * The lesson bar's provenance (every editor mockup). Pass `getLessonGeneration(...)`; null means
 * the lesson has no generated content yet.
 */
export function PromptProvenance({ generation }: { generation: Provenance | null }) {
  return (
    <span className="provenance caption">
      {generation ? promptProvenanceText(generation) : 'Not generated yet'}
    </span>
  )
}
