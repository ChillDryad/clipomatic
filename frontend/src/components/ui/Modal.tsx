import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useTheme } from '../../hooks/useTheme'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const { theme } = useTheme()

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`modal-panel ${theme === 'dark' ? 'dark' : ''}`}>
        {title && (
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-[var(--ctp-text)]">{title}</h2>
            <button
              onClick={onClose}
              className="btn-ghost p-1.5 rounded-lg text-[var(--ctp-subtext)] hover:text-[var(--ctp-text)]"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
