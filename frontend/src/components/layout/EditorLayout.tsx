import React from 'react'
import { usePanelStore } from '../../stores/panelStore'
import { Panel } from './Panel'

interface EditorLayoutProps {
  header?: React.ReactNode
  mediaContent?: React.ReactNode
  previewContent?: React.ReactNode
  propertiesContent?: React.ReactNode
  timelineContent?: React.ReactNode
}

export function EditorLayout({
  header,
  mediaContent,
  previewContent,
  propertiesContent,
  timelineContent,
}: EditorLayoutProps) {
  const {
    sizes,
    visibility,
    minimized,
    collapsed,
    setPanelSize,
    setPanelVisibility,
    togglePanelMinimize,
    togglePanelCollapse,
  } = usePanelStore()

  // Calculate center area size based on left/right panel sizes
  const centerWidth = minimized.media ? 10 : minimized.properties ? 10 : 100 - sizes.media - sizes.properties

  return (
    <div className="flex flex-col h-screen bg-[var(--ctp-base)]">
      {/* Editor Header */}
      {header && (
        <header className="flex-shrink-0 h-14 border-b border-[var(--ctp-overlay)] bg-[var(--ctp-surface)] px-4 flex items-center justify-between">
          {header}
        </header>
      )}

      {/* Main Content Area - Left/Center/Right Panels */}
      <div className="flex flex-1 min-h-0">
        {/* Left Panel - Media Library */}
        <Panel
          position="left"
          size={sizes.media}
          onSizeChange={(size) => setPanelSize('media', size)}
          visible={visibility.media}
          minimized={minimized.media}
          collapsed={collapsed.media}
          onToggleMinimize={() => togglePanelMinimize('media')}
          onToggleCollapse={() => togglePanelCollapse('media')}
          title="Media Library"
          className="flex-shrink-0"
        >
          {mediaContent}
        </Panel>

        {/* Center Panel - Preview Viewport */}
        <div
          className="flex-1 flex flex-col min-w-0 bg-[var(--ctp-base)]"
          style={{ width: minimized.media && minimized.properties ? '100%' : `${centerWidth}%` }}
        >
          {previewContent && (
            <div className="flex-1 min-h-0 flex items-center justify-center p-4">
              {previewContent}
            </div>
          )}
        </div>

        {/* Right Panel - Properties */}
        <Panel
          position="right"
          size={sizes.properties}
          onSizeChange={(size) => setPanelSize('properties', size)}
          visible={visibility.properties}
          minimized={minimized.properties}
          collapsed={collapsed.properties}
          onToggleMinimize={() => togglePanelMinimize('properties')}
          onToggleCollapse={() => togglePanelCollapse('properties')}
          title="Properties"
          className="flex-shrink-0"
        >
          {propertiesContent}
        </Panel>
      </div>

      {/* Bottom Panel - Timeline */}
      <Panel
        position="bottom"
        size={sizes.timeline}
        onSizeChange={(size) => setPanelSize('timeline', size)}
        visible={visibility.timeline}
        minimized={minimized.timeline}
        collapsed={collapsed.timeline}
        onToggleMinimize={() => togglePanelMinimize('timeline')}
        onToggleCollapse={() => togglePanelCollapse('timeline')}
        title="Timeline"
        className="flex-shrink-0"
      >
        {timelineContent}
      </Panel>
    </div>
  )
}
