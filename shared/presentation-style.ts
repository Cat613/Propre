import type { Slide, GlobalSlideStyle } from '../src/types'
import { DEFAULT_STYLE } from './model'

export function resolveTextStyle(
  slide: Slide,
  globalStyle: GlobalSlideStyle = DEFAULT_STYLE,
  local: Slide['styles'] = slide.styles,
) {
  const custom = local?.useCustomStyle
  return {
    fontSize: custom && local.fontSize ? local.fontSize : `${globalStyle.fontSize}px`,
    color: custom && local.color ? local.color : globalStyle.fontColor,
    fontFamily: custom && local.fontFamily ? local.fontFamily : globalStyle.fontFamily,
    fontWeight: local?.fontWeight || (slide.type === 'bible' ? 'normal' : 'bold'),
    textAlign: custom && local.textAlign ? local.textAlign : globalStyle.align,
    lineHeight: globalStyle.lineHeight || (slide.type === 'bible' ? 1.6 : 1.2),
    justifyContent:
      globalStyle.verticalAlign === 'top'
        ? 'flex-start'
        : globalStyle.verticalAlign === 'bottom'
          ? 'flex-end'
          : 'center',
    textShadow: custom && local.textShadow === false ? undefined : '2px 2px 4px rgba(0,0,0,.7)',
    textOutline: !!(custom && local.textOutline),
  }
}
