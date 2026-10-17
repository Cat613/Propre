import type { CSSProperties } from 'react'
import type { Slide, TextElement, GlobalSlideStyle, CanvasElement } from '../types'
import { DEFAULT_STYLE, normalizeSlide } from '../../shared/model'
import CanvasViewport from './CanvasViewport'
import FittedText from './FittedText'
import { resolveTextStyle } from '../../shared/presentation-style'
interface Props {
  slide: Slide
  width?: number
  height?: number
  scale?: number
  overrideStyle?: CSSProperties
  globalStyleOverride?: GlobalSlideStyle
  disableDimOverlay?: boolean
  isGreenScreen?: boolean
}
const mediaError = () => window.ipcRenderer?.reportMediaError()
export default function ScaledSlide({
  slide: raw,
  width,
  height,
  scale,
  overrideStyle,
  globalStyleOverride,
  disableDimOverlay,
  isGreenScreen,
}: Props) {
  const slide = normalizeSlide(raw),
    cw = slide.canvasWidth || 1920,
    ch = slide.canvasHeight || 1080,
    g = globalStyleOverride || DEFAULT_STYLE,
    s = slide.styles || {}
  const elementStyle = (e: CanvasElement): CSSProperties => ({
    position: 'absolute',
    left: e.coordinateUnit === 'pixel' ? e.x : `${e.x}%`,
    top: e.coordinateUnit === 'pixel' ? e.y : `${e.y}%`,
    width: e.coordinateUnit === 'pixel' ? e.width : `${e.width}%`,
    height: e.coordinateUnit === 'pixel' ? e.height : `${e.height}%`,
    zIndex: e.zIndex,
    opacity: e.opacity ?? 1,
    transform: e.rotation ? `rotate(${e.rotation}deg)` : undefined,
  })
  const textStyle = (local: Slide['styles']): CSSProperties => {
    const { textOutline, ...style } = resolveTextStyle(slide, g, local)
    return {
      ...style,
      WebkitTextStroke: textOutline ? '1px black' : isGreenScreen ? '2px black' : undefined,
    }
  }
  const hasBackground = overrideStyle?.backgroundImage !== 'none' && !isGreenScreen
  const dim = s.useCustomStyle ? s.backgroundDim || 0 : g.backgroundDim || 0
  const refPosition = g.bibleRefPosition || 'top-left'
  return (
    <div className="h-full w-full" style={{ width: width || '100%', height: height || '100%' }}>
      <CanvasViewport width={cw} height={ch} scale={scale}>
        <div
          className="absolute inset-0"
          style={{ backgroundColor: s.backgroundColor || 'black', ...overrideStyle }}
        >
          {hasBackground &&
            slide.backgroundUrl &&
            (slide.type === 'video' ? (
              <video
                src={slide.backgroundUrl}
                autoPlay
                muted
                loop
                className="absolute inset-0 w-full h-full object-cover"
                onError={mediaError}
              />
            ) : (
              <img
                src={slide.backgroundUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                onError={mediaError}
              />
            ))}
          {!disableDimOverlay && dim > 0 && (
            <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${dim})` }} />
          )}
          {slide.elements?.length ? (
            slide.elements.map((e) => {
              const style = elementStyle(e)
              if (e.type === 'text')
                return (
                  <FittedText
                    key={e.id}
                    text={(e as TextElement).text}
                    style={{
                      ...textStyle(e.styles),
                      ...style,
                      backgroundColor: e.styles.backgroundColor,
                    }}
                  />
                )
              if (e.type === 'image' || e.type === 'video')
                return e.type === 'video' ? (
                  <video
                    key={e.id}
                    src={e.url}
                    autoPlay
                    muted
                    loop
                    style={{ ...style, objectFit: e.objectFit || 'contain' }}
                    onError={mediaError}
                  />
                ) : (
                  <img
                    key={e.id}
                    src={e.url}
                    alt=""
                    style={{ ...style, objectFit: e.objectFit || 'contain' }}
                    onError={mediaError}
                  />
                )
              if (e.type !== 'shape') return null
              if (e.shapeType === 'line')
                return (
                  <svg key={e.id} style={style} viewBox="0 0 100 100" preserveAspectRatio="none">
                    <line
                      x1="0"
                      y1="50"
                      x2="100"
                      y2="50"
                      stroke={e.borderColor || e.backgroundColor || 'white'}
                      strokeWidth={e.borderWidth || 2}
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                )
              return (
                <div
                  key={e.id}
                  style={{
                    ...style,
                    backgroundColor: e.backgroundColor || 'transparent',
                    border: e.borderWidth
                      ? `${e.borderWidth}px solid ${e.borderColor || 'white'}`
                      : undefined,
                    borderRadius: e.shapeType === 'ellipse' ? '50%' : undefined,
                  }}
                />
              )
            })
          ) : (
            <FittedText
              text={slide.content || ''}
              style={{
                ...textStyle(s),
                position: 'absolute',
                left: slide.type === 'bible' ? 60 : 20,
                top: slide.type === 'bible' ? 120 : 20,
                width: cw - (slide.type === 'bible' ? 120 : 40),
                height: ch - (slide.type === 'bible' ? 180 : 40),
                transform: `translate(${g.offsetX || 0}px,${g.offsetY || 0}px)`,
              }}
            />
          )}
          {slide.type === 'bible' && slide.bibleReference && (
            <div
              className="absolute z-50 font-bold"
              style={{
                fontSize: g.bibleRefFontSize || 48,
                color: g.bibleRefFontColor || '#EAB308',
                fontFamily: g.bibleRefFontFamily || 'serif',
                [refPosition.startsWith('top') ? 'top' : 'bottom']: g.bibleRefOffsetY ?? 64,
                [refPosition.endsWith('left') ? 'left' : 'right']: g.bibleRefOffsetX ?? 80,
              }}
            >
              {slide.bibleReference}
            </div>
          )}
        </div>
      </CanvasViewport>
    </div>
  )
}
