import { useState, useCallback } from 'react'

export interface MediaAsset {
  id: string
  filename: string
  original_filename: string
  url: string
  width?: number
  height?: number
  duration?: number  // for video overlays
  asset_type: 'image' | 'video'
  // Additional UI-only properties
  thumbnailUrl?: string
  size?: number
  createdAt?: string
  tags?: string[]
}

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (asset: MediaAsset) => void
  assets?: MediaAsset[]
  onUpload?: (file: File) => Promise<void>
  acceptedTypes?: string[]
}

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm']
const ACCEPTED_AUDIO_TYPES = ['audio/mp3', 'audio/wav', 'audio/m4a']

export function MediaLibrary({
  open,
  onClose,
  onSelect,
  assets = [],
  onUpload,
  acceptedTypes,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'image' | 'video' | 'audio'>('all')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const filteredAssets = assets.filter(asset => {
    const searchName = (asset.original_filename || asset.filename).toLowerCase()
    const matchesSearch = searchName.includes(searchQuery.toLowerCase()) ||
      asset.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))

    const matchesType = filterType === 'all' ||
      (filterType === 'image' && asset.asset_type === 'image') ||
      (filterType === 'video' && asset.asset_type === 'video') ||
      (filterType === 'audio' && asset.duration !== undefined)

    return matchesSearch && matchesType
  })

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !onUpload) return

    // Validate file type
    if (acceptedTypes && !acceptedTypes.includes(file.type)) {
      setUploadError(`Unsupported file type: ${file.type}`)
      return
    }

    setIsUploading(true)
    setUploadError(null)

    try {
      await onUpload(file)
      e.target.value = '' // Reset input
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }, [onUpload, acceptedTypes])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file || !onUpload) return

    setIsUploading(true)
    setUploadError(null)

    try {
      await onUpload(file)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }, [onUpload])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="glass-card p-0 w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-library-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--ctp-overlay)]">
          <h2 id="media-library-title" className="text-base font-semibold text-[var(--ctp-text)]">
            Media Library
          </h2>
          <button
            onClick={onClose}
            aria-label="Close media library"
            className="btn-ghost p-1.5 rounded"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 p-4 border-b border-[var(--ctp-overlay)]">
          {/* Search */}
          <div className="flex-1 relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ctp-subtext)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search media..."
              className="glass-input w-full pl-9 pr-3 py-2 text-sm"
              aria-label="Search media"
            />
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 bg-[var(--ctp-surface-1)] rounded-lg p-1">
            {(['all', 'image', 'video', 'audio'] as const).map(type => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  filterType === type
                    ? 'bg-[var(--ctp-mauve)] text-[var(--ctp-base)]'
                    : 'text-[var(--ctp-subtext)] hover:text-[var(--ctp-text)]'
                }`}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>

          {/* Upload button */}
          {onUpload && (
            <label className="btn-primary text-sm cursor-pointer">
              Upload
              <input
                type="file"
                accept={acceptedTypes?.join(',') || '*/*'}
                onChange={handleFileUpload}
                className="hidden"
                disabled={isUploading}
              />
            </label>
          )}
        </div>

        {/* Upload dropzone (when uploading) */}
        {isUploading && (
          <div
            className="flex items-center justify-center p-8 border-b border-[var(--ctp-overlay)] bg-[var(--ctp-mauve-10)]"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <div className="text-center">
              <svg className="w-8 h-8 mx-auto mb-2 text-[var(--ctp-mauve)] animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-sm text-[var(--ctp-text)]">Drop file to upload</p>
            </div>
          </div>
        )}

        {/* Upload error */}
        {uploadError && (
          <div className="flex items-center gap-2 p-3 mx-4 mt-3 rounded-lg bg-[var(--ctp-red-20)] border border-[var(--ctp-red-30)]">
            <svg className="w-4 h-4 text-[var(--ctp-red)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-[var(--ctp-red)]">{uploadError}</span>
            <button onClick={() => setUploadError(null)} className="ml-auto text-[var(--ctp-red)] hover:opacity-80">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Media grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredAssets.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-12 h-12 mx-auto mb-3 text-[var(--ctp-subtext)] opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm text-[var(--ctp-subtext)]">
                {searchQuery ? 'No media found' : 'No media yet'}
              </p>
              {onUpload && !searchQuery && (
                <p className="text-xs text-[var(--ctp-subtext)] mt-1">
                  Upload images, videos, or audio files
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {filteredAssets.map(asset => (
                <MediaCard
                  key={asset.id}
                  asset={asset}
                  onSelect={() => onSelect(asset)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface MediaCardProps {
  asset: MediaAsset
  onSelect: () => void
}

function MediaCard({ asset, onSelect }: MediaCardProps) {
  const [loading, setLoading] = useState(true)

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatDuration = (seconds?: number): string => {
    if (!seconds) return ''
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  return (
    <div
      className="group relative aspect-square rounded-lg overflow-hidden bg-[var(--ctp-surface-1)] border border-[var(--ctp-overlay)] cursor-pointer hover:border-[var(--ctp-mauve)] transition-colors"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      aria-label={`Select ${asset.original_filename || asset.filename}`}
    >
      {/* Thumbnail */}
      {asset.asset_type === 'image' ? (
        <img
          src={asset.thumbnailUrl || asset.url}
          alt={asset.original_filename || asset.filename}
          className="w-full h-full object-cover transition-transform group-hover:scale-105"
          onLoad={() => setLoading(false)}
        />
      ) : asset.asset_type === 'video' ? (
        <div className="w-full h-full flex items-center justify-center bg-black/20">
          {asset.thumbnailUrl ? (
            <img
              src={asset.thumbnailUrl}
              alt={asset.original_filename || asset.filename}
              className="w-full h-full object-cover transition-transform group-hover:scale-105"
              onLoad={() => setLoading(false)}
            />
          ) : (
            <svg className="w-8 h-8 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          )}
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-[var(--ctp-surface)]">
          <svg className="w-8 h-8 text-[var(--ctp-subtext)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
      )}

      {/* Type badge */}
      <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-black/60 text-white capitalize">
        {asset.asset_type}
      </div>

      {/* Duration badge (for video/audio) */}
      {asset.duration && (
        <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/60 text-white">
          {formatDuration(asset.duration)}
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <span className="text-xs text-white font-medium">Select</span>
      </div>

      {/* Info overlay (bottom) */}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent">
        <p className="text-xs text-white truncate">{asset.original_filename || asset.filename}</p>
        {asset.size && <p className="text-[10px] text-white/70">{formatSize(asset.size)}</p>}
      </div>
    </div>
  )
}
