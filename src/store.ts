import { create } from 'zustand'
import { temporal } from 'zundo'
import { StoreState } from './store/types'
import { createEditorSlice } from './store/slices/editorSlice'
import { createLibrarySlice } from './store/slices/librarySlice'
import { createMediaSlice } from './store/slices/mediaSlice'
import { createSettingsSlice } from './store/slices/settingsSlice'
import { createStageSlice } from './store/slices/stageSlice'
import { createToastSlice } from './store/slices/toastSlice'

export const usePresentationStore = create<StoreState>()(
  temporal(
    (...a) => ({
      preparationBusy: false,
      saveState: 'saved' as const,
      saveError: null,
      lastSavedAt: null,
      initialized: false,
      ...createEditorSlice(...a),
      ...createLibrarySlice(...a),
      ...createMediaSlice(...a),
      ...createSettingsSlice(...a),
      ...createStageSlice(...a),
      ...createToastSlice(...a),
    }),
    {
      // Only track meaningful presentation content changes in history
      partialize: (state) => {
        const { slides, globalSlideStyle, currentPresentationTitle } = state
        return { slides, globalSlideStyle, currentPresentationTitle }
      },
      equality: (a, b) =>
        a.slides === b.slides &&
        a.globalSlideStyle === b.globalSlideStyle &&
        a.currentPresentationTitle === b.currentPresentationTitle,
      limit: 50, // Limit history to last 50 actions to save memory
    },
  ),
)
