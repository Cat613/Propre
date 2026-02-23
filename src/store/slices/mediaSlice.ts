import { StoreSlice, MediaSlice } from '../types'
import type { MediaItem, ActiveBackground } from '../../types'
import { generateId } from '../../utils/generateId'

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

        const { slides, activeSlideId, globalSlideStyle } = get()
        const activeSlide = slides.find(s => s.id === activeSlideId)

        const outputData = {
            type: 'state-update',
            slide: activeSlide || null,
            background: newBackground,
            globalSlideStyle
        }
        window.ipcRenderer.send('update-output', JSON.stringify(outputData))
    },

    clearBackground: () => {
        const newBackground: ActiveBackground = { type: 'none' }
        set({ activeBackground: newBackground })

        const { slides, activeSlideId, globalSlideStyle } = get()
        const activeSlide = slides.find(s => s.id === activeSlideId)

        const outputData = {
            type: 'state-update',
            slide: activeSlide || null,
            background: newBackground,
            globalSlideStyle
        }
        window.ipcRenderer.send('update-output', JSON.stringify(outputData))
    },

    clearText: () => {
        set({ activeSlideId: null })
        const { activeBackground, globalSlideStyle } = get()

        const outputData = {
            type: 'state-update',
            slide: null,
            background: activeBackground,
            globalSlideStyle
        }
        window.ipcRenderer.send('update-output', JSON.stringify(outputData))

        window.ipcRenderer.send('update-stage', JSON.stringify({ current: null, next: null }))
    },

    clearAll: () => {
        set({ activeSlideId: null, activeBackground: { type: 'none' } })

        const { globalSlideStyle } = get()
        const outputData = {
            type: 'state-update',
            slide: null,
            background: { type: 'none' },
            globalSlideStyle
        }
        window.ipcRenderer.send('update-output', JSON.stringify(outputData))
        window.ipcRenderer.send('update-stage', JSON.stringify({ current: null, next: null }))
    },
})
