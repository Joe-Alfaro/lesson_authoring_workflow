import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PromptProvenance, promptProvenanceText } from './prompt_provenance'

describe('PromptProvenance', () => {
  it('names the prompt version and the model class the lesson was generated with', () => {
    render(<PromptProvenance generation={{ promptVersion: 3, model: 'claude-haiku-5-5' }} />)
    expect(screen.getByText('Prompt v3, Haiku-class')).toBeInTheDocument()
  })

  it('shows an unknown model id as is', () => {
    expect(promptProvenanceText({ promptVersion: 1, model: 'test-model' })).toBe(
      'Prompt v1, test-model',
    )
  })

  it('says when the lesson was never generated', () => {
    render(<PromptProvenance generation={null} />)
    expect(screen.getByText('Not generated yet')).toBeInTheDocument()
  })
})
