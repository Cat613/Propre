// src/store/types.ts
import type { Slide, Presentation, PlaylistItem, MediaItem, ActiveBackground, GlobalSlideStyle } from '../types'
import { StateCreator } from 'zustand'

export interface EditorSlice {
    slides: Slide[]
    activeSlideId: string | null
    currentPresentationId: string | null
    globalSlideStyle: GlobalSlideStyle

    setActiveSlide: (id: string | null) => void
    setSlides: (slides: Slide[]) => void
    addSlide: (slide: Slide) => void
    updateSlide: (id: string, updates: Partial<Slide>) => void
    deleteSlide: (id: string) => void
    reorderSlides: (oldIndex: number, newIndex: number) => void
    clearActiveSlide: () => void
    updateGlobalSlideStyle: (style: Partial<GlobalSlideStyle>) => void
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

    addMediaToBin: (files: string[]) => void
    removeMediaFromBin: (id: string) => void
    triggerBackground: (media: MediaItem) => void
    clearBackground: () => void
    clearText: () => void
    clearAll: () => void
}

export interface SettingsSlice {
    geminiApiKey: string | null
    setGeminiKey: (key: string | null) => void
}

export interface StageSlice {
    isStageEnabled: boolean
    isOutputEnabled: boolean
    toggleStage: () => Promise<void>
    toggleOutput: () => Promise<void>
}

export type StoreState = EditorSlice & LibrarySlice & MediaSlice & SettingsSlice & StageSlice
export type StoreSlice<T> = StateCreator<StoreState, [], [], T>
