import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type PanelPosition = 'left' | 'right' | 'bottom'
export type PanelId = 'media' | 'preview' | 'properties' | 'timeline'

interface PanelState {
  sizes: Record<PanelId, number> // percentage for left/right, pixels for bottom
  visibility: Record<PanelId, boolean>
  minimized: Record<PanelId, boolean>
  collapsed: Record<PanelId, boolean>

  setPanelSize: (panelId: PanelId, size: number) => void
  setPanelVisibility: (panelId: PanelId, visible: boolean) => void
  togglePanelMinimize: (panelId: PanelId) => void
  togglePanelCollapse: (panelId: PanelId) => void
  resetLayout: () => void
}

const DEFAULT_SIZES: Record<PanelId, number> = {
  media: 20,      // 20% width for left panel
  preview: 40,    // 40% width for center (remaining is split)
  properties: 25, // 25% width for right panel
  timeline: 300,  // 300px height for bottom panel
}

const INITIAL_STATE: Omit<PanelState, 'setPanelSize' | 'setPanelVisibility' | 'togglePanelMinimize' | 'togglePanelCollapse' | 'resetLayout'> = {
  sizes: { ...DEFAULT_SIZES },
  visibility: {
    media: true,
    preview: true,
    properties: true,
    timeline: true,
  },
  minimized: {
    media: false,
    preview: false,
    properties: false,
    timeline: false,
  },
  collapsed: {
    media: false,
    preview: false,
    properties: false,
    timeline: false,
  },
}

export const usePanelStore = create<PanelState>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      setPanelSize: (panelId, size) => {
        set(state => ({
          sizes: { ...state.sizes, [panelId]: size },
        }))
      },

      setPanelVisibility: (panelId, visible) => {
        set(state => ({
          visibility: { ...state.visibility, [panelId]: visible },
        }))
      },

      togglePanelMinimize: (panelId) => {
        set(state => ({
          minimized: { ...state.minimized, [panelId]: !state.minimized[panelId] },
        }))
      },

      togglePanelCollapse: (panelId) => {
        set(state => ({
          collapsed: { ...state.collapsed, [panelId]: !state.collapsed[panelId] },
        }))
      },

      resetLayout: () => {
        set(INITIAL_STATE)
      },
    }),
    {
      name: 'momiji-panel-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sizes: state.sizes,
        visibility: state.visibility,
        minimized: state.minimized,
        collapsed: state.collapsed,
      }),
    }
  )
)
