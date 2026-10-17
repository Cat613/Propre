import type { Slide } from '../types'
import type { StoreState } from './types'

export const presetKind = (slide?: Slide) => (slide?.type === 'bible' ? 'bible' : 'song')

export function defaultPreset(state: StoreState, slide?: Slide) {
  const id = presetKind(slide) === 'bible' ? state.defaultBiblePresetId : state.defaultSongPresetId
  return state.globalStylePresets.find((preset) => preset.id === id)
}
