import { useRef, useLayoutEffect, useState, type ReactNode } from 'react'
export default function CanvasViewport({
  width = 1920,
  height = 1080,
  scale: manual,
  children,
}: {
  width?: number
  height?: number
  scale?: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null),
    [scale, setScale] = useState(manual || 1)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () =>
      setScale(
        manual ?? Math.max(0.001, Math.min(el.clientWidth / width, el.clientHeight / height)),
      )
    const observer = new ResizeObserver(update)
    observer.observe(el)
    update()
    return () => observer.disconnect()
  }, [width, height, manual])
  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden">
      <div
        data-canvas="true"
        style={{
          width,
          height,
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center',
        }}
      >
        {children}
      </div>
    </div>
  )
}
