import type { StoreState } from './types'
import type { OutputState, StageData } from '../types'
export function outputSnapshot(state: StoreState): OutputState {
  const look = state.screenLooks[state.isGreenScreen ? 'chroma' : 'main']
  return {
    type: 'state-update',
    isGreenScreen: state.serviceBlackout ? false : state.isGreenScreen,
    globalSlideStyle: state.globalSlideStyle,
    layers: {
      audio: look.audio.isVisible ? state.activeAudio : null,
      background:
        look.background.isVisible && !state.serviceBlackout
          ? state.activeBackground
          : { type: 'none' },
      slide:
        look.slide.isVisible && !state.serviceBlackout
          ? state.slides.find((s) => s.id === state.activeSlideId) || null
          : null,
      announcement:
        look.announcement.isVisible && !state.serviceBlackout ? state.activeAnnouncement : null,
      props: look.prop.isVisible && !state.serviceBlackout ? state.activeProps : [],
      message: look.message.isVisible && !state.serviceBlackout ? state.activeMessage : null,
    },
  }
}
export function stageSnapshot(state: StoreState): StageData {
  const index = state.slides.findIndex((s) => s.id === state.activeSlideId)
  return {
    current: state.slides[index] || null,
    next: index >= 0 ? state.slides[index + 1] || null : null,
    globalSlideStyle: state.globalSlideStyle,
    settings: {
      currentFontSize: state.stageCurrentFontSize,
      nextFontSize: state.stageNextFontSize,
    },
  }
}
