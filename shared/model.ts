import type {
  Slide,
  CanvasElement,
  TextElement,
  GlobalSlideStyle,
  Presentation,
} from '../src/types'
export const DEFAULT_STYLE: GlobalSlideStyle = {
  fontSize: 60,
  fontColor: '#ffffff',
  fontFamily: 'sans-serif',
  align: 'center',
  verticalAlign: 'center',
  lineHeight: 1.2,
  backgroundDim: 0,
}
export function slideText(slide: Slide | null | undefined): string {
  if (!slide) return ''
  return slide.elements?.length
    ? slide.elements
        .filter((e): e is TextElement => e.type === 'text')
        .map((e) => e.text)
        .join('\n')
    : slide.content || ''
}
export function normalizeSlide(slide: Slide): Slide {
  const width = slide.canvasWidth || 1920,
    height = slide.canvasHeight || 1080
  const elements = slide.elements?.map((e) => {
    if (e.coordinateUnit) return { ...e }
    // Preserve the legacy per-coordinate convention once, then store explicit percentages.
    return {
      ...e,
      coordinateUnit: 'percent' as const,
      x: e.x <= 100 ? e.x : (e.x / width) * 100,
      y: e.y <= 100 ? e.y : (e.y / height) * 100,
      width: e.width <= 100 ? e.width : (e.width / width) * 100,
      height: e.height <= 100 ? e.height : (e.height / height) * 100,
    }
  })
  const normalized = { ...slide, canvasWidth: width, canvasHeight: height, elements }
  return { ...normalized, content: slideText(normalized) }
}
export function patchSlide(slide: Slide, patch: Partial<Slide>): Slide {
  const next = { ...slide, ...patch }
  if (patch.elements !== undefined) return normalizeSlide(next)
  if (patch.content !== undefined && slide.elements?.length) {
    const texts = slide.elements.filter((e) => e.type === 'text')
    const first = texts[0]?.id
    next.elements = slide.elements
      .filter((e) => e.type !== 'text' || e.id === first)
      .map((e) => (e.id === first ? ({ ...e, text: patch.content } as CanvasElement) : e))
    if (!first)
      next.elements.push({
        id: crypto.randomUUID(),
        type: 'text',
        text: patch.content,
        styles: {},
        x: 1,
        y: 1,
        width: 98,
        height: 98,
        zIndex: 10,
        coordinateUnit: 'percent',
      })
  }
  return normalizeSlide(next)
}
export function normalizePresentation(p: Presentation): Presentation {
  return {
    ...p,
    schemaVersion: 1,
    revision: p.revision || 0,
    slides: p.slides.map(normalizeSlide),
    globalSlideStyle: p.globalSlideStyle || { ...DEFAULT_STYLE },
  }
}
export function mediaKind(url: string): 'image' | 'video' | 'audio' {
  const extension = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase()
  return ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(extension || '')
    ? 'audio'
    : ['mp4', 'webm', 'mov', 'm4v'].includes(extension || '')
      ? 'video'
      : 'image'
}
