import { useEffect } from 'react'
import { usePresentationStore } from '../store'

export const useHotkeys = () => {
    const { slides, activeSlideId, setActiveSlide, clearAll, isModalOpen } = usePresentationStore()

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if focus is in an input or textarea, or if a modal is open
            if (
                isModalOpen ||
                e.target instanceof HTMLInputElement ||
                e.target instanceof HTMLTextAreaElement ||
                (e.target as HTMLElement).isContentEditable
            ) {
                return
            }

            // Undo (Ctrl/Cmd + Z)
            if (e.key.toLowerCase() === 'z' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                if (e.shiftKey) {
                    usePresentationStore.temporal.getState().redo()
                } else {
                    usePresentationStore.temporal.getState().undo()
                }
                return
            }

            // Redo (Ctrl/Cmd + Y)
            if (e.key.toLowerCase() === 'y' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                usePresentationStore.temporal.getState().redo()
                return
            }

            const currentIndex = slides.findIndex(s => s.id === activeSlideId)

            switch (e.key) {
                case 'ArrowRight':
                case 'ArrowDown':
                case ' ': // Spacebar
                    e.preventDefault()
                    if (currentIndex < slides.length - 1) {
                        setActiveSlide(slides[currentIndex + 1].id)
                    } else if (slides.length > 0 && activeSlideId === null) {
                        // Start presentations
                        setActiveSlide(slides[0].id)
                    }
                    break
                case 'ArrowLeft':
                case 'ArrowUp':
                    e.preventDefault()
                    if (currentIndex > 0) {
                        setActiveSlide(slides[currentIndex - 1].id)
                    }
                    break
                case 'Escape':
                    e.preventDefault()
                    clearAll()
                    break
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [slides, activeSlideId, setActiveSlide, clearAll, isModalOpen])
}
