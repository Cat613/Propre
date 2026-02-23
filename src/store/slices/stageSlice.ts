import { StoreSlice, StageSlice } from '../types'

export const createStageSlice: StoreSlice<StageSlice> = (set) => ({
    isStageEnabled: false,
    isOutputEnabled: true,

    toggleStage: async () => {
        try {
            const result = await window.ipcRenderer.toggleStage()
            set({ isStageEnabled: result })
        } catch (error) {
            console.error("Failed to toggle stage:", error)
        }
    },

    toggleOutput: async () => {
        try {
            const result = await window.ipcRenderer.toggleOutput()
            set({ isOutputEnabled: result })
        } catch (error) {
            console.error("Failed to toggle output:", error)
        }
    }
})
