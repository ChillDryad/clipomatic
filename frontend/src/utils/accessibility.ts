/**
 * Accessibility utilities for keyboard navigation and focus management.
 */

/**
 * Traps focus within a container element.
 * Useful for modals and dialogs.
 */
export function trapFocus(
  container: HTMLElement,
  previouslyFocusedElement?: HTMLElement
): () => void {
  const focusableElements = container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )
  const firstFocusable = focusableElements[0]
  const lastFocusable = focusableElements[focusableElements.length - 1]

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return

    if (e.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstFocusable) {
        e.preventDefault()
        lastFocusable?.focus()
      }
    } else {
      // Tab
      if (document.activeElement === lastFocusable) {
        e.preventDefault()
        firstFocusable?.focus()
      }
    }
  }

  container.addEventListener('keydown', handleKeyDown)

  // Focus first element
  firstFocusable?.focus()

  // Return cleanup function
  return () => {
    container.removeEventListener('keydown', handleKeyDown)
    previouslyFocusedElement?.focus()
  }
}

/**
 * Restores focus to an element after an action.
 * Useful for buttons that open/close modals.
 */
export function restoreFocus(element: HTMLElement | null): () => void {
  const previouslyFocused = document.activeElement as HTMLElement | null

  return () => {
    if (previouslyFocused && previouslyFocused !== document.body) {
      previouslyFocused.focus()
    } else if (element) {
      element.focus()
    }
  }
}

/**
 * Makes an element announce to screen readers.
 */
export function announce(
  message: string,
  priority: 'polite' | 'assertive' = 'polite'
): void {
  const announcer = document.getElementById('aria-announcer') || createAnnouncer()
  announcer.setAttribute('aria-live', priority)
  announcer.textContent = message
}

function createAnnouncer(): HTMLElement {
  const announcer = document.createElement('div')
  announcer.id = 'aria-announcer'
  announcer.setAttribute('aria-live', 'polite')
  announcer.setAttribute('aria-atomic', 'true')
  announcer.className = 'sr-only'
  announcer.style.cssText = `
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  `
  document.body.appendChild(announcer)
  return announcer
}

/**
 * Checks if an element is currently focused.
 */
export function isElementFocused(element: HTMLElement | null): boolean {
  if (!element) return false
  return element === document.activeElement
}

/**
 * Gets all focusable elements within a container.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const elements = container.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )
  return Array.from(elements).filter(
    el => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden')
  )
}

/**
 * Handles keyboard navigation for a list of items.
 */
export function createListNavigation<T extends HTMLElement>(options: {
  items: T[]
  onSelect: (item: T) => void
  onNavigate?: (item: T | null) => void
}): (e: KeyboardEvent) => void {
  let currentIndex = -1

  return (e: KeyboardEvent) => {
    const { items, onSelect, onNavigate } = options

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault()
        currentIndex = Math.min(currentIndex + 1, items.length - 1)
        items[currentIndex]?.focus()
        onNavigate?.(items[currentIndex] || null)
        break

      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault()
        currentIndex = Math.max(currentIndex - 1, 0)
        items[currentIndex]?.focus()
        onNavigate?.(items[currentIndex] || null)
        break

      case 'Home':
        e.preventDefault()
        currentIndex = 0
        items[0]?.focus()
        onNavigate?.(items[0] || null)
        break

      case 'End':
        e.preventDefault()
        currentIndex = items.length - 1
        items[items.length - 1]?.focus()
        onNavigate?.(items[items.length - 1] || null)
        break

      case 'Enter':
      case ' ':
        if (currentIndex >= 0 && items[currentIndex]) {
          e.preventDefault()
          onSelect(items[currentIndex])
        }
        break

      case 'Escape':
        onNavigate?.(null)
        break
    }
  }
}

/**
 * Creates a roving tabindex for a group of elements.
 */
export function createRovingTabindex<T extends HTMLElement>(options: {
  items: T[]
  orientation?: 'horizontal' | 'vertical'
}): {
  handleKeyDown: (e: KeyboardEvent) => void
  getTabindex: (index: number) => string
} {
  let currentIndex = 0
  const { items, orientation = 'horizontal' } = options

  const moveFocus = (newIndex: number) => {
    if (newIndex < 0) newIndex = items.length - 1
    if (newIndex >= items.length) newIndex = 0
    currentIndex = newIndex
    items[currentIndex]?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    const isHorizontal = orientation === 'horizontal'
    const nextKey = isHorizontal ? 'ArrowRight' : 'ArrowDown'
    const prevKey = isHorizontal ? 'ArrowLeft' : 'ArrowUp'

    switch (e.key) {
      case nextKey:
        e.preventDefault()
        moveFocus(currentIndex + 1)
        break
      case prevKey:
        e.preventDefault()
        moveFocus(currentIndex - 1)
        break
      case 'Home':
        e.preventDefault()
        moveFocus(0)
        break
      case 'End':
        e.preventDefault()
        moveFocus(items.length - 1)
        break
    }
  }

  const getTabindex = (index: number): string => {
    return index === currentIndex ? '0' : '-1'
  }

  return { handleKeyDown, getTabindex }
}

/**
 * Ensures minimum touch target size (44x44px per WCAG).
 */
export function ensureMinimumTouchTarget(
  element: HTMLElement | null,
  minSize: number = 44
): void {
  if (!element) return

  const rect = element.getBoundingClientRect()

  if (rect.width < minSize || rect.height < minSize) {
    element.style.minWidth = `${minSize}px`
    element.style.minHeight = `${minSize}px`
  }
}

/**
 * Adds skip link for keyboard navigation.
 */
export function addSkipLink(targetId: string, label: string = 'Skip to content'): () => void {
  const skipLink = document.createElement('a')
  skipLink.href = `#${targetId}`
  skipLink.textContent = label
  skipLink.className = 'skip-link'
  skipLink.style.cssText = `
    position: absolute;
    top: -40px;
    left: 0;
    background: var(--ctp-mauve);
    color: var(--ctp-base);
    padding: 8px 16px;
    z-index: 100;
    transition: top 0.2s;
  `

  skipLink.addEventListener('focus', () => {
    skipLink.style.top = '0'
  })

  skipLink.addEventListener('blur', () => {
    skipLink.style.top = '-40px'
  })

  document.body.appendChild(skipLink)

  return () => {
    document.body.removeChild(skipLink)
  }
}

/**
 * Checks if reduced motion is preferred by the user.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Checks if high contrast mode is enabled.
 */
export function prefersHighContrast(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-contrast: more)').matches
}
