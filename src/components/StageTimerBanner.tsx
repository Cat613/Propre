import { useEffect, useState } from 'react'
import { timerDisplay, type TimerRuntime } from '../../shared/service-timer'
import { useServiceTimer } from '../hooks/useServiceTimer'
export default function StageTimerBanner() {
  const [sample, setSample] = useState<TimerRuntime | null>(null),
    timer = useServiceTimer(sample)
  useEffect(() => {
    const off = window.ipcRenderer.on('service-timer-stage', setSample)
    window.ipcRenderer.ready()
    return off
  }, [])
  if (!timer || !timer.showOnStage || timer.state === 'finished') return null
  const display = timerDisplay(timer)
  return (
    <div
      className={`mx-4 mt-2 flex shrink-0 items-baseline justify-center gap-3 rounded-lg border px-4 py-1 font-mono ${display.overtime ? 'border-red-300/50 text-red-200' : display.warning ? 'border-amber-300/50 text-amber-200' : 'border-white/20 text-white'}`}
      data-stage-timer="true"
      style={{ fontSize: 'clamp(20px, 5vh, 40px)', lineHeight: 1.2 }}
    >
      <span>{display.text}</span>
      <span style={{ fontSize: '0.5em' }}>
        {display.label}
        {timer.state === 'paused' ? ' · 일시정지' : ''}
      </span>
    </div>
  )
}
