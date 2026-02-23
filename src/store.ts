import { create } from 'zustand'
import { StoreState } from './store/types'
import { createEditorSlice } from './store/slices/editorSlice'
import { createLibrarySlice } from './store/slices/librarySlice'
import { createMediaSlice } from './store/slices/mediaSlice'
import { createSettingsSlice } from './store/slices/settingsSlice'
import { createStageSlice } from './store/slices/stageSlice'

export const usePresentationStore = create<StoreState>()((...a) => ({
    ...createEditorSlice(...a),
    ...createLibrarySlice(...a),
    ...createMediaSlice(...a),
    ...createSettingsSlice(...a),
    ...createStageSlice(...a),
}))
