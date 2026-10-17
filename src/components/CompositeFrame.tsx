import { useEffect, useState, type CSSProperties } from 'react'
import type { OutputState, PropItem } from '../types'
import CanvasViewport from './CanvasViewport'
import ScaledSlide from './ScaledSlide'
function Prop({ prop, green }: { prop: PropItem; green: boolean }) {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    if (prop.type !== 'clock' && prop.type !== 'timer') return
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [prop.type])
  if (prop.isVisible === false) return null
  let style: CSSProperties = {
    position: 'absolute',
    transform: `scale(${prop.scale ?? 1})`,
    transformOrigin: prop.position.replace('-', ' '),
  }
  if (prop.position === 'custom' || prop.position === 'center')
    style = {
      ...style,
      left: `${prop.customX ?? 50}%`,
      top: `${prop.customY ?? 50}%`,
      transform: `translate(-50%, -50%) scale(${prop.scale ?? 1})`,
    }
  else {
    if (prop.position.includes('top')) style.top = 32
    if (prop.position.includes('bottom')) style.bottom = 32
    if (prop.position.includes('left')) style.left = 32
    if (prop.position.includes('right')) style.right = 32
  }
  const content =
    prop.type === 'clock'
      ? time.toLocaleTimeString('ko-KR', { hour12: false })
      : prop.type === 'timer'
        ? Math.max(0, Math.ceil((Number(prop.content) - time.getTime()) / 1000)).toString()
        : prop.content
  return (
    <div style={style}>
      {(prop.type === 'logo' || prop.type === 'image') && prop.url ? (
        <img
          src={prop.url}
          alt=""
          style={{ maxWidth: 600, maxHeight: 400 }}
          onError={() => window.ipcRenderer.reportMediaError()}
        />
      ) : (
        <div
          style={{
            fontSize: 76,
            color: 'white',
            fontWeight: 'bold',
            whiteSpace: 'pre-wrap',
            WebkitTextStroke: green ? '2px black' : undefined,
            textShadow: '4px 4px 8px black',
          }}
        >
          {content}
        </div>
      )}
    </div>
  )
}
export default function CompositeFrame({ state }: { state: OutputState }) {
  const { layers, globalSlideStyle: g, isGreenScreen: green } = state,
    slide = layers.slide
  if (state.source?.kind === 'pdf')
    return (
      <img
        data-output-source="pdf"
        src={state.source.frameURL}
        alt=""
        className="h-full w-full object-contain bg-black"
        onError={() => window.ipcRenderer.reportMediaError()}
      />
    )
  if (state.source?.kind === 'web' && state.source.frozenFrame)
    return (
      <img
        data-output-source="web-frozen"
        src={state.source.frozenFrame}
        alt=""
        className="h-full w-full object-contain bg-black"
      />
    )
  if (state.source?.kind === 'web')
    return <div data-output-source="web" className="h-full w-full bg-black" />
  const dim = slide?.styles?.useCustomStyle
    ? slide.styles.backgroundDim || 0
    : g?.backgroundDim || 0
  return (
    <CanvasViewport width={slide?.canvasWidth || 1920} height={slide?.canvasHeight || 1080}>
      <div
        data-output-surface="true"
        className="absolute inset-0 overflow-hidden"
        style={{ background: green ? '#00ff00' : '#000' }}
      >
        {!green &&
          layers.background.url &&
          (layers.background.type === 'video' ? (
            <video
              className="absolute inset-0 w-full h-full object-cover"
              src={layers.background.url}
              autoPlay
              loop
              muted
              onError={() => window.ipcRenderer.reportMediaError()}
            />
          ) : (
            <img
              className="absolute inset-0 w-full h-full object-cover"
              src={layers.background.url}
              alt=""
              onError={() => window.ipcRenderer.reportMediaError()}
            />
          ))}
        {!green && dim > 0 && (
          <div className="absolute inset-0" style={{ background: `rgba(0,0,0,${dim})` }} />
        )}
        {slide && (
          <div className="absolute inset-0 z-10">
            <ScaledSlide
              slide={slide}
              globalStyleOverride={g}
              overrideStyle={{ backgroundColor: 'transparent', backgroundImage: 'none' }}
              disableDimOverlay
              isGreenScreen={green}
            />
          </div>
        )}
        {layers.announcement && (
          <div className="absolute inset-0 z-20">
            <ScaledSlide
              slide={layers.announcement}
              globalStyleOverride={g}
              isGreenScreen={green}
            />
          </div>
        )}
        <div className="absolute inset-0 z-30 pointer-events-none">
          {layers.props.map((p) => (
            <Prop key={p.id} prop={p} green={!!green} />
          ))}
        </div>
        {layers.message && (
          <div
            className="absolute bottom-0 inset-x-0 z-40 overflow-hidden whitespace-nowrap"
            style={{
              background: 'rgba(0,0,0,.7)',
              padding: '16px 32px',
              fontSize: 48,
              color: '#facc15',
              fontWeight: 'bold',
            }}
          >
            <div
              style={{
                display: 'inline-block',
                animation: layers.message.isScrolling
                  ? `marquee ${layers.message.speed || 15}s linear infinite`
                  : undefined,
              }}
            >
              {layers.message.content}
            </div>
          </div>
        )}
      </div>
    </CanvasViewport>
  )
}
