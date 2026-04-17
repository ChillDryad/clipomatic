import { useEffect, useRef, useCallback } from 'react'

interface Props {
  children: React.ReactNode
  active: boolean
  onEscape?: () => void
  initialFocusRef?: React.RefObject<HTMLElement | null>
  returnFocusRef?: React.RefObject<HTMLElement | null>
  className?: string
}

/**
 * FocusTrap component that traps focus within its children.
 * Useful for modals, dialogs, and popovers.
 */
export function FocusTrap({
  children,
  active,
  onEscape,
  initialFocusRef,
  returnFocusRef,
  className = '',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!active) return

    if (e.key === 'Escape') {
      onEscape?.()
      return
    }

    if (e.key !== 'Tab') return

    // Get all focusable elements
    const container = containerRef.current
    if (!container) return

    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )

    const firstFocusable = focusableElements[0]
    const lastFocusable = focusableElements[focusableElements.length - 1]

    if (e.shiftKey) {
      // Shift + Tab: go to last if at first
      if (document.activeElement === firstFocusable) {
        e.preventDefault()
        lastFocusable?.focus()
      }
    } else {
      // Tab: go to first if at last
      if (document.activeElement === lastFocusable) {
        e.preventDefault()
        firstFocusable?.focus()
      }
    }
  }, [active, onEscape])

  useEffect(() => {
    if (!active) return

    // Store previously focused element
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null

    // Focus initial element or first focusable
    const container = containerRef.current
    if (container) {
      const initialFocus = initialFocusRef?.current
      const firstFocusable = container.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )

      setTimeout(() => {
        initialFocus?.focus() || firstFocusable?.focus()
      }, 0)
    }

    // Prevent body scroll when trap is active
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = ''

      // Return focus
      const returnFocus = returnFocusRef?.current || previouslyFocusedRef.current
      returnFocus?.focus()
    }
  }, [active, initialFocusRef, returnFocusRef])

  if (!active) return null

  return (
    <div
      ref={containerRef}
      className={className}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
    >
      {children}
    </div>
  )
}

/**
 * Invisible element that moves focus to the next focusable element.
 * Useful for ensuring keyboard users don't get stuck.
 */
export function FocusNext() {
  return (
    <span
      tabIndex={0}
      role="button"
      aria-label="Press Enter to continue"
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          const current = e.currentTarget
          let next = current.nextElementSibling as HTMLElement | null
          while (next && next.tabIndex === -1) {
            next = next.nextElementSibling as HTMLElement | null
          }
          next?.focus()
        }
      }}
      className="sr-only"
    />
  )
}

/**
 * Visually hidden but accessible to screen readers.
 */
export function SrOnly({
  children,
  as = 'span',
}: {
  children: React.ReactNode
  as?: string
}) {
  const Component = as as React.ElementType

  return (
    <Component
      className="sr-only"
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {children}
    </Component>
  )
}
