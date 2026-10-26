// Times in the viewer's time zone render only in the browser, so the server's HTML (formatted in
// the server's zone) never disagrees with the client's during hydration (React error #418).
import { render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalDate, LocalTime } from './local_time'

const ISO = '2026-03-11T02:07:00.000Z'

/** Server-renders `ui`, then hydrates that HTML the way the browser does. */
function hydrate(ui: React.ReactElement) {
  const container = document.createElement('div')
  container.innerHTML = renderToString(ui)
  const serverHtml = container.innerHTML
  document.body.appendChild(container)
  render(ui, { container, hydrate: true })
  return { container, serverHtml }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LocalTime', () => {
  it('leaves the text out of the server HTML, so it cannot depend on the server time zone', () => {
    const html = renderToString(<LocalTime iso={ISO} format={() => 'Mar 10 at 21:07'} />)
    expect(html.toLowerCase()).toContain(`datetime="${ISO.toLowerCase()}"`)
    expect(html).not.toContain('21:07')
  })

  it('fills in the viewer-local text after hydration, without a hydration error', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { serverHtml } = hydrate(
      <p>
        Saved <LocalTime iso={ISO} format={(iso) => `at ${iso.slice(11, 16).replace(':', 'h')}`} />
      </p>,
    )
    expect(serverHtml).not.toContain('02h07')
    const time = await screen.findByText('at 02h07')
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('datetime', ISO)
    expect(errors).not.toHaveBeenCalled()
  })
})

describe('LocalDate', () => {
  it('shows the medium date in the viewer time zone after hydration', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { serverHtml } = hydrate(<LocalDate iso={ISO} />)
    const expected = new Date(ISO).toLocaleDateString('en-US', { dateStyle: 'medium' })
    expect(serverHtml).not.toContain(expected)
    expect(await screen.findByText(expected)).toHaveAttribute('datetime', ISO)
    expect(errors).not.toHaveBeenCalled()
  })
})
