// R10 spec, Accessibility: "A Save or Discard prompt appears when leaving the page with unsaved
// changes." Leaving by an in-app link asks first; Stay keeps the edits.
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROMPT_TEMPLATE } from '../../generation/prompt_template'
import { PromptEditor } from './prompt_editor'

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

function renderEditor() {
  return render(
    <>
      <a href="/my-lessons">My lessons</a>
      <PromptEditor
        unit={{ id: 'u1', unitNumber: 4, heading: 'Unit 4: Placeholder' }}
        currentVersion={1}
        viewingVersion={1}
        versions={[
          {
            id: 'v1',
            version: 1,
            template: DEFAULT_PROMPT_TEMPLATE,
            savedBy: 'Author 01',
            savedAt: '2026-10-25T10:00:00.000Z',
            lessonNumbers: [],
            lessonCount: 0,
          },
        ]}
        now="2026-10-25T12:00:00.000Z"
      />
    </>,
  )
}

/** Types into a plain-text editable area the way the browser reports it (input event). */
function edit(name: string, text: string) {
  const box = screen.getByRole('textbox', { name })
  box.textContent = text
  fireEvent.input(box)
}

describe('PromptEditor: leaving with unsaved changes', () => {
  beforeEach(() => {
    push.mockReset()
    refresh.mockReset()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ id: 'v2', version: 2 }, { status: 201 })),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('leaves without asking when nothing changed', async () => {
    renderEditor()
    await userEvent.click(screen.getByRole('link', { name: 'My lessons' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks Save, Discard or Stay; Stay keeps the edits and the page', async () => {
    const user = userEvent.setup()
    renderEditor()
    edit('System instructions', 'Edited system instructions.')
    await user.click(screen.getByRole('link', { name: 'My lessons' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Save your changes to the prompt?' })
    expect(within(dialog).getByRole('button', { name: 'Stay' })).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: 'Discard changes' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Save as v2' })).toBeVisible()

    await user.click(within(dialog).getByRole('button', { name: 'Stay' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'System instructions' })).toHaveTextContent(
      'Edited system instructions.',
    )
  })

  it('Discard leaves without saving', async () => {
    const user = userEvent.setup()
    renderEditor()
    edit('System instructions', 'Edited system instructions.')
    await user.click(screen.getByRole('link', { name: 'My lessons' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }))
    expect(push).toHaveBeenCalledWith('/my-lessons')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('Save saves the next version, then leaves', async () => {
    const user = userEvent.setup()
    renderEditor()
    edit('System instructions', 'Edited system instructions.')
    await user.click(screen.getByRole('link', { name: 'My lessons' }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Save as v2' }))
    expect(fetch).toHaveBeenCalledWith(
      '/api/units/u1/prompt-versions',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body)) as {
      template: { system: string }
    }
    expect(body.template.system).toBe('Edited system instructions.')
    expect(push).toHaveBeenCalledWith('/my-lessons')
  })
})
