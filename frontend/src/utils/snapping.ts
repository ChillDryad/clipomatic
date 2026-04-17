/**
 * Snapping system for timeline editing
 * Provides snap-to-playhead, snap-to-segment-edges, snap-to-markers functionality
 */

import type { TrackSegment, Marker } from '../types'

export const SNAP_THRESHOLD = 0.16  // ~5 frames at 30fps
export const SNAP_THRESHOLD_FINE = 0.05  // Fine snap for precise editing

export type SnapType = 'playhead' | 'segment-start' | 'segment-end' | 'marker'

export interface SnapPoint {
  time: number
  type: SnapType
  segmentId?: string
  markerId?: string
}

/**
 * Find all snap points within threshold of the given time
 */
export function findSnapPoints(
  time: number,
  options: {
    currentTime: number
    segments: TrackSegment[]
    markers: Marker[]
    duration: number
    threshold?: number
    snapToPlayhead?: boolean
    snapToSegmentEdges?: boolean
    snapToMarkers?: boolean
  }
): SnapPoint[] {
  const {
    currentTime,
    segments,
    markers,
    duration,
    threshold = SNAP_THRESHOLD,
    snapToPlayhead = true,
    snapToSegmentEdges = true,
    snapToMarkers = true,
  } = options

  const points: SnapPoint[] = []

  // Snap to playhead
  if (snapToPlayhead && Math.abs(time - currentTime) <= threshold) {
    points.push({ time: currentTime, type: 'playhead' })
  }

  // Snap to segment edges
  if (snapToSegmentEdges) {
    for (const segment of segments) {
      if (Math.abs(time - segment.start) <= threshold) {
        points.push({ time: segment.start, type: 'segment-start', segmentId: segment.id })
      }
      if (Math.abs(time - segment.end) <= threshold) {
        points.push({ time: segment.end, type: 'segment-end', segmentId: segment.id })
      }
    }
  }

  // Snap to markers
  if (snapToMarkers) {
    for (const marker of markers) {
      if (Math.abs(time - marker.time) <= threshold) {
        points.push({ time: marker.time, type: 'marker', markerId: marker.id })
      }
      // Also snap to marker end if it has duration
      if (marker.duration && Math.abs(time - (marker.time + marker.duration)) <= threshold) {
        points.push({ time: marker.time + marker.duration, type: 'marker', markerId: marker.id })
      }
    }
  }

  // Snap to timeline boundaries
  if (Math.abs(time) <= threshold) {
    points.push({ time: 0, type: 'segment-start' })
  }
  if (Math.abs(time - duration) <= threshold) {
    points.push({ time: duration, type: 'segment-end' })
  }

  // Sort by distance to the target time
  return points.sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))
}

/**
 * Apply snapping to a time value
 * Returns the snapped time and information about the snap
 */
export function applySnap(
  time: number,
  snapPoints: SnapPoint[],
  options?: {
    threshold?: number
    exclude?: SnapType[]
  }
): { time: number; snapped: boolean; snapPoint?: SnapPoint } {
  const { threshold = SNAP_THRESHOLD, exclude = [] } = options ?? {}

  // Filter out excluded snap types
  const validPoints = snapPoints.filter(p => !exclude.includes(p.type))

  for (const point of validPoints) {
    if (Math.abs(time - point.time) < threshold) {
      return { time: point.time, snapped: true, snapPoint: point }
    }
  }

  return { time, snapped: false }
}

/**
 * Get all potential snap points from the timeline
 */
export function getAllSnapPoints(options: {
  currentTime: number
  segments: TrackSegment[]
  markers: Marker[]
  duration: number
  includePlayhead?: boolean
}): SnapPoint[] {
  const {
    currentTime,
    segments,
    markers,
    duration,
    includePlayhead = true,
  } = options

  const points: SnapPoint[] = []

  // Playhead
  if (includePlayhead) {
    points.push({ time: currentTime, type: 'playhead' })
  }

  // Segment edges
  for (const segment of segments) {
    points.push({ time: segment.start, type: 'segment-start', segmentId: segment.id })
    points.push({ time: segment.end, type: 'segment-end', segmentId: segment.id })
  }

  // Markers
  for (const marker of markers) {
    points.push({ time: marker.time, type: 'marker', markerId: marker.id })
    if (marker.duration) {
      points.push({ time: marker.time + marker.duration, type: 'marker', markerId: marker.id })
    }
  }

  // Timeline boundaries
  points.push({ time: 0, type: 'segment-start' })
  points.push({ time: duration, type: 'segment-end' })

  // Remove duplicates (same time, different type)
  const uniquePoints = new Map<number, SnapPoint>()
  for (const point of points) {
    if (!uniquePoints.has(point.time)) {
      uniquePoints.set(point.time, point)
    }
  }

  return Array.from(uniquePoints.values()).sort((a, b) => a.time - b.time)
}

/**
 * Check if a time is close enough to snap
 */
export function isNearSnapPoint(
  time: number,
  snapPoints: SnapPoint[],
  threshold: number = SNAP_THRESHOLD
): boolean {
  return snapPoints.some(point => Math.abs(time - point.time) < threshold)
}

/**
 * Get the nearest snap point to a time
 */
export function getNearestSnapPoint(
  time: number,
  snapPoints: SnapPoint[],
  threshold: number = SNAP_THRESHOLD
): SnapPoint | null {
  let nearest: SnapPoint | null = null
  let minDistance = threshold

  for (const point of snapPoints) {
    const distance = Math.abs(time - point.time)
    if (distance < minDistance) {
      minDistance = distance
      nearest = point
    }
  }

  return nearest
}

/**
 * Calculate visual snap indicator position for UI feedback
 */
export function getSnapIndicatorPosition(
  snapPoint: SnapPoint,
  pxPerSecond: number,
  offset: number = 0
): { left: number; type: SnapType } {
  return {
    left: snapPoint.time * pxPerSecond + offset,
    type: snapPoint.type,
  }
}

/**
 * Snap a segment's time range, respecting constraints
 */
export function snapSegment(
  segment: TrackSegment,
  delta: number,
  options: {
    currentTime: number
    allSegments: TrackSegment[]
    markers: Marker[]
    duration: number
    threshold?: number
    rippleEnabled?: boolean
  }
): {
  newStart: number
  newEnd: number
  snapped: boolean
  snapPoint?: SnapPoint
} {
  const {
    currentTime,
    allSegments,
    markers,
    duration,
    threshold = SNAP_THRESHOLD,
    rippleEnabled = false,
  } = options

  const newStart = segment.start + delta
  const newEnd = segment.end + delta

  // Find snap points (excluding this segment's own edges)
  const otherSegments = allSegments.filter(s => s.id !== segment.id)
  const snapPoints = getAllSnapPoints({
    currentTime,
    segments: otherSegments,
    markers,
    duration,
  })

  // Try to snap the start time
  const startSnap = applySnap(newStart, snapPoints, { threshold })
  if (startSnap.snapped) {
    const adjustedEnd = startSnap.time + (segment.end - segment.start)
    if (adjustedEnd <= duration && adjustedEnd > startSnap.time) {
      return {
        newStart: startSnap.time,
        newEnd: adjustedEnd,
        snapped: true,
        snapPoint: startSnap.snapPoint,
      }
    }
  }

  // Try to snap the end time
  const endSnap = applySnap(newEnd, snapPoints, { threshold })
  if (endSnap.snapped) {
    const adjustedStart = endSnap.time - (segment.end - segment.start)
    if (adjustedStart >= 0 && adjustedStart < endSnap.time) {
      return {
        newStart: adjustedStart,
        newEnd: endSnap.time,
        snapped: true,
        snapPoint: endSnap.snapPoint,
      }
    }
  }

  // No snap - just apply the delta with bounds checking
  return {
    newStart: Math.max(0, newStart),
    newEnd: Math.min(duration, newEnd),
    snapped: false,
  }
}
