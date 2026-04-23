import { StoreSlice, SettingsSlice } from '../types'
import { syncOutputState } from '../helpers'
import { DEFAULT_SCREEN_LOOK, LayerType, ScreenLook, GlobalStylePreset } from '../../types'

const initialScreenLooks = {
    'main': { ...DEFAULT_SCREEN_LOOK },
    'chroma': {
        ...DEFAULT_SCREEN_LOOK,
        background: { isVisible: false } // Default Chroma behaviour: no background
    }
}

export const createSettingsSlice: StoreSlice<SettingsSlice> = (set, get) => {
    // Asynchronously load the API key from secure OS storage
    window.ipcRenderer.getApiKey().then(key => {
        if (key) set({ geminiApiKey: key })
    }).catch(console.error)

    return {
        geminiApiKey: null,
        isGreenScreen: false,
        screenLooks: initialScreenLooks,
        globalStylePresets: [],
        defaultSongPresetId: null,
        defaultBiblePresetId: null,

        setGeminiKey: (key: string | null) => {
            window.ipcRenderer.setApiKey(key).catch(console.error)
            set({ geminiApiKey: key })
        },

        toggleGreenScreen: () => {
            const newState = !get().isGreenScreen
            set({ isGreenScreen: newState })
            syncOutputState(get)
        },

        updateScreenLook: (screenId: string, layer: LayerType, override: Partial<ScreenLook[LayerType]>) => {
            set((state) => {
                const currentLook = state.screenLooks[screenId] || { ...DEFAULT_SCREEN_LOOK }
                const currentLayerLook = currentLook[layer]

                return {
                    screenLooks: {
                        ...state.screenLooks,
                        [screenId]: {
                            ...currentLook,
                            [layer]: {
                                ...currentLayerLook,
                                ...override
                            }
                        }
                    }
                }
            })
            syncOutputState(get)
        },

        addGlobalStylePreset: (preset: GlobalStylePreset) => {
            const currentPresets = get().globalStylePresets
            // If preset with same ID exists, update it. Else append.
            const existingIndex = currentPresets.findIndex(p => p.id === preset.id)
            let newPresets
            if (existingIndex >= 0) {
                newPresets = [...currentPresets]
                newPresets[existingIndex] = preset
            } else {
                newPresets = [...currentPresets, preset]
            }
            set({ globalStylePresets: newPresets })
            localStorage.setItem('propre-style-presets', JSON.stringify(newPresets))
        },

        deleteGlobalStylePreset: (id: string) => {
            const newPresets = get().globalStylePresets.filter(p => p.id !== id)

            // Check if deleted preset was default
            const updates: Partial<SettingsSlice> = { globalStylePresets: newPresets }
            if (get().defaultSongPresetId === id) updates.defaultSongPresetId = null
            if (get().defaultBiblePresetId === id) updates.defaultBiblePresetId = null

            set(updates)
            localStorage.setItem('propre-style-presets', JSON.stringify(newPresets))

            // Re-save defaults to sync them if they were reset
            localStorage.setItem('propre-default-song-preset', updates.defaultSongPresetId !== undefined ? '' : (get().defaultSongPresetId || ''))
            localStorage.setItem('propre-default-bible-preset', updates.defaultBiblePresetId !== undefined ? '' : (get().defaultBiblePresetId || ''))
        },

        setDefaultPreset: (type: 'song' | 'bible', presetId: string | null) => {
            if (type === 'song') {
                set({ defaultSongPresetId: presetId })
                localStorage.setItem('propre-default-song-preset', presetId || '')
            } else if (type === 'bible') {
                set({ defaultBiblePresetId: presetId })
                localStorage.setItem('propre-default-bible-preset', presetId || '')
            }
        },

        loadPresetsFromStorage: () => {
            const stored = localStorage.getItem('propre-style-presets')
            if (stored) {
                try {
                    const presets = JSON.parse(stored)
                    set({ globalStylePresets: presets })
                } catch (e) { console.error('Failed to parse presets', e) }
            }
            const defaultSong = localStorage.getItem('propre-default-song-preset')
            if (defaultSong) set({ defaultSongPresetId: defaultSong })

            const defaultBible = localStorage.getItem('propre-default-bible-preset')
            if (defaultBible) set({ defaultBiblePresetId: defaultBible })
        }
    }
}
