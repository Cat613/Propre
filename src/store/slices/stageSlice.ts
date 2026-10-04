import { StoreSlice, StageSlice } from '../types'

export const createStageSlice: StoreSlice<StageSlice> = (set) => {
    if (typeof window !== 'undefined' && window.ipcRenderer) {
        // Fetch real initial running status from Electron main process
        if (window.ipcRenderer.getOutputStatus) {
            window.ipcRenderer.getOutputStatus()
                .then(status => set({ isOutputEnabled: status }))
                .catch(console.error)
        }
        if (window.ipcRenderer.getStageStatus) {
            window.ipcRenderer.getStageStatus()
                .then(status => set({ isStageEnabled: status }))
                .catch(console.error)
        }
        // Subscribe to live status changes (e.g. user manually closing windows)
        if (window.ipcRenderer.on) {
            window.ipcRenderer.on('output-status-changed', (status: boolean) => set({ isOutputEnabled: status }))
            window.ipcRenderer.on('stage-status-changed', (status: boolean) => set({ isStageEnabled: status }))
        }
    }

    return {
        isStageEnabled: false,
        isOutputEnabled: false, // Default to false until confirmed by Electron IPC

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
    }
}
