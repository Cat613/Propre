import { StoreSlice } from '../types'
import type { EditorSlice } from '../types'
import type { Slide, GlobalSlideStyle, CanvasElement } from '../../types'
import { normalizeSlide, patchSlide } from '../../../shared/model'
import { generateId } from '../../utils/generateId'
import { defaultPreset, presetKind } from '../presets'

export const defaultGlobalSlideStyle: GlobalSlideStyle = {
  fontSize: 60,
  fontColor: '#ffffff',
  fontFamily: 'sans-serif',
  align: 'center',
  verticalAlign: 'center',
  backgroundDim: 0,
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
      const lastIdx = slides.findIndex((s) => s.id === lastSelectedId)
      const currentIdx = slides.findIndex((s) => s.id === id)
      if (lastIdx !== -1 && currentIdx !== -1) {
        const start = Math.min(lastIdx, currentIdx)
        const end = Math.max(lastIdx, currentIdx)
        const rangeIds = slides.slice(start, end + 1).map((s) => s.id)
        const newIds = Array.from(new Set([...selectedSlideIds, ...rangeIds]))
        set({ selectedSlideIds: newIds })
        return
      }
    }
    if (isMulti) {
      if (selectedSlideIds.includes(id)) {
        set({ selectedSlideIds: selectedSlideIds.filter((item) => item !== id) })
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
        idSet.has(slide.id) ? patchSlide(slide, updates) : slide,
      ),
    }))
    const { activeSlideId, slides } = get()
    if (activeSlideId && idSet.has(activeSlideId)) {
      const updatedSlide = slides.find((s) => s.id === activeSlideId)
      if (updatedSlide && updatedSlide.backgroundUrl) {
        set({
          activeBackground: {
            type: updatedSlide.type === 'video' ? 'video' : 'image',
            url: updatedSlide.backgroundUrl,
          },
        })
      }
    }
  },

  batchDeleteSlides: (ids: string[]) => {
    const idSet = new Set(ids)
    set((state) => ({
      slides: state.slides.filter((slide) => !idSet.has(slide.id)),
      activeSlideId:
        state.activeSlideId && idSet.has(state.activeSlideId) ? null : state.activeSlideId,
      selectedSlideIds: state.selectedSlideIds.filter((id) => !idSet.has(id)),
    }))
  },

  copySelectedSlides: () => {
    const { slides, selectedSlideIds } = get()
    const idSet = new Set(selectedSlideIds)
    const copied = slides.filter((s) => idSet.has(s.id)).map((s) => JSON.parse(JSON.stringify(s)))
    set({ copiedSlides: copied })
  },

  pasteSlides: () => {
    const { slides, selectedSlideIds, copiedSlides } = get()
    if (!copiedSlides || copiedSlides.length === 0) return

    const newSlides: Slide[] = copiedSlides.map((s: Slide) => ({
      ...JSON.parse(JSON.stringify(s)),
      id: generateId(),
    }))

    let insertIdx = slides.length
    if (selectedSlideIds.length > 0) {
      const lastSelectedId = selectedSlideIds[selectedSlideIds.length - 1]
      const idx = slides.findIndex((s) => s.id === lastSelectedId)
      if (idx !== -1) {
        insertIdx = idx + 1
      }
    }

    const updatedSlides = [...slides]
    updatedSlides.splice(insertIdx, 0, ...newSlides)

    set({
      slides: updatedSlides,
      selectedSlideIds: newSlides.map((s) => s.id),
    })
  },

  reorderMultiSlides: (activeId: string, overId: string) => {
    const { slides, selectedSlideIds } = get()
    if (activeId === overId) return

    const selectedSet = new Set(selectedSlideIds)
    if (!selectedSet.has(activeId) || selectedSet.size <= 1) {
      const oldIdx = slides.findIndex((s) => s.id === activeId)
      const newIdx = slides.findIndex((s) => s.id === overId)
      if (oldIdx !== -1 && newIdx !== -1) {
        get().reorderSlides(oldIdx, newIdx)
      }
      return
    }

    const movingSlides = slides.filter((s) => selectedSet.has(s.id))
    const remainingSlides = slides.filter((s) => !selectedSet.has(s.id))

    const activeOrigIndex = slides.findIndex((s) => s.id === activeId)
    const overOrigIndex = slides.findIndex((s) => s.id === overId)

    let targetIndex = remainingSlides.findIndex((s) => s.id === overId)
    if (targetIndex !== -1) {
      if (overOrigIndex > activeOrigIndex) {
        targetIndex += 1
      }
    } else {
      targetIndex = remainingSlides.filter((s) => {
        const idx = slides.findIndex((orig) => orig.id === s.id)
        return idx <= overOrigIndex
      }).length
    }

    const newSlides = [...remainingSlides]
    newSlides.splice(targetIndex, 0, ...movingSlides)

    set({ slides: newSlides })
  },

  setActiveSlide: (id: string | null) => {
    const state = get()
    const { slides, activeSlideId, activeBackground } = state
    if (id === null) {
      set({ activeSlideId: null })
      return
    }

    const slide = slides.find((s) => s.id === id)
    if (!slide) return
    const previous = slides.find((s) => s.id === activeSlideId)
    const preset = defaultPreset(state, slide)
    const applyPreset =
      preset &&
      (previous ? presetKind(previous) !== presetKind(slide) : state.activePresetId !== preset.id)
    // Apply the content and its style together so every output sees the same frame.
    set({
      activeSlideId: id,
      activeBackground: slide.backgroundUrl
        ? { type: slide.type === 'video' ? 'video' : 'image', url: slide.backgroundUrl }
        : activeBackground,
      ...(applyPreset ? { globalSlideStyle: { ...preset.style }, activePresetId: preset.id } : {}),
    })
  },

  setSlides: (slides: Slide[]) =>
    set((state) => ({
      slides: slides.map(normalizeSlide),
      activeSlideId: slides.some((s) => s.id === state.activeSlideId) ? state.activeSlideId : null,
      selectedSlideIds: state.selectedSlideIds.filter((id) => slides.some((s) => s.id === id)),
    })),

  clearActiveSlide: () => {
    get().clearText()
  },

  addSlide: (slide: Slide) =>
    set((state) => ({
      slides: [...state.slides, normalizeSlide(slide)],
    })),

  insertSlides: (incoming, afterSlideId) => {
    if (!incoming.length) return false
    const { slides } = get()
    const index =
      afterSlideId === undefined
        ? slides.length
        : afterSlideId === null
          ? 0
          : slides.findIndex((slide) => slide.id === afterSlideId) + 1
    if (afterSlideId != null && index === 0) return false
    const inserted = incoming.map(normalizeSlide)
    set({
      slides: [...slides.slice(0, index), ...inserted, ...slides.slice(index)],
      selectedSlideIds: inserted.map((slide) => slide.id),
    })
    return true
  },

  updateSlide: (id: string, updates: Partial<Slide>) => {
    const old = get().slides.find((s) => s.id === id)
    if (!old || JSON.stringify(patchSlide(old, updates)) === JSON.stringify(old)) return
    set((state) => ({
      slides: state.slides.map((slide) => (slide.id === id ? patchSlide(slide, updates) : slide)),
    }))
    if (get().activeSlideId === id) {
      const updatedSlide = get().slides.find((s) => s.id === id)
      if (updatedSlide && updatedSlide.backgroundUrl) {
        set({
          activeBackground: {
            type: updatedSlide.type === 'video' ? 'video' : 'image',
            url: updatedSlide.backgroundUrl,
          },
        })
      }
    }
  },

  deleteSlide: (id: string) =>
    set((state) => ({
      slides: state.slides.filter((slide) => slide.id !== id),
      activeSlideId: state.activeSlideId === id ? null : state.activeSlideId,
      selectedSlideIds: state.selectedSlideIds.filter((sId) => sId !== id),
    })),

  reorderSlides: (oldIndex: number, newIndex: number) =>
    set((state) => {
      if (!state.slides[oldIndex] || newIndex < 0 || newIndex >= state.slides.length) return {}
      const newSlides = [...state.slides]
      const [removed] = newSlides.splice(oldIndex, 1)
      newSlides.splice(newIndex, 0, removed)
      return { slides: newSlides }
    }),

  updateGlobalSlideStyle: (style: Partial<GlobalSlideStyle>, presetId?: string | null) => {
    const updates: Partial<EditorSlice> = {
      globalSlideStyle: { ...get().globalSlideStyle, ...style },
    }
    if (presetId !== undefined) {
      updates.activePresetId = presetId
    }
    set(updates)
  },

  // --- Phase 3: Canvas Element Management ---
  addSlideElement: (slideId: string, element: CanvasElement) => {
    set((state) => ({
      slides: state.slides.map((slide) =>
        slide.id === slideId
          ? patchSlide(slide, { elements: [...(slide.elements || []), element] })
          : slide,
      ),
    }))
  },

  updateSlideElement: (slideId: string, elementId: string, updates: Partial<CanvasElement>) => {
    set((state) => ({
      slides: state.slides.map((slide) => {
        if (slide.id !== slideId || !slide.elements) return slide
        return patchSlide(slide, {
          elements: slide.elements.map((el) =>
            el.id === elementId ? ({ ...el, ...updates } as CanvasElement) : el,
          ),
        })
      }),
    }))
  },

  removeSlideElement: (slideId: string, elementId: string) => {
    set((state) => ({
      slides: state.slides.map((slide) => {
        if (slide.id !== slideId || !slide.elements) return slide
        return patchSlide(slide, { elements: slide.elements.filter((el) => el.id !== elementId) })
      }),
    }))
  },

  setModalOpen: (isOpen: boolean) => set({ isModalOpen: isOpen }),
})
