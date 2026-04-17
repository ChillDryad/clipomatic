/**
 * Ripple editing utilities for timeline
 * When a segment moves, automatically shift subsequent segments
 */

import type { TrackSegment } from '../types'

export interface RippleEditResult {
  affectedSegments: Array<{
    segmentId: string
    originalStart: number
    newStart: number
    originalEnd: number
    newEnd: number
  }>
  delta: number
}

/**
 * Calculate which segments would be affected by a ripple edit
 */
export function calculateRippleEdit(
  movedSegment: TrackSegment,
  allSegments: TrackSegment[],
  delta: number
): RippleEditResult {
  const affectedSegments: RippleEditResult['affectedSegments'] = []

  // Find segments that start after the moved segment's original position
  // and would be affected by the delta
  for (const segment of allSegments) {
    if (segment.id === movedSegment.id) continue

    // Check if this segment starts after the moved segment's start
    // and would overlap or be pushed by the move
    if (delta > 0) {
      // Moving forward - affect segments that start after moved segment's new end
      if (segment.start >= movedSegment.start + delta && segment.start >= movedSegment.end) {
        affectedSegments.push({
          segmentId: segment.id,
          originalStart: segment.start,
          newStart: segment.start + delta,
          originalEnd: segment.end,
          newEnd: segment.end + delta,
        })
      }
    } else if (delta < 0) {
      // Moving backward - affect segments that start after moved segment's original end
      if (segment.start >= movedSegment.end && segment.start + delta >= movedSegment.end + delta) {
        affectedSegments.push({
          segmentId: segment.id,
          originalStart: segment.start,
          newStart: segment.start + delta,
          originalEnd: segment.end,
          newEnd: segment.end + delta,
        })
      }
    }
  }

  return {
    affectedSegments,
    delta,
  }
}

/**
 * Apply ripple edit to a list of segments
 */
export function applyRippleEdit(
  segments: TrackSegment[],
  movedSegmentId: string,
  delta: number
): TrackSegment[] {
  if (delta === 0) return segments

  const movedSegment = segments.find(s => s.id === movedSegmentId)
  if (!movedSegment) return segments

  const rippleResult = calculateRippleEdit(movedSegment, segments, delta)

  return segments.map(segment => {
    const affected = rippleResult.affectedSegments.find(a => a.segmentId === segment.id)
    if (affected) {
      return {
        ...segment,
        start: affected.newStart,
        end: affected.newEnd,
      }
    }
    return segment
  })
}

/**
 * Calculate ripple delete - closing a gap when a segment is removed
 */
export function calculateRippleDelete(
  deletedSegment: TrackSegment,
  allSegments: TrackSegment[]
): RippleEditResult {
  const gapSize = deletedSegment.end - deletedSegment.start

  const affectedSegments: RippleEditResult['affectedSegments'] = []

  for (const segment of allSegments) {
    if (segment.id === deletedSegment.id) continue

    // Affect segments that start after the deleted segment ends
    if (segment.start >= deletedSegment.end) {
      affectedSegments.push({
        segmentId: segment.id,
        originalStart: segment.start,
        newStart: segment.start - gapSize,
        originalEnd: segment.end,
        newEnd: segment.end - gapSize,
      })
    }
  }

  return {
    affectedSegments,
    delta: -gapSize,
  }
}

/**
 * Apply ripple delete to a list of segments
 */
export function applyRippleDelete(
  segments: TrackSegment[],
  deletedSegmentId: string
): TrackSegment[] {
  const deletedSegment = segments.find(s => s.id === deletedSegmentId)
  if (!deletedSegment) return segments

  const rippleResult = calculateRippleDelete(deletedSegment, segments)

  return segments
    .filter(segment => segment.id !== deletedSegmentId)
    .map(segment => {
      const affected = rippleResult.affectedSegments.find(a => a.segmentId === segment.id)
      if (affected) {
        return {
          ...segment,
          start: affected.newStart,
          end: affected.newEnd,
        }
      }
      return segment
    })
}

/**
 * Check if ripple edit would cause overlap with locked segments
 */
export function wouldOverlapLocked(
  segments: TrackSegment[],
  movedSegmentId: string,
  delta: number
): boolean {
  const movedSegment = segments.find(s => s.id === movedSegmentId)
  if (!movedSegment) return false

  const newStart = movedSegment.start + delta
  const newEnd = movedSegment.end + delta

  for (const segment of segments) {
    if (segment.id === movedSegment.id) continue
    if (!segment.locked) continue

    // Check for overlap
    if (newStart < segment.end && newEnd > segment.start) {
      return true
    }
  }

  return false
}

/**
 * Get the maximum delta that can be applied without overlapping locked segments
 */
export function getMaxDeltaWithoutOverlap(
  segments: TrackSegment[],
  movedSegmentId: string,
  direction: 'forward' | 'backward'
): number {
  const movedSegment = segments.find(s => s.id === movedSegmentId)
  if (!movedSegment) return 0

  const lockedSegments = segments.filter(s => s.locked && s.id !== movedSegmentId)
  if (lockedSegments.length === 0) return Infinity

  if (direction === 'forward') {
    // Find the nearest locked segment that starts after movedSegment
    let minDistance = Infinity
    for (const locked of lockedSegments) {
      if (locked.start >= movedSegment.end) {
        const distance = locked.start - movedSegment.end
        minDistance = Math.min(minDistance, distance)
      }
    }
    return minDistance === Infinity ? 0 : minDistance
  } else {
    // Find the nearest locked segment that ends before movedSegment
    let minDistance = Infinity
    for (const locked of lockedSegments) {
      if (locked.end <= movedSegment.start) {
        const distance = movedSegment.start - locked.end
        minDistance = Math.min(minDistance, distance)
      }
    }
    return minDistance === Infinity ? 0 : -minDistance
  }
}
