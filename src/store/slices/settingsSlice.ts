import { StoreSlice, SettingsSlice } from '../types'

export const createSettingsSlice: StoreSlice<SettingsSlice> = (set) => ({
    geminiApiKey: localStorage.getItem('propre_gemini_key'),

    setGeminiKey: (key: string | null) => {
        if (key) {
            localStorage.setItem('propre_gemini_key', key)
        } else {
            localStorage.removeItem('propre_gemini_key')
        }
        set({ geminiApiKey: key })
    },
})
