import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from '../../hooks/useTheme'
import { FocusTrap } from './FocusTrap'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  closeOnOverlay?: boolean
  showCloseButton?: boolean
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
}

/**
 * Accessible Modal component with focus trapping, ARIA attributes, and keyboard support.
 *
 * Features:
 * - Focus trap to keep focus within modal
 * - Escape key to close
 * - Optional overlay click to close
 * - ARIA labels for screen readers
 * - Optional description and footer
 *
 * @example
 * ```tsx
 * <Modal open={isOpen} onClose={() => setIsOpen(false)} title="Confirm Delete">
 *   <p>Are you sure you want to delete this item?</p>
 *   <div className="flex gap-2 mt-4">
 *     <Button variant="secondary" onClick={() => setIsOpen(false)}>Cancel</Button>
 *     <Button variant="danger" onClick={handleDelete}>Delete</Button>
 *   </div>
 * </Modal>
 * ```
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnOverlay = true,
  showCloseButton = true,
}: ModalProps) {
  const { theme } = useTheme()
  const titleId = 'modal-title'
  const descId = 'modal-description'
  const previousActiveElement = useRef<Element | null>(null)

  useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
      // Return focus to previous element
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus()
      }
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Handle escape key
  useEffect(() => {
    if (!open) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open, onClose])

  if (!open) return null

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnOverlay && e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div
      className="modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descId : undefined}
    >
      <FocusTrap active={true}>
        <div
          className={`
            glass-card ${sizeClasses[size]} w-full rounded-xl shadow-2xl
            ${theme === 'dark' ? 'dark' : ''}
            animate-scaleIn
          `}
        >
          {title && (
            <div className="flex items-center justify-between mb-5 pb-4 border-b border-[var(--ctp-surface-2)]">
              <h2 id={titleId} className="text-base font-semibold text-[var(--ctp-text)]">
                {title}
              </h2>
              {showCloseButton && (
                <button
                  onClick={onClose}
                  className="btn-ghost p-1.5 rounded-lg text-[var(--ctp-subtext)] hover:text-[var(--ctp-text)] transition-colors"
                  aria-label="Close modal"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {description && (
            <p id={descId} className="text-sm text-[var(--ctp-subtext)] mb-4">
              {description}
            </p>
          )}

          <div className="py-2">{children}</div>

          {footer && (
            <div className="mt-6 pt-4 border-t border-[var(--ctp-surface-2)] flex gap-2 justify-end">
              {footer}
            </div>
          )}
        </div>
      </FocusTrap>
    </div>
  )
}
