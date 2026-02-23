import { StoreSlice } from '../types'
import type { EditorSlice } from '../types'
import type { Slide, GlobalSlideStyle } from '../../types'

export const defaultGlobalSlideStyle: GlobalSlideStyle = {
    fontSize: 60,
    fontColor: '#ffffff',
    fontFamily: 'sans-serif',
    align: 'center',
    verticalAlign: 'center',
    backgroundDim: 0
}

export const createEditorSlice: StoreSlice<EditorSlice> = (set, get) => ({
    slides: [],
    activeSlideId: null,
    currentPresentationId: null,
    globalSlideStyle: defaultGlobalSlideStyle,

    setActiveSlide: (id: string | null) => {
        const { slides, activeBackground } = get()

        // ----------- 1. Main Output Logic -----------
        if (id === null) {
            set({ activeSlideId: null })
            const outputData = {
                type: 'state-update',
                slide: null,
                background: activeBackground, // Keep current background
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
            globalSlideStyle: get().globalSlideStyle
        }
        window.ipcRenderer.send('update-output', JSON.stringify(outputData))

        // ----------- 2. Stage Display Logic -----------
        let nextSlide: Slide | null = null
        if (slideIndex < slides.length - 1) {
            nextSlide = slides[slideIndex + 1]
        } else {
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

    updateGlobalSlideStyle: (style: Partial<GlobalSlideStyle>) => {
        set(state => {
            const newStyle = { ...state.globalSlideStyle, ...style }

            const { activeSlideId, slides, activeBackground } = state
            const activeSlide = slides.find(s => s.id === activeSlideId)

            const outputData = {
                type: 'state-update',
                slide: activeSlide || null,
                background: activeBackground,
                globalSlideStyle: newStyle
            }
            window.ipcRenderer.send('update-output', JSON.stringify(outputData))

            return { globalSlideStyle: newStyle }
        })
    },
})
