import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface SelectionState {
  selectedSegmentIds: Set<string>
  selectedTrackIds: Set<string>

  // Actions
  select: (segmentId: string, mode?: 'replace' | 'add' | 'range') => void
  selectTrack: (trackId: string, mode?: 'replace' | 'add') => void
  clearSelection: () => void
  deleteSelected: () => void
  duplicateSelected: () => void
  isSelected: (segmentId: string) => boolean
  isTrackSelected: (trackId: string) => boolean
  selectedCount: number
  reset: () => void
}

const INITIAL_STATE: Omit<SelectionState, 'select' | 'selectTrack' | 'clearSelection' | 'deleteSelected' | 'duplicateSelected' | 'isSelected' | 'isTrackSelected' | 'reset'> = {
  selectedSegmentIds: new Set(),
  selectedTrackIds: new Set(),
  selectedCount: 0,
}

export const useSelectionStore = create<SelectionState>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      select: (segmentId, mode = 'replace') => {
        set(state => {
          const newSet = mode === 'replace'
            ? new Set([segmentId])
            : mode === 'add'
              ? new Set(state.selectedSegmentIds).add(segmentId)
              : new Set(state.selectedSegmentIds)  // range selection handled separately

          if (mode === 'add' && state.selectedSegmentIds.has(segmentId)) {
            newSet.delete(segmentId)  // toggle off
          }

          return {
            selectedSegmentIds: newSet,
            selectedCount: newSet.size,
          }
        })
      },

      selectTrack: (trackId, mode = 'replace') => {
        set(state => {
          const newSet = mode === 'replace'
            ? new Set([trackId])
            : new Set(state.selectedTrackIds)

          if (mode === 'add' && state.selectedTrackIds.has(trackId)) {
            newSet.delete(trackId)
          } else if (mode === 'add') {
            newSet.add(trackId)
          }

          return { selectedTrackIds: newSet }
        })
      },

      clearSelection: () => {
        set({
          selectedSegmentIds: new Set(),
          selectedTrackIds: new Set(),
          selectedCount: 0,
        })
      },

      deleteSelected: () => {
        // This is a signal action - actual deletion handled by timeline store
        set(state => ({
          selectedSegmentIds: new Set(),
          selectedCount: 0,
        }))
      },

      duplicateSelected: () => {
        // This is a signal action - actual duplication handled by timeline store
        // Returns the selected IDs for the caller to process
        return get().selectedSegmentIds
      },

      isSelected: (segmentId) => {
        return get().selectedSegmentIds.has(segmentId)
      },

      isTrackSelected: (trackId) => {
        return get().selectedTrackIds.has(trackId)
      },

      reset: () => {
        set(INITIAL_STATE)
      },
    }),
    {
      name: 'momiji-selection-storage',
      storage: createJSONStorage(() => localStorage),
      // Don't persist selections across sessions
      partialize: () => ({}),
    }
  )
)

// Lasso selection helper
export interface LassoSelection {
  isSelecting: boolean
  startPoint: { x: number; y: number } | null
  currentPoint: { x: number; y: number } | null
  selectedIds: string[]
}

export function createLassoSelection(): LassoSelection {
  return {
    isSelecting: false,
    startPoint: null,
    currentPoint: null,
    selectedIds: [],
  }
}

export function pointInRect(
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

export function getLassoSelection(
  startPoint: { x: number; y: number },
  currentPoint: { x: number; y: number },
  segmentBounds: Array<{ id: string; bounds: { x: number; y: number; width: number; height: number } }>
): string[] {
  const rect = {
    x: Math.min(startPoint.x, currentPoint.x),
    y: Math.min(startPoint.y, currentPoint.y),
    width: Math.abs(currentPoint.x - startPoint.x),
    height: Math.abs(currentPoint.y - startPoint.y),
  }

  return segmentBounds
    .filter(seg => pointInRect({ x: seg.bounds.x + seg.bounds.width / 2, y: seg.bounds.y + seg.bounds.height / 2 }, rect))
    .map(seg => seg.id)
}
