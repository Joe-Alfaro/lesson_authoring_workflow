// R15: hovering or focusing a standard code shows its code, strand and full text. One tooltip
// element per page, shared by the editor's chips (plain DOM node views) and the lesson view.
import type { StandardRef } from '../../editor/standards'

export const STANDARD_TOOLTIP_ID = 'standard-tooltip'

const reference = new Map<string, StandardRef>()
let tooltip: HTMLDivElement | null = null
let anchor: HTMLElement | null = null

/** The page's reference data (R15); codes missing from it show the unknown-code text. */
export function setStandardReference(standards: StandardRef[]): void {
  standards.forEach((standard) => reference.set(standard.code, standard))
}

export function isKnownStandard(code: string): boolean {
  return reference.has(code)
}

function ensureTooltip(): HTMLDivElement {
  if (tooltip?.isConnected) return tooltip
  const element = document.createElement('div')
  element.id = STANDARD_TOOLTIP_ID
  element.className = 'float pop std-pop'
  element.setAttribute('role', 'tooltip')
  element.hidden = true
  document.body.append(element)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideStandardTooltip()
  })
  tooltip = element
  return element
}

export function showStandardTooltip(target: HTMLElement, code: string): void {
  const element = ensureTooltip()
  const standard = reference.get(code)
  const head = document.createElement('div')
  head.className = 'row'
  const codeEl = document.createElement('span')
  codeEl.className = 'code'
  codeEl.textContent = code
  head.append(codeEl)
  if (standard) {
    const strand = document.createElement('span')
    strand.className = 'caption'
    strand.textContent = standard.strand
    head.append(strand)
  }
  const text = document.createElement('p')
  text.className = 'tx'
  text.textContent =
    standard?.text ?? 'This code is not in the grade 6 standards data. Check it in the outline.'
  element.replaceChildren(head, text)

  const rect = target.getBoundingClientRect()
  element.style.left = `${rect.left + window.scrollX}px`
  element.style.top = `${rect.bottom + window.scrollY + 10}px`
  element.hidden = false
  anchor = target
}

export function hideStandardTooltip(target?: HTMLElement): void {
  if (!tooltip || (target && anchor !== target)) return
  tooltip.hidden = true
  anchor = null
}

/** Wires a chip button: described by the tooltip, which opens on hover and focus. */
export function bindStandardChip(button: HTMLElement, code: string): () => void {
  ensureTooltip()
  button.setAttribute('aria-describedby', STANDARD_TOOLTIP_ID)
  const show = () => showStandardTooltip(button, code)
  const hide = () => hideStandardTooltip(button)
  button.addEventListener('mouseenter', show)
  button.addEventListener('focus', show)
  button.addEventListener('mouseleave', hide)
  button.addEventListener('blur', hide)
  return () => {
    button.removeEventListener('mouseenter', show)
    button.removeEventListener('focus', show)
    button.removeEventListener('mouseleave', hide)
    button.removeEventListener('blur', hide)
    hide()
  }
}
