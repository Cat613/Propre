import { StoreSlice } from '../types'
import type { EditorSlice } from '../types'
import type { Slide, GlobalSlideStyle, CanvasElement } from '../../types'
import { syncOutputState } from '../helpers'

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
            syncOutputState(get)
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
        syncOutputState(get)

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

    updateSlide: (id: string, updates: Partial<Slide>) => {
        set((state) => ({
            slides: state.slides.map((slide) =>
                slide.id === id ? { ...slide, ...updates } : slide
            ),
        }))
        if (get().activeSlideId === id) {
            const updatedSlide = get().slides.find(s => s.id === id)
            if (updatedSlide && updatedSlide.backgroundUrl) {
                set({
                    activeBackground: {
                        type: updatedSlide.type === 'video' ? 'video' : 'image',
                        url: updatedSlide.backgroundUrl
                    }
                })
            }
            syncOutputState(get)
        }
    },

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
        const newStyle = { ...get().globalSlideStyle, ...style }
        set({ globalSlideStyle: newStyle })
        syncOutputState(get)
    },

    // --- Phase 3: Canvas Element Management ---
    addSlideElement: (slideId: string, element: CanvasElement) => {
        set((state) => ({
            slides: state.slides.map(slide =>
                slide.id === slideId
                    ? { ...slide, elements: [...(slide.elements || []), element] }
                    : slide
            )
        }))
        if (get().activeSlideId === slideId) syncOutputState(get)
    },

    updateSlideElement: (slideId: string, elementId: string, updates: Partial<CanvasElement>) => {
        set((state) => ({
            slides: state.slides.map(slide => {
                if (slide.id !== slideId || !slide.elements) return slide
                return {
                    ...slide,
                    elements: slide.elements.map(el =>
                        el.id === elementId ? { ...el, ...updates } as CanvasElement : el
                    )
                }
            })
        }))
        if (get().activeSlideId === slideId) syncOutputState(get)
    },

    removeSlideElement: (slideId: string, elementId: string) => {
        set((state) => ({
            slides: state.slides.map(slide => {
                if (slide.id !== slideId || !slide.elements) return slide
                return {
                    ...slide,
                    elements: slide.elements.filter(el => el.id !== elementId)
                }
            })
        }))
        if (get().activeSlideId === slideId) syncOutputState(get)
    }
})
