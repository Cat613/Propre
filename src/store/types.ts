// src/store/types.ts
import type { Slide, Presentation, PlaylistItem, MediaItem, ActiveBackground, GlobalSlideStyle, LayerType, AudioItem, PropItem, MessageItem, LooksState, ScreenLook, CanvasElement } from '../types'
import { StateCreator } from 'zustand'

export interface EditorSlice {
    slides: Slide[]
    activeSlideId: string | null
    currentPresentationId: string | null
    globalSlideStyle: GlobalSlideStyle
    isModalOpen: boolean

    setActiveSlide: (id: string | null) => void
    setSlides: (slides: Slide[]) => void
    addSlide: (slide: Slide) => void
    updateSlide: (id: string, updates: Partial<Slide>) => void
    deleteSlide: (id: string) => void
    reorderSlides: (oldIndex: number, newIndex: number) => void
    clearActiveSlide: () => void
    updateGlobalSlideStyle: (style: Partial<GlobalSlideStyle>) => void
    setModalOpen: (isOpen: boolean) => void

    // Phase 3 Canvas Element methods
    addSlideElement: (slideId: string, element: CanvasElement) => void
    updateSlideElement: (slideId: string, elementId: string, updates: Partial<CanvasElement>) => void
    removeSlideElement: (slideId: string, elementId: string) => void
}

export interface LibrarySlice {
    library: Presentation[]
    playlist: PlaylistItem[]

    loadLibrary: () => Promise<void>
    saveCurrentPresentation: () => Promise<void>
    createNewPresentation: () => void
    deletePresentation: (id: string) => Promise<void>

    addToPlaylist: (presentationId: string) => Promise<void>
    removeFromPlaylist: (playlistItemId: string) => Promise<void>
    selectPresentation: (presentationId: string) => void
}

export interface MediaSlice {
    mediaBin: MediaItem[]
    activeBackground: ActiveBackground
    activeAudio: AudioItem | null
    activeProp: PropItem | null
    activeMessage: MessageItem | null
    activeAnnouncement: Slide | null

    addMediaToBin: (files: string[]) => void
    removeMediaFromBin: (id: string) => void

    // Legacy generic methods (to be refactored or kept for backward compatibility)
    triggerBackground: (media: MediaItem) => void
    clearBackground: () => void
    clearText: () => void
    clearAll: () => void

    // New Layer-specific methods
    setProp: (prop: PropItem | null) => void
    setMessage: (message: MessageItem | null) => void
    setAnnouncement: (announcement: Slide | null) => void
    clearLayer: (layer: LayerType) => void
}

export interface SettingsSlice {
    geminiApiKey: string | null
    isGreenScreen: boolean // Legacy flag, will be phased out by Looks
    screenLooks: LooksState

    setGeminiKey: (key: string | null) => void
    toggleGreenScreen: () => void
    updateScreenLook: (screenId: string, layer: LayerType, override: Partial<ScreenLook[LayerType]>) => void
}

export interface StageSlice {
    isStageEnabled: boolean
    isOutputEnabled: boolean
    toggleStage: () => Promise<void>
    toggleOutput: () => Promise<void>
}

export interface ToastSlice {
    toasts: { id: string, message: string, type: 'success' | 'error' | 'info' }[]
    addToast: (message: string, type?: 'success' | 'error' | 'info') => void
    removeToast: (id: string) => void
}

export type StoreState = EditorSlice & LibrarySlice & MediaSlice & SettingsSlice & StageSlice & ToastSlice
export type StoreSlice<T> = StateCreator<StoreState, [], [], T>
