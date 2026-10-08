import { StoreSlice, StageSlice } from '../types'
export const createStageSlice: StoreSlice<StageSlice> = (set, get) => ({
  isStageEnabled: false,
  isOutputEnabled: false,
  screenHealth: [],
  toggleStage: async () => {
    try {
      set({ isStageEnabled: await window.ipcRenderer.toggleStage() })
    } catch {
      get().addToast('모니터 창을 변경하지 못했습니다.', 'error')
    }
  },
  toggleOutput: async () => {
    try {
      set({ isOutputEnabled: await window.ipcRenderer.toggleOutput() })
    } catch {
      get().addToast('송출 창을 변경하지 못했습니다.', 'error')
    }
  },
})
