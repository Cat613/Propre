import type { Presentation, Slide } from '../types'
import { resolveTextStyle } from '../../shared/presentation-style'
import { DEFAULT_STYLE } from '../../shared/model'
/** Measures the configured font, without changing the saved text or shrinking it. */
export function slideLayoutRisk(presentation: Presentation, slide: Slide) {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return { warning: false, unmeasured: true }
  let warning = false,
    unmeasured = false
  const canvasWidth = slide.canvasWidth || 1920,
    canvasHeight = slide.canvasHeight || 1080,
    global = presentation.globalSlideStyle || DEFAULT_STYLE
  const check = (text: string, width: number, height: number, local: Slide['styles']) => {
    const style = resolveTextStyle(slide, global, local),
      font = parseFloat(String(style.fontSize)),
      family = style.fontFamily
    let fontReady = false
    try {
      fontReady = !!document.fonts?.check(`${font}px ${family}`)
    } catch {
      /* Invalid font names require visual confirmation. */
    }
    if (
      text.length > 5000 ||
      !/^\d+(\.\d+)?px$/.test(String(style.fontSize)) ||
      !Number.isFinite(font) ||
      !fontReady
    ) {
      unmeasured = true
      return
    }
    context.font = `${style.fontWeight} ${font}px ${family}`
    if (
      !/^(sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-serif|ui-monospace)$/i.test(family)
    ) {
      const sample = 'mmmmWWWiiii한글1234'
      context.font = `${style.fontWeight} ${font}px monospace`
      const fallbackWidth = context.measureText(sample).width
      context.font = `${style.fontWeight} ${font}px ${family}, monospace`
      if (context.measureText(sample).width === fallbackWidth) {
        unmeasured = true
        return
      }
    }
    let lines = 0
    for (const paragraph of text.split('\n')) {
      lines++
      let row = ''
      for (const character of paragraph) {
        if (row && context.measureText(row + character).width > width) {
          lines++
          row = character
        } else row += character
      }
    }
    if (lines * font * style.lineHeight > height || width <= 0 || height <= 0) warning = true
  }
  if (slide.elements?.length)
    for (const element of slide.elements) {
      const ratioX = element.coordinateUnit === 'pixel' ? 1 : canvasWidth / 100,
        ratioY = element.coordinateUnit === 'pixel' ? 1 : canvasHeight / 100
      if (
        element.x < 0 ||
        element.y < 0 ||
        (element.x + element.width) * ratioX > canvasWidth ||
        (element.y + element.height) * ratioY > canvasHeight ||
        element.rotation
      )
        warning = true
      if (element.type === 'text')
        check(element.text, element.width * ratioX, element.height * ratioY, element.styles)
    }
  else {
    check(
      slide.content || '',
      canvasWidth - (slide.type === 'bible' ? 120 : 40),
      canvasHeight - (slide.type === 'bible' ? 180 : 40),
      slide.styles,
    )
    if (global.offsetX || global.offsetY) warning = true
  }
  return { warning, unmeasured }
}
