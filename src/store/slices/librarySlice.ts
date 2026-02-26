import { StoreSlice, LibrarySlice } from '../types'
import type { Presentation, PlaylistItem } from '../../types'
import { generateId } from '../../utils/generateId'

export const createLibrarySlice: StoreSlice<LibrarySlice> = (set, get) => ({
    library: [],
    playlist: [],

    loadLibrary: async () => {
        try {
            const library = await window.ipcRenderer.getLibrary()
            const playlist = await window.ipcRenderer.getPlaylist()
            set({ library, playlist })
        } catch (error) {
            console.error('Failed to load library:', error)
            get().addToast('라이브러리를 불러오는데 실패했습니다.', 'error')
        }
    },

    saveCurrentPresentation: async () => {
        const { slides, currentPresentationId } = get()
        let presentation: Presentation

        // Find best title from content or elements
        let title = 'Untitled Presentation'
        const candidateSlide = slides.find(s => s.content || (s.elements && s.elements.length > 0))
        if (candidateSlide) {
            if (candidateSlide.content) {
                title = candidateSlide.content.split('\n')[0].substring(0, 20)
            } else if (candidateSlide.elements) {
                const textElement = candidateSlide.elements.find((el): el is import('../../types').TextElement => el.type === 'text')
                if (textElement && textElement.text) {
                    title = textElement.text.split('\n')[0].substring(0, 20)
                }
            }
        }

        if (currentPresentationId) {
            const existing = get().library.find(p => p.id === currentPresentationId)
            presentation = {
                ...(existing || { createdAt: new Date().toISOString() }),
                id: currentPresentationId,
                title: existing?.title || title,
                slides,
                updatedAt: new Date().toISOString(),
            }
        } else {
            const newId = generateId()
            presentation = {
                id: newId,
                title,
                slides,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }
            set({ currentPresentationId: newId })
        }

        try {
            await window.ipcRenderer.saveToLibrary(presentation)
            const library = await window.ipcRenderer.getLibrary()
            set({ library })
        } catch (error) {
            console.error('Failed to save presentation:', error)
            get().addToast('저장에 실패했습니다.', 'error')
        }
    },

    createNewPresentation: () => {
        set({
            currentPresentationId: null,
            slides: [],
            activeSlideId: null,
        })
        get().clearText()
    },

    deletePresentation: async (id: string) => {
        try {
            const library = await window.ipcRenderer.deleteFromLibrary(id)
            set({ library })
            if (get().currentPresentationId === id) {
                get().createNewPresentation()
            }
        } catch (error) {
            console.error('Failed to delete presentation:', error)
            get().addToast('삭제에 실패했습니다.', 'error')
        }
    },

    addToPlaylist: async (presentationId: string) => {
        const { library, playlist } = get()
        const presentation = library.find(p => p.id === presentationId)
        if (!presentation) return

        const newItem: PlaylistItem = {
            id: generateId(),
            presentationId,
            presentation,
        }

        const newPlaylist = [...playlist, newItem]
        set({ playlist: newPlaylist })
        await window.ipcRenderer.savePlaylist(newPlaylist)
    },

    removeFromPlaylist: async (playlistItemId: string) => {
        const { playlist } = get()
        const newPlaylist = playlist.filter(item => item.id !== playlistItemId)
        set({ playlist: newPlaylist })
        await window.ipcRenderer.savePlaylist(newPlaylist)
    },

    selectPresentation: (presentationId: string) => {
        const { library } = get()
        const presentation = library.find(p => p.id === presentationId)
        if (presentation) {
            set({
                currentPresentationId: presentation.id,
                slides: presentation.slides || [],
                activeSlideId: null,
            })
            get().clearText()
        }
    },
})
