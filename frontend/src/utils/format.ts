export function formatDate(timestamp: number | string): string {
  // Handle both Unix timestamps (seconds) and ISO strings
  let date: Date
  if (typeof timestamp === 'string') {
    date = new Date(timestamp)
  } else if (typeof timestamp === 'number') {
    // If timestamp is very large, assume it's already in milliseconds
    if (timestamp > 1e12) {
      date = new Date(timestamp)
    } else {
      date = new Date(timestamp * 1000)
    }
  } else {
    return 'Invalid Date'
  }

  if (isNaN(date.getTime())) {
    return 'Invalid Date'
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'Unknown'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  return `${m}m ${s}s`
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Format seconds as HH:MM:SS */
export function formatHms(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Parse HH:MM:SS or MM:SS back to seconds */
export function parseHms(text: string): number | null {
  const parts = text.trim().split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 1) return parts[0]
  return null
}
