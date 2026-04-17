import { useState, useEffect } from 'react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'

interface ShortcutGroup {
  title: string
  shortcuts: {
    keys: string[]
    description: string
  }[]
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Playback',
    shortcuts: [
      { keys: ['Space', 'K'], description: 'Play/Pause' },
      { keys: ['←'], description: 'Step back 0.5s' },
      { keys: ['→'], description: 'Step forward 0.5s' },
      { keys: ['J'], description: 'Seek -1 second' },
      { keys: ['L'], description: 'Seek +1 second' },
      { keys: [','], description: 'Previous frame' },
      { keys: ['.'], description: 'Next frame' },
    ],
  },
  {
    title: 'Editing',
    shortcuts: [
      { keys: ['M'], description: 'Add marker at playhead' },
      { keys: ['S'], description: 'Split segment at playhead' },
      { keys: ['Delete', 'Backspace'], description: 'Delete selected segment' },
      { keys: ['I'], description: 'Set in-point' },
      { keys: ['O'], description: 'Set out-point' },
    ],
  },
  {
    title: 'Selection',
    shortcuts: [
      { keys: ['Click'], description: 'Select segment' },
      { keys: ['Shift', 'Click'], description: 'Select range' },
      { keys: ['Ctrl/Cmd', 'Click'], description: 'Toggle selection' },
      { keys: ['Ctrl/Cmd', 'A'], description: 'Select all' },
      { keys: ['Esc'], description: 'Clear selection' },
    ],
  },
  {
    title: 'Undo/Redo',
    shortcuts: [
      { keys: ['Ctrl/Cmd', 'Z'], description: 'Undo' },
      { keys: ['Ctrl/Cmd', 'Shift', 'Z'], description: 'Redo' },
    ],
  },
  {
    title: 'Clipboard',
    shortcuts: [
      { keys: ['Ctrl/Cmd', 'C'], description: 'Copy selected' },
      { keys: ['Ctrl/Cmd', 'V'], description: 'Paste' },
      { keys: ['Ctrl/Cmd', 'D'], description: 'Duplicate selected' },
    ],
  },
  {
    title: 'View',
    shortcuts: [
      { keys: ['N'], description: 'Toggle snapping' },
      { keys: ['+'], description: 'Zoom in' },
      { keys: ['-'], description: 'Zoom out' },
      { keys: ['0'], description: 'Fit timeline to view' },
      { keys: ['/'], description: 'Toggle playhead follow' },
    ],
  },
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Home'], description: 'Go to start' },
      { keys: ['End'], description: 'Go to end' },
      { keys: ['↑'], description: 'Previous marker' },
      { keys: ['↓'], description: 'Next marker' },
    ],
  },
  {
    title: 'Help',
    shortcuts: [
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['Esc'], description: 'Close modal/dialog' },
    ],
  },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function KeyboardShortcutsModal({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard Shortcuts">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="text-xs font-semibold text-[var(--ctp-subtext)] uppercase tracking-wider mb-2">
              {group.title}
            </h3>
            <div className="space-y-1.5">
              {group.shortcuts.map((shortcut, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between py-1"
                >
                  <span className="text-sm text-[var(--ctp-text)]">
                    {shortcut.description}
                  </span>
                  <div className="flex items-center gap-1">
                    {shortcut.keys.map((key, keyIndex) => (
                      <kbd
                        key={keyIndex}
                        className="px-2 py-1 rounded-md bg-[var(--ctp-surface-1)] border border-[var(--ctp-overlay)] text-xs font-mono text-[var(--ctp-text)] shadow-sm min-w-[24px] text-center"
                      >
                        {key === 'Ctrl/Cmd' ? (
                          <span className="text-[var(--ctp-subtext)]">
                            {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}
                          </span>
                        ) : key === 'Shift' ? (
                          '⇧'
                        ) : key === 'Space' ? (
                          'Space'
                        ) : key === '←' ? (
                          '←'
                        ) : key === '→' ? (
                          '→'
                        ) : key === '↑' ? (
                          '↑'
                        ) : key === '↓' ? (
                          '↓'
                        ) : (
                          key
                        )}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Accessibility note */}
        <div className="mt-6 p-3 rounded-lg bg-[var(--ctp-blue-10)] border border-[var(--ctp-blue-20)]">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-[var(--ctp-blue)] flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-xs text-[var(--ctp-text)]">
                <strong className="font-semibold">Accessibility:</strong> All interactive elements have a minimum touch target of 44×44px and are keyboard accessible. Use Tab to navigate between elements and Enter/Space to activate.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={onClose} variant="primary" size="sm">
          Close
        </Button>
      </div>
    </Modal>
  )
}

/**
 * Hook to open keyboard shortcuts modal with '?' key
 */
export function useKeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Only trigger if not in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault()
        setOpen(true)
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  return {
    open,
    setOpen,
    onClose: () => setOpen(false),
  }
}
