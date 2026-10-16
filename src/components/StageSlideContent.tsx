import type { Slide, TextElement, GlobalSlideStyle } from '../types'
import { DEFAULT_STYLE, slideText } from '../../shared/model'
import { resolveTextStyle } from '../../shared/presentation-style'
import FittedText from './FittedText'

export default function StageSlideContent({
  slide,
  globalStyle = DEFAULT_STYLE,
  fontSize,
}: {
  slide: Slide
  globalStyle?: GlobalSlideStyle
  fontSize: number
}) {
  const elements = slide.elements?.filter((e): e is TextElement => e.type === 'text')
  const { textOutline, ...style } = resolveTextStyle(
    slide,
    globalStyle,
    elements?.[0]?.styles || slide.styles,
  )
  const referencePosition = globalStyle.bibleRefPosition || 'top-left'
  const reference =
    slide.type === 'bible' && slide.bibleReference ? (
      <div
        data-stage-reference="true"
        className="shrink-0 break-words"
        style={{
          color: globalStyle.bibleRefFontColor || '#EAB308',
          fontFamily: globalStyle.bibleRefFontFamily || 'serif',
          fontSize: `min(${Math.min(globalStyle.bibleRefFontSize || 48, fontSize * 0.6)}px, 3vh)`,
          fontWeight: 'bold',
          lineHeight: 1.2,
          textAlign: referencePosition.endsWith('right') ? 'right' : 'left',
        }}
      >
        {slide.bibleReference}
      </div>
    ) : null
  return (
    <div
      className="flex flex-col h-full w-full min-h-0"
      style={{ gap: 'clamp(4px, 1vh, 12px)' }}
      data-stage-kind={slide.type}
    >
      {referencePosition.startsWith('top') && reference}
      <FittedText
        text={slideText(slide)}
        layoutKey={JSON.stringify([globalStyle, slide.styles, elements?.map((e) => e.styles)])}
        style={{
          ...style,
          fontSize: `${fontSize}px`,
          flex: '1 1 0',
          minHeight: 0,
          WebkitTextStroke: textOutline ? '1px black' : undefined,
        }}
      >
        {elements?.length ? (
          elements.map((element) => {
            const local = resolveTextStyle(slide, globalStyle, element.styles)
            return (
              <div
                key={element.id}
                data-stage-text="true"
                style={{
                  color: local.color,
                  fontFamily: local.fontFamily,
                  fontWeight: local.fontWeight,
                  textAlign: local.textAlign,
                  lineHeight: local.lineHeight,
                  textShadow: local.textShadow,
                  WebkitTextStroke: local.textOutline ? '1px black' : undefined,
                  textWrap: 'balance',
                  wordBreak: 'keep-all',
                }}
              >
                {element.text}
              </div>
            )
          })
        ) : (
          <div data-stage-text="true" style={{ textWrap: 'balance', wordBreak: 'keep-all' }}>
            {slide.content || ''}
          </div>
        )}
      </FittedText>
      {referencePosition.startsWith('bottom') && reference}
    </div>
  )
}
