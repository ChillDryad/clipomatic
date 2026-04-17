import { useEffect, useRef, useCallback, useState } from 'react'

interface WaveformData {
  peaks: number[]      // 1000 points, normalized 0-1
  rms: number[]        // 1000 points, normalized 0-1
  duration: number
  sample_rate: number
  channels: number
  num_points: number
}

interface Props {
  width: number
  height: number
  audioPath?: string | null
  waveformUrl?: string
  currentTime: number
  duration: number
  color?: string
  backgroundColor?: string
  onSeek?: (time: number) => void
}

export function WaveformCanvas({
  width,
  height,
  audioPath,
  waveformUrl,
  currentTime,
  duration,
  color = '#cba6f7',
  backgroundColor = 'rgba(49, 50, 68, 0.3)',
  onSeek,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Generate synthetic waveform for demo/testing
  const generateSyntheticWaveform = useCallback((duration: number, numPoints: number = 1000): WaveformData => {
    const peaks: number[] = []
    const rms: number[] = []
    for (let i = 0; i < numPoints; i++) {
      // Create a pseudo-random waveform with some structure
      const t = i / numPoints
      const base = Math.sin(t * Math.PI * 4) * 0.5 + 0.5
      const noise = Math.random() * 0.3
      const value = Math.min(1, Math.max(0, base + noise))
      peaks.push(value)
      rms.push(value * 0.7) // RMS is typically lower than peaks
    }
    return {
      peaks,
      rms,
      duration,
      sample_rate: 44100,
      channels: 1,
      num_points: numPoints,
    }
  }, [])

  // Fetch waveform from backend
  useEffect(() => {
    if (!audioPath && !waveformUrl) {
      // Generate synthetic waveform if no audio source
      const synthetic = generateSyntheticWaveform(duration, Math.floor(width / 2))
      setWaveformData(synthetic)
      return
    }

    let cancelled = false

    const fetchWaveform = async () => {
      setLoading(true)
      setError(null)

      try {
        const url = waveformUrl || `/api/audio/waveform?path=${encodeURIComponent(audioPath!)}`
        const response = await fetch(url)

        if (!response.ok) {
          throw new Error(`Waveform fetch failed: ${response.status}`)
        }

        const data: WaveformData = await response.json()

        if (!cancelled) {
          setWaveformData(data)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Waveform fetch failed, using synthetic waveform:', err)
          // Fall back to synthetic waveform
          const synthetic = generateSyntheticWaveform(duration, Math.floor(width / 2))
          setWaveformData(synthetic)
          setLoading(false)
        }
      }
    }

    fetchWaveform()
    return () => {
      cancelled = true
    }
  }, [audioPath, waveformUrl, duration, width, generateSyntheticWaveform])

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !waveformData) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { peaks, rms } = waveformData
    const dpr = window.devicePixelRatio || 1

    // Scale canvas for retina displays
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    // Clear canvas
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, width, height)

    // Draw waveform using peaks (more visually prominent)
    const barWidth = width / peaks.length
    const centerY = height / 2

    ctx.fillStyle = color

    for (let i = 0; i < peaks.length; i++) {
      const amplitude = peaks[i]
      const barHeight = amplitude * (height * 0.8)
      const x = i * barWidth

      // Draw centered bar
      ctx.fillRect(x, centerY - barHeight / 2, barWidth - 0.5, barHeight)
    }

    // Draw playhead overlay
    if (currentTime > 0 && currentTime < duration) {
      const playheadX = (currentTime / duration) * width

      ctx.fillStyle = 'rgba(243, 139, 168, 0.5)'
      ctx.fillRect(0, 0, playheadX, height)

      ctx.strokeStyle = '#f38ba8'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(playheadX, 0)
      ctx.lineTo(playheadX, height)
      ctx.stroke()
    }
  }, [waveformData, width, height, currentTime, duration, color, backgroundColor])

  // Fetch waveform from backend
  useEffect(() => {
    if (!audioPath && !waveformUrl) {
      // Generate synthetic waveform if no audio source
      const synthetic = generateSyntheticWaveform(duration, 1000)
      setWaveformData(synthetic)
      return
    }

    let cancelled = false

    const fetchWaveform = async () => {
      setLoading(true)
      setError(null)

      try {
        const url = waveformUrl || `/api/audio/waveform?audio_path=${encodeURIComponent(audioPath!)}`
        const response = await fetch(url)

        if (!response.ok) {
          throw new Error(`Waveform fetch failed: ${response.status}`)
        }

        const data: WaveformData = await response.json()

        if (!cancelled) {
          setWaveformData(data)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Waveform fetch failed, using synthetic waveform:', err)
          // Fall back to synthetic waveform
          const synthetic = generateSyntheticWaveform(duration, 1000)
          setWaveformData(synthetic)
          setLoading(false)
        }
      }
    }

    fetchWaveform()
    return () => {
      cancelled = true
    }
  }, [audioPath, waveformUrl, duration, generateSyntheticWaveform])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSeek) return

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = e.clientX - rect.left
    const time = (x / width) * duration
    onSeek(Math.max(0, Math.min(duration, time)))
  }, [onSeek, width, duration])

  return (
    <div className="relative" style={{ width, height }}>
      <canvas
        ref={canvasRef}
        className="rounded cursor-pointer"
        style={{ width, height }}
        onClick={handleClick}
        aria-label="Audio waveform. Click to seek."
        role="application"
      />

      {/* Loading indicator */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded">
          <div className="flex items-center gap-2 text-xs text-[var(--ctp-subtext)]">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Generating waveform...
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded">
          <div className="text-xs text-[var(--ctp-red)]">{error}</div>
        </div>
      )}

      {/* No audio source */}
      {!audioPath && !waveformUrl && !loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-xs text-[var(--ctp-subtext)]">No audio track</div>
        </div>
      )}
    </div>
  )
}
