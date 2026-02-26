import { StoreSlice, MediaSlice } from '../types'
import type { MediaItem, ActiveBackground } from '../../types'
import { generateId } from '../../utils/generateId'
import { syncOutputState } from '../helpers'

export const createMediaSlice: StoreSlice<MediaSlice> = (set, get) => ({
    mediaBin: [],
    activeBackground: { type: 'none' },
    activeAudio: null,
    activeProp: null,
    activeMessage: null,
    activeAnnouncement: null,

    addMediaToBin: (files: string[]) => {
        const newItems: MediaItem[] = files.map(file => {
            const ext = file.split('.').pop()?.toLowerCase() || ''
            const type = ['mp4', 'mov', 'webm'].includes(ext) ? 'video' : 'image'
            const name = file.split(/[/\\]/).pop() || 'Unknown'
            const fileUrl = `file:///${file.replace(/\\/g, '/')}`
            return {
                id: generateId(),
                type,
                url: fileUrl,
                name
            }
        })

        set(state => ({
            mediaBin: [...state.mediaBin, ...newItems]
        }))
    },

    removeMediaFromBin: (id: string) => {
        set(state => ({
            mediaBin: state.mediaBin.filter(item => item.id !== id)
        }))
    },

    triggerBackground: (media: MediaItem) => {
        const newBackground: ActiveBackground = {
            type: media.type,
            url: media.url
        }
        set({ activeBackground: newBackground })
        syncOutputState(get)
    },

    clearBackground: () => {
        set({ activeBackground: { type: 'none' } })
        syncOutputState(get)
    },

    setProp: (prop) => {
        set({ activeProp: prop })
        syncOutputState(get)
    },

    setMessage: (message) => {
        set({ activeMessage: message })
        syncOutputState(get)
    },

    setAnnouncement: (announcement) => {
        set({ activeAnnouncement: announcement })
        syncOutputState(get)
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
                window.ipcRenderer.send('update-stage', JSON.stringify({ current: null, next: null }))
                break
            case 'announcement':
                set({ activeAnnouncement: null })
                break
            case 'prop':
                set({ activeProp: null })
                break
            case 'message':
                set({ activeMessage: null })
                break
        }
        syncOutputState(get)
    },

    clearText: () => {
        set({ activeSlideId: null })
        syncOutputState(get)

        window.ipcRenderer.send('update-stage', JSON.stringify({ current: null, next: null }))
    },

    clearAll: () => {
        set({
            activeSlideId: null,
            activeBackground: { type: 'none' },
            activeAudio: null,
            activeProp: null,
            activeMessage: null,
            activeAnnouncement: null,
        })
        syncOutputState(get)
        window.ipcRenderer.send('update-stage', JSON.stringify({ current: null, next: null }))
    },
})
