// Start generation (R12), Cancel run and Regenerate (R11) dialogs. Mockups:
// docs/design/lesson-authoring/R12-start-generation.html, R11-cancel-run.html and
// R11-regenerate-confirm.html.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../../../tests/component_axe'
import { CancelRunDialog } from './cancel_run_dialog'
import { RegenerateDialog } from './regenerate_dialog'
import { StartGenerationDialog } from './start_generation_dialog'

/** The value next to a term in a description list. */
function termValue(scope: HTMLElement, term: string): HTMLElement {
  const dt = within(scope)
    .getAllByRole('term')
    .find((element) => element.textContent?.trim() === term)
  if (!dt) {
    throw new Error(`No term "${term}"`)
  }
  return dt.nextElementSibling as HTMLElement
}

function renderStart(overrides: Partial<Parameters<typeof StartGenerationDialog>[0]> = {}) {
  const onStart = vi.fn()
  const onClose = vi.fn()
  const view = render(
    <StartGenerationDialog
      lessonCount={41}
      modelLabel="Haiku-class"
      promptVersion={3}
      promptHref="/units/u1/prompt"
      estimatedUsd={0.5084}
      capUsd={5}
      concurrency={4}
      onStart={onStart}
      onClose={onClose}
      {...overrides}
    />,
  )
  return { ...view, onStart, onClose }
}

describe('StartGenerationDialog', () => {
  it('shows the scope, model, prompt, real estimate and cap, and concurrency read-only', async () => {
    const { container } = renderStart()
    const dialog = screen.getByRole('dialog', { name: 'Generate lessons' })
    expect(dialog).toHaveTextContent(
      'Lessons are generated in the background. You can close the browser; the run keeps going.',
    )
    expect(within(dialog).getByRole('radio', { name: 'All 41 numbered lessons' })).toBeChecked()
    expect(within(dialog).getByRole('radio', { name: 'Selected lessons' })).not.toBeChecked()
    expect(dialog).toHaveTextContent(
      "Flex days aren't included. Generate a flex day from its row when you need one.",
    )
    expect(dialog).toHaveTextContent('Haiku-class (low cost, default)')
    expect(dialog).toHaveTextContent('v3')
    expect(within(dialog).getByRole('link', { name: 'View prompt' })).toHaveAttribute(
      'href',
      '/units/u1/prompt',
    )
    expect(termValue(dialog, 'Estimated cost for 41 lessons')).toHaveTextContent('$0.51')
    expect(termValue(dialog, 'Spend cap for this run')).toHaveTextContent('$5.00')
    expect(termValue(dialog, 'Concurrency')).toHaveTextContent('4')
    expect(within(dialog).queryByRole('spinbutton')).toBeNull()
    expect(dialog).toHaveTextContent(
      'The estimate is the number of lessons times the expected cost of one lesson on this model. If the run reaches the cap, no new lessons start and finished ones are kept.',
    )
    expect(dialog.textContent).not.toContain('{{')
    await expectNoAxeViolations(container)
  })

  it('starts on Cancel, keeps Tab inside, closes on Escape and starts on "Start generation"', async () => {
    const user = userEvent.setup()
    const { onStart, onClose } = renderStart()
    const dialog = screen.getByRole('dialog', { name: 'Generate lessons' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    for (let i = 0; i < 10; i += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Start generation' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })
})

describe('CancelRunDialog', () => {
  it('says what stops and what is kept, and starts on Keep running', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    const { container } = render(
      <CancelRunDialog
        queued={20}
        generating={4}
        generated={15}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )
    const dialog = screen.getByRole('alertdialog', { name: 'Cancel this run?' })
    expect(dialog).toHaveTextContent(
      "The 20 queued lessons won't start. The 4 lessons being generated will finish and be kept, along with the 15 generated lessons. You can generate the rest later.",
    )
    expect(within(dialog).getByRole('button', { name: 'Keep running' })).toHaveFocus()
    await expectNoAxeViolations(container)

    await user.click(within(dialog).getByRole('button', { name: 'Keep running' }))
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe('RegenerateDialog', () => {
  it('names the lessons, the ones with human edits, the real estimate and that assignments stay', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const { container } = render(
      <RegenerateDialog
        lessonNumbers={[12, 15, 17]}
        editedLessonNumbers={[12, 15]}
        promptVersion={4}
        estimatedUsd={0.0372}
        onConfirm={onConfirm}
        onClose={() => {}}
      />,
    )
    const dialog = screen.getByRole('alertdialog', { name: 'Regenerate 3 lessons with prompt v4?' })
    expect(dialog).toHaveTextContent(
      'Lessons 12, 15 and 17 will be written again from their outline rows.',
    )
    expect(dialog).toHaveTextContent(
      'Lessons 12 and 15 have human edits. Their current content is saved as a version first, so you can restore it from version history.',
    )
    expect(dialog).toHaveTextContent(
      'Estimated cost $0.04. Each lesson returns to Draft when it finishes; reviewers keep their assignments.',
    )
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await expectNoAxeViolations(container)

    await user.click(within(dialog).getByRole('button', { name: 'Regenerate 3 lessons' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('has no human-edits paragraph when no selected lesson was edited', () => {
    render(
      <RegenerateDialog
        lessonNumbers={[20, 21]}
        editedLessonNumbers={[]}
        promptVersion={4}
        estimatedUsd={0.0248}
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    )
    const dialog = screen.getByRole('alertdialog', { name: 'Regenerate 2 lessons with prompt v4?' })
    expect(dialog).toHaveTextContent(
      'Lessons 20 and 21 will be written again from their outline rows.',
    )
    expect(dialog).not.toHaveTextContent('human edits')
  })
})
