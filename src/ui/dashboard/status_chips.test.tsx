import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../../../tests/component_axe'
import { StatusChips } from './status_chips'

const REVIEW_COUNTS = {
  generating: 0,
  draft: 24,
  in_review: 9,
  changes_requested: 2,
  approved: 5,
  failed: 1,
}

describe('StatusChips', () => {
  it('shows one toggle per non-zero status, in workflow order', async () => {
    const { container } = render(
      <StatusChips counts={REVIEW_COUNTS} pressed={[]} onToggle={() => {}} />,
    )
    const group = screen.getByRole('group', { name: 'Lessons per status' })
    const chips = within(group).getAllByRole('button')
    expect(chips.map((chip) => chip.getAttribute('aria-label') ?? chip.textContent)).toEqual([
      'Draft: 24 lessons, filter',
      'In review: 9 lessons, filter',
      'Changes requested: 2 lessons, filter',
      'Approved: 5 lessons, filter',
      'Failed: 1 lessons, filter',
    ])
    chips.forEach((chip) => expect(chip).toHaveAttribute('aria-pressed', 'false'))
    await expectNoAxeViolations(container)
  })

  it('marks the pressed statuses and reports a toggle', async () => {
    const onToggle = vi.fn()
    render(<StatusChips counts={REVIEW_COUNTS} pressed={['in_review']} onToggle={onToggle} />)
    const inReview = screen.getByRole('button', { name: 'In review: 9 lessons, filter' })
    expect(inReview).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Approved: 5 lessons, filter' }))
    expect(onToggle).toHaveBeenCalledWith('approved')
  })

  it('shows only Approved when the unit is complete', () => {
    render(
      <StatusChips
        counts={{
          generating: 0,
          draft: 0,
          in_review: 0,
          changes_requested: 0,
          approved: 41,
          failed: 0,
        }}
        pressed={[]}
        onToggle={() => {}}
      />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Approved: 41 lessons, filter' })).toBeVisible()
  })
})
