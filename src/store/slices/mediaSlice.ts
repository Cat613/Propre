import { StoreSlice, MediaSlice } from '../types'
import type { MediaItem, ActiveBackground } from '../../types'
import { mediaKind } from '../../../shared/model'
import { generateId } from '../../utils/generateId'

let audioRequest = 0
export const createMediaSlice: StoreSlice<MediaSlice> = (set, get) => ({
  mediaBin: [],
  activeBackground: { type: 'none' },
  activeAudio: null,
  activeProps: [],
  activeMessage: null,
  activeAnnouncement: null,

  addMediaToBin: (files: string[]) => {
    const newItems: MediaItem[] = files.map((file) => {
      const type = mediaKind(file)
      const name = decodeURIComponent(file.split('/').pop() || '미디어')
      const fileUrl = file
      return {
        id: generateId(),
        type,
        url: fileUrl,
        name,
      }
    })

    set((state) => ({
      mediaBin: [
        ...state.mediaBin,
        ...newItems.filter((item) => !state.mediaBin.some((m) => m.url === item.url)),
      ],
    }))
  },

  removeMediaFromBin: (id: string) => {
    set((state) => ({
      mediaBin: state.mediaBin.filter((item) => item.id !== id),
    }))
  },

  pauseAudio: () => {
    audioRequest++
    set((s) => ({ activeAudio: s.activeAudio ? { ...s.activeAudio, playing: false } : null }))
  },
  playAudio: async (media) => {
    const token = ++audioRequest
    if (media) set({ activeAudio: { ...media, playing: false, volume: 1 } })
    const selected = get().activeAudio
    if (!selected) return
    try {
      const status =
        get().externalOutput.source.kind === 'web'
          ? await window.ipcRenderer.getExternalOutput()
          : get().externalOutput
      if (token !== audioRequest) return
      if (status.source.kind === 'web' && status.browser?.live && !status.browser.muted) {
        const externalOutput = await window.ipcRenderer.browserOutputCommand({
          action: 'mute',
          value: true,
          generation: status.generation,
        })
        set((s) =>
          externalOutput.generation >= s.externalOutput.generation ? { externalOutput } : {},
        )
      }
      if (token === audioRequest && get().activeAudio?.id === selected.id)
        set((s) => ({ activeAudio: s.activeAudio ? { ...s.activeAudio, playing: true } : null }))
    } catch {
      get().addToast('웹 소리를 끄지 못해 오디오 재생을 보류했습니다. 다시 시도해주세요.', 'error')
    }
  },
  triggerBackground: (media: MediaItem) => {
    if (media.type === 'audio') {
      void get().playAudio(media)
      return
    }
    void window.ipcRenderer?.returnToSlides?.().catch(() => {})
    const newBackground: ActiveBackground = {
      type: media.type,
      url: media.url,
    }
    set({ activeBackground: newBackground })
  },

  clearBackground: () => {
    set({ activeBackground: { type: 'none' } })
  },

  setProps: (props) => {
    set({ activeProps: props })
  },

  addProp: (prop) => {
    set((state) => ({ activeProps: [...state.activeProps, prop] }))
  },

  updateProp: (id, updates) => {
    set((state) => ({
      activeProps: state.activeProps.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }))
  },

  removeProp: (id) => {
    set((state) => ({
      activeProps: state.activeProps.filter((p) => p.id !== id),
    }))
  },

  setMessage: (message) => {
    set({ activeMessage: message })
  },

  setAnnouncement: (announcement) => {
    set({ activeAnnouncement: announcement })
  },

  clearLayer: (layer) => {
    switch (layer) {
      case 'audio':
        audioRequest++
        set({ activeAudio: null })
        break
      case 'background':
        set({ activeBackground: { type: 'none' } })
        break
      case 'slide':
        set({ activeSlideId: null })
        break
      case 'announcement':
        set({ activeAnnouncement: null })
        break
      case 'prop':
        set({ activeProps: [] })
        break
      case 'message':
        set({ activeMessage: null })
        break
    }
  },

  clearText: () => {
    set({ activeSlideId: null })
  },

  clearAll: () => {
    audioRequest++
    void window.ipcRenderer?.stopExternalOutput?.().catch(() => {})
    set({
      serviceBlackout: false,
      activeSlideId: null,
      activeBackground: { type: 'none' },
      activeAudio: null,
      activeMessage: null,
      activeAnnouncement: null,
      activeProps: [],
    })
  },
})
