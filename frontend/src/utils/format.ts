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
