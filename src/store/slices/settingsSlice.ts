import { StoreSlice, SettingsSlice } from '../types'
import { syncOutputState } from '../helpers'
import { DEFAULT_SCREEN_LOOK, LayerType, ScreenLook } from '../../types'

const initialScreenLooks = {
    'main': { ...DEFAULT_SCREEN_LOOK },
    'chroma': {
        ...DEFAULT_SCREEN_LOOK,
        background: { isVisible: false } // Default Chroma behaviour: no background
    }
}

export const createSettingsSlice: StoreSlice<SettingsSlice> = (set, get) => ({
    geminiApiKey: localStorage.getItem('propre_gemini_key'),
    isGreenScreen: false,
    screenLooks: initialScreenLooks,

    setGeminiKey: (key: string | null) => {
        if (key) {
            localStorage.setItem('propre_gemini_key', key)
        } else {
            localStorage.removeItem('propre_gemini_key')
        }
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
    }
})
