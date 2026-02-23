import { StoreSlice, SettingsSlice } from '../types'
import { syncOutputState } from '../helpers'

export const createSettingsSlice: StoreSlice<SettingsSlice> = (set, get) => ({
    geminiApiKey: localStorage.getItem('propre_gemini_key'),
    isGreenScreen: false,

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
    }
})
