import { z } from 'zod'
import type { Presentation } from '../src/types'
export interface SectionOccurrence {
  key: string
  label: string
  firstSlideId: string
  slideIds: string[]
  partId?: string
  stepIndex?: number
  repeatIndex?: number
}
export function sectionIndex(presentation: Presentation): {
  occurrences: SectionOccurrence[]
  warning: boolean
} {
  const slides = presentation.slides,
    form = presentation.songForm
  if (form) {
    const expected = form.sequence
      .flatMap((step, stepIndex) =>
        Array.from({ length: step.repeat }, (_, repeatIndex) =>
          (form.parts.find((part) => part.id === step.partId)?.pages || []).map((_page, page) => ({
            partId: step.partId,
            stepIndex,
            repeatIndex,
            page,
          })),
        ),
      )
      .flat()
    if (
      slides.length === expected.length &&
      slides.every(
        (slide, index) =>
          slide.songPosition &&
          Object.entries(expected[index]).every(
            ([key, value]) =>
              slide.songPosition![key as keyof NonNullable<typeof slide.songPosition>] === value,
          ),
      )
    ) {
      const occurrences: SectionOccurrence[] = []
      for (const slide of slides) {
        const position = slide.songPosition!,
          key = `form:${position.partId}:${position.stepIndex}:${position.repeatIndex}`,
          last = occurrences.at(-1)
        if (last?.key === key) last.slideIds.push(slide.id)
        else
          occurrences.push({
            key,
            label: form.parts.find((part) => part.id === position.partId)!.label,
            firstSlideId: slide.id,
            slideIds: [slide.id],
            partId: position.partId,
            stepIndex: position.stepIndex,
            repeatIndex: position.repeatIndex,
          })
      }
      return { occurrences, warning: false }
    }
  }
  const occurrences: SectionOccurrence[] = []
  for (const slide of slides) {
    const label = slide.label?.trim() && slide.label !== 'None' ? slide.label.trim() : '미지정'
    const last = occurrences.at(-1)
    if (label !== '미지정' && last?.label === label) last.slideIds.push(slide.id)
    else
      occurrences.push({
        key: `label:${slide.id}`,
        label,
        firstSlideId: slide.id,
        slideIds: [slide.id],
      })
  }
  return { occurrences, warning: !!form || slides.some((slide) => !!slide.songPosition) }
}
export function nearestSection(
  occurrences: SectionOccurrence[],
  slides: Presentation['slides'],
  activeSlideId: string | null,
) {
  const index = slides.findIndex((slide) => slide.id === activeSlideId)
  return (
    occurrences.find(
      (occurrence) => slides.findIndex((slide) => slide.id === occurrence.firstSlideId) > index,
    ) || occurrences[0]
  )
}
export const SectionRequest = z
  .object({
    presentationId: z.string().min(1).max(160),
    presentationRevision: z.number().int().nonnegative(),
    firstSlideId: z.string().min(1).max(160),
    expectedOutputGeneration: z.number().int().nonnegative(),
  })
  .strict()
export type SectionTake = z.infer<typeof SectionRequest>
