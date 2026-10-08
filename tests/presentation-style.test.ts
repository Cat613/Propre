import { describe, expect, it } from 'vitest'
import { resolveTextStyle } from '../shared/presentation-style'
import { DEFAULT_STYLE } from '../shared/model'
import { parseStage } from '../shared/schema'
import { stageSnapshot } from '../src/store/helpers'
import type { StoreState } from '../src/store/types'

describe('main and monitor text style contract', () => {
  it('inherits document style without enabling dormant custom values', () => {
    const style = {
      ...DEFAULT_STYLE,
      fontColor: '#abc123',
      fontFamily: 'serif',
      align: 'left' as const,
    }
    expect(
      resolveTextStyle(
        { id: 'song', type: 'text', styles: { color: '#ff0000', textAlign: 'right' } },
        style,
      ),
    ).toMatchObject({
      color: '#abc123',
      fontFamily: 'serif',
      textAlign: 'left',
      fontWeight: 'bold',
    })
  })
  it('applies the same explicit text overrides for any display', () => {
    expect(
      resolveTextStyle({
        id: 'song',
        type: 'text',
        styles: {
          useCustomStyle: true,
          color: '#ff0000',
          fontFamily: 'monospace',
          textAlign: 'right',
          fontWeight: '400',
          textShadow: false,
        },
      }),
    ).toMatchObject({
      color: '#ff0000',
      fontFamily: 'monospace',
      textAlign: 'right',
      fontWeight: '400',
      textShadow: undefined,
    })
  })
  it('keeps song and scripture type defaults distinct when no line spacing is configured', () => {
    const style = { ...DEFAULT_STYLE, lineHeight: undefined }
    expect(resolveTextStyle({ id: 'song', type: 'text' }, style)).toMatchObject({
      fontWeight: 'bold',
      lineHeight: 1.2,
    })
    expect(resolveTextStyle({ id: 'verse', type: 'bible' }, style)).toMatchObject({
      fontWeight: 'normal',
      lineHeight: 1.6,
    })
  })
  it('keeps style information and reference in the validated stage payload', () => {
    expect(
      parseStage({
        current: {
          id: 'verse',
          type: 'bible',
          content: '합성 성경 본문',
          bibleReference: '합성 1:1',
        },
        next: null,
        globalSlideStyle: { ...DEFAULT_STYLE, bibleRefPosition: 'bottom-right' },
      }),
    ).toMatchObject({
      current: { bibleReference: '합성 1:1' },
      globalSlideStyle: { bibleRefPosition: 'bottom-right' },
    })
    expect(parseStage({ current: null, next: null })).toEqual({ current: null, next: null })
    expect(() =>
      parseStage({
        current: null,
        next: null,
        globalSlideStyle: { ...DEFAULT_STYLE, fontSize: -1 },
      }),
    ).toThrow()
  })
  it('sends the current document style with both current and next slides', () => {
    const slides = [
      { id: 'a', type: 'text' as const },
      { id: 'b', type: 'bible' as const, bibleReference: '합성 1:1' },
    ]
    const state = {
      slides,
      activeSlideId: 'a',
      globalSlideStyle: DEFAULT_STYLE,
      stageCurrentFontSize: 90,
      stageNextFontSize: 40,
    } as StoreState
    expect(stageSnapshot(state)).toMatchObject({
      current: slides[0],
      next: slides[1],
      globalSlideStyle: DEFAULT_STYLE,
      settings: { currentFontSize: 90, nextFontSize: 40 },
    })
    expect(stageSnapshot({ ...state, activeSlideId: null })).toMatchObject({
      current: null,
      next: null,
    })
  })
})
