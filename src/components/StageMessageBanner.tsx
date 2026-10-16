import { useEffect, useState } from 'react'
import { messageLayout, type StageMessageStatus } from '../../shared/stage-message'
export default function StageMessageBanner() {
  const [status, setStatus] = useState<StageMessageStatus | null>(null)
  const [size, setSize] = useState({ width: innerWidth, height: innerHeight })
  useEffect(() => {
    const resize = () => setSize({ width: innerWidth, height: innerHeight })
    addEventListener('resize', resize)
    const off = window.ipcRenderer.on('stage-message', (next: StageMessageStatus) =>
      setStatus((prior) => (!prior || next.revision >= prior.revision ? next : prior)),
    )
    // Register before ready so replay cannot be missed on renderer reconnect.
    window.ipcRenderer.ready()
    return () => {
      off()
      removeEventListener('resize', resize)
    }
  }, [])
  const text = status?.message?.text || ''
  const context = document.createElement('canvas').getContext('2d')!
  const layout = messageLayout(text, size.width, size.height, (value, fontSize) => {
    context.font = `600 ${fontSize}px system-ui`
    return context.measureText(value).width
  })
  useEffect(() => {
    if (status?.message)
      window.ipcRenderer.acknowledgeStageMessage(status.message.id, status.revision, layout.fits)
  }, [status, layout.fits])
  if (!status?.message || !layout.fits) return null
  return (
    <div
      className="shrink-0 mx-4 mt-2 rounded-lg border border-amber-300/50 bg-amber-300/10 px-4 py-2 text-amber-100"
      data-stage-message="true"
      style={{
        fontFamily: 'system-ui',
        fontSize: layout.fontSize,
        fontWeight: 600,
        lineHeight: 1.3,
      }}
    >
      <span className="block text-amber-300" style={{ fontSize: 12 }}>
        안내
      </span>
      <div className="whitespace-pre" data-stage-message-text="true">
        {layout.rows.join('\n')}
      </div>
    </div>
  )
}
