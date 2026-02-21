import { create } from 'zustand'
import type { Slide, Presentation, PlaylistItem, MediaItem, ActiveBackground, BibleStyle, GlobalSlideStyle } from './types'

// Generate unique ID
const generateId = () => crypto.randomUUID()

// Initial dummy slides
const initialSlides: Slide[] = []

// Default Bible Style
const defaultBibleStyle: BibleStyle = {
    fontSize: 60,
    fontColor: '#ffffff',
    bgColor: '#1e3a8a', // Dark Blue
    align: 'center',
    verticalAlign: 'center'
}

// Default Global Slide Style
const defaultGlobalSlideStyle: GlobalSlideStyle = {
    fontSize: 60,
    fontColor: '#ffffff',
    fontFamily: 'sans-serif',
    align: 'center',
    verticalAlign: 'center',
    backgroundDim: 0
}

// Store interface
interface PresentationState {
    // Current Editor State
    slides: Slide[]
    activeSlideId: string | null
    currentPresentationId: string | null

    // Library & Playlist State
    library: Presentation[]
    playlist: PlaylistItem[]

    // Media Bin & Layer State
    mediaBin: MediaItem[]
    activeBackground: ActiveBackground

    // Bible State
    bibleStyle: BibleStyle

    // Global Slide State
    globalSlideStyle: GlobalSlideStyle

    // Stage Display State
    isStageEnabled: boolean

    // Actions
    setActiveSlide: (id: string | null) => void
    setSlides: (slides: Slide[]) => void
    addSlide: (slide: Slide) => void
    updateSlide: (id: string, updates: Partial<Slide>) => void
    deleteSlide: (id: string) => void
    reorderSlides: (oldIndex: number, newIndex: number) => void
    clearActiveSlide: () => void

    // Library Actions
    loadLibrary: () => Promise<void>
    saveCurrentPresentation: () => Promise<void>
    createNewPresentation: () => void
    deletePresentation: (id: string) => Promise<void>

    // Playlist Actions
    addToPlaylist: (presentationId: string) => Promise<void>
    removeFromPlaylist: (playlistItemId: string) => Promise<void>
    selectPresentation: (presentationId: string) => void

    // Media Bin & Layer Actions
    addMediaToBin: (files: string[]) => void
    removeMediaFromBin: (id: string) => void
    triggerBackground: (media: MediaItem) => void
    clearBackground: () => void
    clearText: () => void
    clearAll: () => void

    // Bible Actions
    updateBibleStyle: (style: Partial<BibleStyle>) => void

    // Global Slide Actions
    updateGlobalSlideStyle: (style: Partial<GlobalSlideStyle>) => void

    // Stage Actions
    toggleStage: () => Promise<void>
}

// Create the store
export const usePresentationStore = create<PresentationState>((set, get) => ({
    slides: initialSlides,
    activeSlideId: null,
    currentPresentationId: null,
    library: [],
    playlist: [],
    mediaBin: [],
    activeBackground: { type: 'none' },
    bibleStyle: defaultBibleStyle,
    globalSlideStyle: defaultGlobalSlideStyle,
    isStageEnabled: false,

    // --- Editor Actions ---

    setActiveSlide: (id: string | null) => {
        const { slides, activeBackground, bibleStyle } = get()

        // ----------- 1. Main Output Logic -----------
        if (id === null) {
            set({ activeSlideId: null })
            const outputData = {
                type: 'state-update',
                slide: null,
                background: activeBackground, // Keep current background
                bibleStyle, // Always send latest bible style
                globalSlideStyle: get().globalSlideStyle
            }
            window.ipcRenderer.send('update-output', JSON.stringify(outputData))
            window.ipcRenderer.send('update-stage', JSON.stringify({ current: null, next: null }))
            return
        }

        const slideIndex = slides.findIndex(s => s.id === id)
        const slide = slides[slideIndex]
        if (!slide) return

        set({ activeSlideId: id })

        // Check if slide has its own background
        let newBackground = activeBackground
        if (slide.backgroundUrl) {
            newBackground = {
                type: slide.type === 'video' ? 'video' : 'image',
                url: slide.backgroundUrl
            }
            set({ activeBackground: newBackground })
        }

        // Send to Output
        const outputData = {
            type: 'state-update',
            slide: slide,
            background: newBackground,
            bibleStyle,
            globalSlideStyle: get().globalSlideStyle
        }
        window.ipcRenderer.send('update-output', JSON.stringify(outputData))


        // ----------- 2. Stage Display Logic -----------
        // Calculate Next Slide
        let nextSlide: Slide | null = null
        if (slideIndex < slides.length - 1) {
            nextSlide = slides[slideIndex + 1]
        } else {
            // End of presentation
            nextSlide = {
                id: 'end',
                content: '(End of Presentation)',
                type: 'text',
                styles: {}
            }
        }

        window.ipcRenderer.send('update-stage', JSON.stringify({
            current: slide,
            next: nextSlide
        }))
    },

    setSlides: (slides: Slide[]) => set({ slides, activeSlideId: null }),

    clearActiveSlide: () => {
        // Legacy action, redirect to clearText
        get().clearText()
    },

    addSlide: (slide: Slide) =>
        set((state) => ({
            slides: [...state.slides, slide],
        })),

    updateSlide: (id: string, updates: Partial<Slide>) =>
        set((state) => ({
            slides: state.slides.map((slide) =>
                slide.id === id ? { ...slide, ...updates } : slide
            ),
        })),

    deleteSlide: (id: string) =>
        set((state) => ({
            slides: state.slides.filter((slide) => slide.id !== id),
            activeSlideId: state.activeSlideId === id ? null : state.activeSlideId,
        })),

    reorderSlides: (oldIndex: number, newIndex: number) =>
        set((state) => {
            const newSlides = [...state.slides]
            const [removed] = newSlides.splice(oldIndex, 1)
            newSlides.splice(newIndex, 0, removed)
            return { slides: newSlides }
        }),

    // --- Library Actions ---

    loadLibrary: async () => {
        try {
            const library = await window.ipcRenderer.getLibrary()
            const playlist = await window.ipcRenderer.getPlaylist()
            set({ library, playlist })
        } catch (error) {
            console.error('Failed to load library:', error)
        }
    },

    saveCurrentPresentation: async () => {
        const { slides, currentPresentationId } = get()
        let presentation: Presentation
        const title = slides.find(s => s.content)?.content.split('\n')[0].substring(0, 20) || 'Untitled Presentation'

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
        }
    },

    // --- Playlist Actions ---

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

    // --- Media Bin & Layer Actions ---

    addMediaToBin: (files: string[]) => {
        const newItems: MediaItem[] = files.map(file => {
            const ext = file.split('.').pop()?.toLowerCase() || ''
            const type = ['mp4', 'mov', 'webm'].includes(ext) ? 'video' : 'image'
            const name = file.split(/[/\\]/).pop() || 'Unknown'
            // Construct valid file:// URL for the frontend, ensuring proper slashes
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

        const { slides, activeSlideId, bibleStyle, globalSlideStyle } = get()
        const activeSlide = slides.find(s => s.id === activeSlideId)

        const outputData = {
            type: 'state-update',
            slide: activeSlide || null,
            background: newBackground,
            bibleStyle,
            globalSlideStyle
        }
        window.ipcRenderer.send('update-output', JSON.stringify(outputData))
    },

    clearBackground: () => {
        const newBackground: ActiveBackground = { type: 'none' }
        set({ activeBackground: newBackground })

        const { slides, activeSlideId, bibleStyle, globalSlideStyle } = get()
        const activeSlide = slides.find(s => s.id === activeSlideId)

        const outputData = {
            type: 'state-update',
            slide: activeSlide || null,
            background: newBackground,
            bibleStyle,
            globalSlideStyle
        }
        window.ipcRenderer.send('update-output', JSON.stringify(outputData))
    },

    clearText: () => {
        set({ activeSlideId: null })
        const { activeBackground, bibleStyle, globalSlideStyle } = get()

        const outputData = {
            type: 'state-update',
            slide: null,
            background: activeBackground,
            bibleStyle,
            globalSlideStyle
        }
        window.ipcRenderer.send('update-output', JSON.stringify(outputData))

        // Clear Stage Text too?
        window.ipcRenderer.send('update-stage', JSON.stringify({ current: null, next: null }))
    },

    clearAll: () => {
        set({ activeSlideId: null, activeBackground: { type: 'none' } })

        const { bibleStyle, globalSlideStyle } = get()
        const outputData = {
            type: 'state-update',
            slide: null,
            background: { type: 'none' },
            bibleStyle,
            globalSlideStyle
        }
        window.ipcRenderer.send('update-output', JSON.stringify(outputData))
        window.ipcRenderer.send('update-stage', JSON.stringify({ current: null, next: null }))
    },

    // --- Bible Actions ---
    updateBibleStyle: (style: Partial<BibleStyle>) => {
        set(state => {
            const newStyle = { ...state.bibleStyle, ...style }

            // If a slide is active, we MUST re-send the update to output window
            // so it reflects the style change immediately.
            const { activeSlideId, slides, activeBackground } = state

            // We can use get() here but we are inside setter callback 
            // State merge hasn't happened yet? zustand setter merges state.
            // Let's use get() in next tick or just construct data.

            const activeSlide = slides.find(s => s.id === activeSlideId)

            const outputData = {
                type: 'state-update',
                slide: activeSlide || null,
                background: activeBackground,
                bibleStyle: newStyle,
                globalSlideStyle: get().globalSlideStyle
            }
            window.ipcRenderer.send('update-output', JSON.stringify(outputData))

            return { bibleStyle: newStyle }
        })
    },

    updateGlobalSlideStyle: (style: Partial<GlobalSlideStyle>) => {
        set(state => {
            const newStyle = { ...state.globalSlideStyle, ...style }

            const { activeSlideId, slides, activeBackground, bibleStyle } = state
            const activeSlide = slides.find(s => s.id === activeSlideId)

            const outputData = {
                type: 'state-update',
                slide: activeSlide || null,
                background: activeBackground,
                bibleStyle,
                globalSlideStyle: newStyle
            }
            window.ipcRenderer.send('update-output', JSON.stringify(outputData))

            return { globalSlideStyle: newStyle }
        })
    },

    toggleStage: async () => {
        try {
            const result = await window.ipcRenderer.toggleStage()
            set({ isStageEnabled: result })
        } catch (error) {
            console.error("Failed to toggle stage:", error)
        }
    }
}))
