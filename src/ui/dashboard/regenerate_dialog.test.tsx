import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RegenerateDialog } from './regenerate_dialog'

describe('RegenerateDialog for one lesson', () => {
  it('uses the singular', () => {
    render(
      <RegenerateDialog
        lessonNumbers={[30]}
        editedLessonNumbers={[30]}
        promptVersion={2}
        estimatedUsd={0.0124}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    )
    const dialog = screen.getByRole('alertdialog', { name: 'Regenerate lesson 30 with prompt v2?' })
    expect(dialog).toHaveTextContent('Lesson 30 will be written again from its outline row.')
    expect(dialog).toHaveTextContent(
      'Lesson 30 has human edits. Its current content is saved as a version first',
    )
    expect(dialog).toHaveTextContent('Each lesson returns to Draft')
  })
})
