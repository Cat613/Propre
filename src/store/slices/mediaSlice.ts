import { StoreSlice, MediaSlice } from '../types'
import type { MediaItem, ActiveBackground } from '../../types'
import { generateId } from '../../utils/generateId'
import { syncOutputState } from '../helpers'

export const createMediaSlice: StoreSlice<MediaSlice> = (set, get) => ({
    mediaBin: [],
    activeBackground: { type: 'none' },

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
        const newBackground: ActiveBackground = { type: 'none' }
        set({ activeBackground: newBackground })
        syncOutputState(get)
    },

    clearText: () => {
        set({ activeSlideId: null })
        syncOutputState(get)

        window.ipcRenderer.send('update-stage', JSON.stringify({ current: null, next: null }))
    },

    clearAll: () => {
        set({ activeSlideId: null, activeBackground: { type: 'none' } })
        syncOutputState(get)
        window.ipcRenderer.send('update-stage', JSON.stringify({ current: null, next: null }))
    },
})
