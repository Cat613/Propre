import type { ServiceSessionView } from '../../shared/service-session'
import type { SetlistWorkspace } from '../../shared/setlists'
import type { ExternalOutputStatus, OutputResource } from '../../shared/output-resources'
import type { Setlist, SetlistSong, SetlistCommand } from '../../shared/setlists'
import type { FileResult } from '../../shared/contracts'
// src/store/types.ts
import type {
  Slide,
  Presentation,
  PlaylistItem,
  MediaItem,
  ActiveBackground,
  GlobalSlideStyle,
  GlobalStylePreset,
  LayerType,
  AudioItem,
  PropItem,
  MessageItem,
  LooksState,
  ScreenLook,
  CanvasElement,
} from '../types'
import type { SaveState, ScreenHealth } from '../../shared/contracts'
import { StateCreator } from 'zustand'

export interface EditorSlice {
  slides: Slide[]
  activeSlideId: string | null
  selectedSlideIds: string[]
  preparedSectionSlideId: string | null
  copiedSlides: Slide[]
  currentPresentationId: string | null
  currentPresentationTitle: string | null
  globalSlideStyle: GlobalSlideStyle
  activePresetId: string | null
  isModalOpen: boolean

  setActiveSlide: (id: string | null) => void
  setSelectedSlideIds: (ids: string[]) => void
  toggleSelectSlide: (id: string, isMulti: boolean, isRange: boolean) => void
  batchUpdateSlides: (ids: string[], updates: Partial<Slide>) => void
  batchDeleteSlides: (ids: string[]) => void
  copySelectedSlides: () => void
  pasteSlides: () => void
  reorderMultiSlides: (activeId: string, overId: string) => void
  setSlides: (slides: Slide[]) => void
  addSlide: (slide: Slide) => void
  insertSlides: (slides: Slide[], afterSlideId?: string | null) => boolean
  updateSlide: (id: string, updates: Partial<Slide>) => void
  deleteSlide: (id: string) => void
  reorderSlides: (oldIndex: number, newIndex: number) => void
  clearActiveSlide: () => void
  updateGlobalSlideStyle: (style: Partial<GlobalSlideStyle>, presetId?: string | null) => void
  setActivePresetId: (id: string | null) => void
  setModalOpen: (isOpen: boolean) => void
  setCurrentPresentationTitle: (title: string | null) => void

  // Phase 3 Canvas Element methods
  addSlideElement: (slideId: string, element: CanvasElement) => void
  updateSlideElement: (slideId: string, elementId: string, updates: Partial<CanvasElement>) => void
  removeSlideElement: (slideId: string, elementId: string) => void
}

export interface LibrarySlice {
  serviceTemplates: SetlistWorkspace['serviceTemplates']
  manageServiceTemplate(
    command: import('../../shared/service-template').TemplateAction,
  ): Promise<void>
  templateFile(
    operation: 'save' | 'load',
    expected?: { id: string; revision: number },
  ): Promise<FileResult>
  cuePresentations: SetlistWorkspace['cuePresentations']
  cueResources: SetlistWorkspace['cueResources']
  serviceSession: ServiceSessionView | null
  serviceTimer: import('../../shared/service-timer').TimerRuntime | null
  stageMessage: import('../../shared/stage-message').StageMessageStatus
  serviceBlackout: boolean
  serviceManualOutput: boolean
  songJobOperation(
    operation: 'apply' | 'undo' | 'rebase',
    id: string,
    revision?: number,
  ): Promise<void>
  setlists: Setlist[]
  setlistSongs: SetlistSong[]
  activeSetlistId: string | null
  refreshWorkspace: () => Promise<void>
  manageSetlist: (command: SetlistCommand) => Promise<void>
  publishSetlistSong: (id: string) => Promise<FileResult>
  serviceFile: (operation: 'save' | 'load') => Promise<FileResult>
  playlistFile: (operation: 'save' | 'load', append?: boolean) => Promise<FileResult>
  openPresentation: (presentation: Presentation) => void
  library: Presentation[]
  playlist: PlaylistItem[]

  loadLibrary: () => Promise<void>
  importPresentations: (presentations: Presentation[]) => Promise<void>
  saveCurrentPresentation: () => Promise<void>
  createNewPresentation: () => void
  deletePresentation: (id: string) => Promise<void>

  addToPlaylist: (presentationId: string) => Promise<void>
  removeFromPlaylist: (playlistItemId: string) => Promise<void>
  reorderPlaylist: (oldIndex: number, newIndex: number) => Promise<void>
  selectPresentation: (presentationId: string) => void
  savePreparedPresentation: (
    presentation: Presentation,
    expectedRevision: number | null,
  ) => Promise<Presentation>
  replacePreparedPlaylist: (presentationIds: string[], expectedRevision: string) => Promise<void>
}

export interface MediaSlice {
  mediaBin: MediaItem[]
  activeBackground: ActiveBackground
  activeAudio: AudioItem | null
  activeProps: PropItem[]
  activeMessage: MessageItem | null
  activeAnnouncement: Slide | null

  addMediaToBin: (files: string[]) => void
  removeMediaFromBin: (id: string) => void

  // Legacy generic methods (to be refactored or kept for backward compatibility)
  triggerBackground: (media: MediaItem) => void
  playAudio: (media?: MediaItem) => Promise<void>
  pauseAudio: () => void
  clearBackground: () => void
  clearText: () => void
  clearAll: () => void

  // New Layer-specific methods
  setProps: (props: PropItem[]) => void
  addProp: (prop: PropItem) => void
  updateProp: (id: string, updates: Partial<PropItem>) => void
  removeProp: (id: string) => void
  setMessage: (message: MessageItem | null) => void
  setAnnouncement: (announcement: Slide | null) => void
  clearLayer: (layer: LayerType) => void
}

export interface SettingsSlice {
  interfaceTheme: 'dark' | 'light'
  setInterfaceTheme: (theme: 'dark' | 'light') => void
  showAudioPlayer: boolean
  setShowAudioPlayer: (show: boolean) => void
  isGreenScreen: boolean // Legacy flag, will be phased out by Looks
  screenLooks: LooksState

  // Global Style Presets
  globalStylePresets: GlobalStylePreset[]
  defaultSongPresetId: string | null
  defaultBiblePresetId: string | null

  toggleGreenScreen: () => void
  updateScreenLook: (
    screenId: string,
    layer: LayerType,
    override: Partial<ScreenLook[LayerType]>,
  ) => void

  // Preset methods
  addGlobalStylePreset: (preset: GlobalStylePreset) => void
  deleteGlobalStylePreset: (id: string) => void
  setDefaultPreset: (type: 'song' | 'bible', presetId: string | null) => void

  // Stage Display Settings
  stageCurrentFontSize: number
  stageNextFontSize: number
  setStageCurrentFontSize: (size: number) => void
  setStageNextFontSize: (size: number) => void
}

export interface StageSlice {
  screenHealth: ScreenHealth[]
  isStageEnabled: boolean
  isOutputEnabled: boolean
  toggleStage: () => Promise<void>
  toggleOutput: () => Promise<void>
}

export interface ToastSlice {
  toasts: { id: string; message: string; type: 'success' | 'error' | 'info' }[]
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void
  removeToast: (id: string) => void
}

export interface PersistenceState {
  outputResources: OutputResource[]
  externalOutput: ExternalOutputStatus
  browserFrame: { resourceId: string; generation: number; image: string } | null
  preparationBusy: boolean
  saveState: SaveState
  saveError: string | null
  lastSavedAt: string | null
  initialized: boolean
}
export type StoreState = EditorSlice &
  LibrarySlice &
  MediaSlice &
  SettingsSlice &
  StageSlice &
  ToastSlice &
  PersistenceState
export type StoreSlice<T> = StateCreator<StoreState, [], [], T>
