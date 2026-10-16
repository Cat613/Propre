import { useEffect, useRef, useState } from 'react'
import type { TimerRuntime } from '../../shared/service-timer'
export function useServiceTimer(runtime: TimerRuntime | null) {
  const [now, setNow] = useState(performance.now()),
    sample = useRef({ runtime, received: performance.now() })
  if (sample.current.runtime !== runtime) sample.current = { runtime, received: performance.now() }
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 250)
    return () => clearInterval(timer)
  }, [])
  if (!runtime) return null
  const delta = Math.max(0, now - sample.current.received)
  return {
    ...runtime,
    elapsedMs: runtime.elapsedMs + (runtime.state === 'running' ? delta : 0),
    cueElapsedMs: runtime.cueElapsedMs + (runtime.state !== 'finished' ? delta : 0),
  }
}
