// axe for component tests (jsdom). The e2e equivalent is in tests/e2e/support.ts.
import axe from 'axe-core'
import { expect } from 'vitest'

/**
 * Asserts axe finds no WCAG 2.1 A/AA violations in `container`. Colour contrast is left to the
 * e2e axe checks: jsdom doesn't compute styles.
 */
export async function expectNoAxeViolations(container: Element): Promise<void> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  })
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
}
