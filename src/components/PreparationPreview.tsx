import { useEffect, useState } from 'react'
import type { PreparedPreview } from '../../shared/automation'
import ScaledSlide from './ScaledSlide'
export default function PreparationPreview() {
  const [preview, setPreview] = useState<(PreparedPreview & { id: string }) | null>(null)
  useEffect(() => {
    const dispose = window.ipcRenderer.on('ai-preview', (snapshot) => setPreview(snapshot))
    window.ipcRenderer.ready()
    return dispose
  }, [])
  useEffect(() => {
    if (!preview) return
    let canceled = false
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    void (async () => {
      await document.fonts.ready
      await frame()
      const images = Array.from(document.images)
      await Promise.all(images.map((img) => img.decode().catch(() => {})))
      await frame()
      await frame()
      if (!canceled) window.ipcRenderer.previewRendered(preview.id)
    })()
    return () => {
      canceled = true
    }
  }, [preview])
  return (
    <div className="bg-black" style={{ width: 960, height: 540 }}>
      {preview && <ScaledSlide slide={preview.slide} globalStyleOverride={preview.style} />}
    </div>
  )
}
