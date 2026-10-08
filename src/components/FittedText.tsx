import { useRef, useLayoutEffect, type CSSProperties, type ReactNode } from 'react'

export default function FittedText({
  text,
  style,
  children,
  layoutKey,
}: {
  text: string
  style: CSSProperties
  children?: ReactNode
  layoutKey?: string
}) {
  const box = useRef<HTMLDivElement>(null),
    inner = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    let disposed = false
    const fit = () => {
      const el = inner.current,
        outer = box.current
      if (disposed || !el || !outer) return
      el.style.fontSize = String(style.fontSize || '60px')
      let max = parseFloat(getComputedStyle(el).fontSize) || 60,
        min = 8,
        best = 8
      while (max - min > 0.5) {
        const mid = (min + max) / 2
        el.style.fontSize = mid + 'px'
        if (el.scrollHeight <= outer.clientHeight && el.scrollWidth <= outer.clientWidth) {
          best = mid
          min = mid
        } else max = mid
      }
      el.style.fontSize = best + 'px'
    }
    const observer = new ResizeObserver(fit)
    if (box.current) observer.observe(box.current)
    fit()
    void document.fonts?.ready.then(fit)
    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [text, style.fontSize, style.fontFamily, style.fontWeight, style.lineHeight, layoutKey])
  return (
    <div
      ref={box}
      data-fitted-text="true"
      style={{
        ...style,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: style.justifyContent || 'center',
      }}
    >
      <div
        ref={inner}
        data-fitted-content="true"
        style={{ width: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
      >
        {children ?? text}
      </div>
    </div>
  )
}
