import { StoreSlice } from '../types'
import type { EditorSlice } from '../types'
import type { Slide, GlobalSlideStyle, CanvasElement } from '../../types'
import { syncOutputState, syncStageState } from '../helpers'
import { generateId } from '../../utils/generateId'

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
    selectedSlideIds: [],
    copiedSlides: [],
    currentPresentationId: null,
    currentPresentationTitle: null,
    globalSlideStyle: defaultGlobalSlideStyle,
    activePresetId: null,
    isModalOpen: false,

    setCurrentPresentationTitle: (title: string | null) => set({ currentPresentationTitle: title }),
    setActivePresetId: (id: string | null) => set({ activePresetId: id }),

    setSelectedSlideIds: (ids: string[]) => set({ selectedSlideIds: ids }),

    toggleSelectSlide: (id: string, isMulti: boolean, isRange: boolean) => {
        const { slides, selectedSlideIds } = get()
        if (isRange && selectedSlideIds.length > 0) {
            const lastSelectedId = selectedSlideIds[selectedSlideIds.length - 1]
            const lastIdx = slides.findIndex(s => s.id === lastSelectedId)
            const currentIdx = slides.findIndex(s => s.id === id)
            if (lastIdx !== -1 && currentIdx !== -1) {
                const start = Math.min(lastIdx, currentIdx)
                const end = Math.max(lastIdx, currentIdx)
                const rangeIds = slides.slice(start, end + 1).map(s => s.id)
                const newIds = Array.from(new Set([...selectedSlideIds, ...rangeIds]))
                set({ selectedSlideIds: newIds })
                return
            }
        }
        if (isMulti) {
            if (selectedSlideIds.includes(id)) {
                set({ selectedSlideIds: selectedSlideIds.filter(item => item !== id) })
            } else {
                set({ selectedSlideIds: [...selectedSlideIds, id] })
            }
        } else {
            set({ selectedSlideIds: [id] })
        }
    },

    batchUpdateSlides: (ids: string[], updates: Partial<Slide>) => {
        const idSet = new Set(ids)
        set((state) => ({
            slides: state.slides.map((slide) =>
                idSet.has(slide.id) ? { ...slide, ...updates } : slide
            ),
        }))
        const { activeSlideId, slides } = get()
        if (activeSlideId && idSet.has(activeSlideId)) {
            const updatedSlide = slides.find(s => s.id === activeSlideId)
            if (updatedSlide && updatedSlide.backgroundUrl) {
                set({
                    activeBackground: {
                        type: updatedSlide.type === 'video' ? 'video' : 'image',
                        url: updatedSlide.backgroundUrl
                    }
                })
            }
            syncOutputState(get)
            syncStageState(get)
        }
    },

    batchDeleteSlides: (ids: string[]) => {
        const idSet = new Set(ids)
        set((state) => ({
            slides: state.slides.filter((slide) => !idSet.has(slide.id)),
            activeSlideId: state.activeSlideId && idSet.has(state.activeSlideId) ? null : state.activeSlideId,
            selectedSlideIds: state.selectedSlideIds.filter(id => !idSet.has(id))
        }))
        syncOutputState(get)
        syncStageState(get)
    },

    copySelectedSlides: () => {
        const { slides, selectedSlideIds } = get()
        const idSet = new Set(selectedSlideIds)
        const copied = slides.filter(s => idSet.has(s.id)).map(s => JSON.parse(JSON.stringify(s)))
        set({ copiedSlides: copied })
    },

    pasteSlides: () => {
        const { slides, selectedSlideIds, copiedSlides } = get()
        if (!copiedSlides || copiedSlides.length === 0) return

        const newSlides: Slide[] = copiedSlides.map((s: Slide) => ({
            ...JSON.parse(JSON.stringify(s)),
            id: generateId()
        }))

        let insertIdx = slides.length
        if (selectedSlideIds.length > 0) {
            const lastSelectedId = selectedSlideIds[selectedSlideIds.length - 1]
            const idx = slides.findIndex(s => s.id === lastSelectedId)
            if (idx !== -1) {
                insertIdx = idx + 1
            }
        }

        const updatedSlides = [...slides]
        updatedSlides.splice(insertIdx, 0, ...newSlides)

        set({
            slides: updatedSlides,
            selectedSlideIds: newSlides.map(s => s.id)
        })
    },

    reorderMultiSlides: (activeId: string, overId: string) => {
        const { slides, selectedSlideIds } = get()
        if (activeId === overId) return

        const selectedSet = new Set(selectedSlideIds)
        if (!selectedSet.has(activeId) || selectedSet.size <= 1) {
            const oldIdx = slides.findIndex(s => s.id === activeId)
            const newIdx = slides.findIndex(s => s.id === overId)
            if (oldIdx !== -1 && newIdx !== -1) {
                get().reorderSlides(oldIdx, newIdx)
            }
            return
        }

        const movingSlides = slides.filter(s => selectedSet.has(s.id))
        const remainingSlides = slides.filter(s => !selectedSet.has(s.id))

        const activeOrigIndex = slides.findIndex(s => s.id === activeId)
        const overOrigIndex = slides.findIndex(s => s.id === overId)

        let targetIndex = remainingSlides.findIndex(s => s.id === overId)
        if (targetIndex !== -1) {
            if (overOrigIndex > activeOrigIndex) {
                targetIndex += 1
            }
        } else {
            targetIndex = remainingSlides.filter(s => {
                const idx = slides.findIndex(orig => orig.id === s.id)
                return idx <= overOrigIndex
            }).length
        }

        const newSlides = [...remainingSlides]
        newSlides.splice(targetIndex, 0, ...movingSlides)

        set({ slides: newSlides })
    },

    setActiveSlide: (id: string | null) => {
        const { slides, activeBackground } = get()

        // ----------- 1. Main Output Logic -----------
        if (id === null) {
            set({ activeSlideId: null })
            syncOutputState(get)
            syncStageState(get)
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
        syncStageState(get)
    },

    setSlides: (slides: Slide[]) => set({ slides, activeSlideId: null, selectedSlideIds: [] }),

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
            selectedSlideIds: state.selectedSlideIds.filter(sId => sId !== id),
        })),

    reorderSlides: (oldIndex: number, newIndex: number) =>
        set((state) => {
            const newSlides = [...state.slides]
            const [removed] = newSlides.splice(oldIndex, 1)
            newSlides.splice(newIndex, 0, removed)
            return { slides: newSlides }
        }),

    updateGlobalSlideStyle: (style: Partial<GlobalSlideStyle>, presetId?: string | null) => {
        const updates: Partial<EditorSlice> = {
            globalSlideStyle: { ...get().globalSlideStyle, ...style }
        }
        if (presetId !== undefined) {
            updates.activePresetId = presetId
        }
        set(updates)
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
    },

    setModalOpen: (isOpen: boolean) => set({ isModalOpen: isOpen })
})
