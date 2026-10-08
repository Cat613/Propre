import { StoreSlice, MediaSlice } from '../types'
import type { MediaItem, ActiveBackground } from '../../types'
import { mediaKind } from '../../../shared/model'
import { generateId } from '../../utils/generateId'

export const createMediaSlice: StoreSlice<MediaSlice> = (set) => ({
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

  triggerBackground: (media: MediaItem) => {
    if (media.type === 'audio') {
      set({ activeAudio: { ...media, playing: true, volume: 1 } })
      return
    }
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
    set({
      activeSlideId: null,
      activeBackground: { type: 'none' },
      activeAudio: null,
      activeMessage: null,
      activeAnnouncement: null,
      activeProps: [],
    })
  },
})
