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

export const createSettingsSlice: StoreSlice<SettingsSlice> = (set, get) => {
    // Asynchronously load the API key from secure OS storage
    window.ipcRenderer.getApiKey().then(key => {
        if (key) set({ geminiApiKey: key })
    }).catch(console.error)

    return {
        geminiApiKey: null,
        isGreenScreen: false,
        screenLooks: initialScreenLooks,

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
        }
    }
}
