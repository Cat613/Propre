import { StoreSlice, SettingsSlice } from '../types'
import { DEFAULT_SCREEN_LOOK } from '../../types'
import { presetKind } from '../presets'
export const createSettingsSlice: StoreSlice<SettingsSlice> = (set, get) => ({
  isGreenScreen: false,
  screenLooks: {
    main: structuredClone(DEFAULT_SCREEN_LOOK),
    chroma: { ...structuredClone(DEFAULT_SCREEN_LOOK), background: { isVisible: false } },
  },
  globalStylePresets: [],
  defaultSongPresetId: null,
  defaultBiblePresetId: null,
  stageCurrentFontSize: 80,
  stageNextFontSize: 36,
  setStageCurrentFontSize: (size) =>
    set({ stageCurrentFontSize: Math.min(300, Math.max(10, size)) }),
  setStageNextFontSize: (size) => set({ stageNextFontSize: Math.min(300, Math.max(10, size)) }),
  toggleGreenScreen: () => set({ isGreenScreen: !get().isGreenScreen }),
  updateScreenLook: (screenId, layer, override) => {
    if (!['main', 'chroma'].includes(screenId)) return
    set((state) => ({
      screenLooks: {
        ...state.screenLooks,
        [screenId]: {
          ...state.screenLooks[screenId],
          [layer]: { ...state.screenLooks[screenId][layer], ...override },
        },
      },
    }))
  },
  addGlobalStylePreset: (preset) =>
    set((state) => ({
      globalStylePresets: [...state.globalStylePresets.filter((p) => p.id !== preset.id), preset],
    })),
  deleteGlobalStylePreset: (id) =>
    set((state) => ({
      globalStylePresets: state.globalStylePresets.filter((p) => p.id !== id),
      defaultSongPresetId: state.defaultSongPresetId === id ? null : state.defaultSongPresetId,
      defaultBiblePresetId: state.defaultBiblePresetId === id ? null : state.defaultBiblePresetId,
      activePresetId: state.activePresetId === id ? null : state.activePresetId,
    })),
  setDefaultPreset: (type, id) => {
    const state = get()
    const slide = state.slides.find((s) => s.id === state.activeSlideId) || state.slides[0]
    const preset = state.globalStylePresets.find((p) => p.id === id)
    set({
      ...(type === 'song' ? { defaultSongPresetId: id } : { defaultBiblePresetId: id }),
      ...(preset && presetKind(slide) === type
        ? { globalSlideStyle: { ...preset.style }, activePresetId: preset.id }
        : {}),
    })
  },
})
