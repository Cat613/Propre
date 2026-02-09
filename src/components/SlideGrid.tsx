import { useState } from 'react'
import { usePresentationStore } from '../store'
import type { Slide } from '../types'
import EditModal from './EditModal'
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core'
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface SlideGridProps {
    onSlideClick?: (slide: Slide) => void
    onEditModalChange?: (isOpen: boolean) => void
}

// Sortable slide card component
const SortableSlideCard: React.FC<{
    slide: Slide
    index: number
    isActive: boolean
    onSlideClick: () => void
    onEditClick: (e: React.MouseEvent) => void
    onDeleteClick: (e: React.MouseEvent) => void
}> = ({ slide, index, isActive, onSlideClick, onEditClick, onDeleteClick }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: slide.id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition: isDragging ? undefined : transition,
        opacity: isDragging ? 0.5 : 1,
    }

    const labelColor = slide.labelColor || 'transparent'

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`
        relative h-28 rounded-lg text-left cursor-grab active:cursor-grabbing overflow-hidden
        bg-gray-700/50 hover:bg-gray-700
        border-2 group
        ${isActive
                    ? 'border-orange-500 ring-2 ring-orange-500/30 shadow-lg shadow-orange-500/10'
                    : 'border-gray-600/50 hover:border-gray-500'
                }
      `}
            {...attributes}
            {...listeners}
        >
            {/* Label Color Bar (Top) */}
            {labelColor !== 'transparent' && (
                <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ backgroundColor: labelColor }}
                />
            )}

            {/* Content Area */}
            <div className="p-3 pt-2">
                {/* Slide Number */}
                <span className="absolute top-2 left-2 w-5 h-5 flex items-center justify-center text-xs font-bold rounded bg-gray-600 text-gray-300">
                    {index + 1}
                </span>

                {/* Delete Button */}
                <button
                    onClick={onDeleteClick}
                    className="absolute top-2 right-2 p-1.5 rounded bg-gray-600/80 hover:bg-red-600 text-gray-300 hover:text-white opacity-0 group-hover:opacity-100 z-10"
                    title="슬라이드 삭제"
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                {/* Edit Button */}
                <button
                    onClick={onEditClick}
                    className="absolute top-2 right-9 p-1.5 rounded bg-gray-600/80 hover:bg-blue-600 text-gray-300 hover:text-white opacity-0 group-hover:opacity-100 z-10"
                    title="슬라이드 편집"
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                </button>

                {/* Clickable overlay */}
                <div onClick={onSlideClick} className="absolute inset-0 z-0" />

                {/* Slide Content Preview */}
                <p className="text-xs text-gray-200 line-clamp-2 whitespace-pre-line mt-5 relative z-0 pointer-events-none">
                    {slide.content || (slide.backgroundUrl ? '(미디어)' : '(빈 슬라이드)')}
                </p>

                {/* Label Badge */}
                {slide.label && slide.label !== 'None' && (
                    <span
                        className="absolute bottom-2 left-2 px-2 py-0.5 text-[10px] font-bold rounded text-white pointer-events-none"
                        style={{ backgroundColor: labelColor }}
                    >
                        {slide.label}
                    </span>
                )}

                {/* Active Indicator */}
                {isActive && (
                    <span className="absolute bottom-2 right-2 flex items-center gap-1 text-xs text-orange-400 pointer-events-none">
                        <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                        LIVE
                    </span>
                )}
            </div>
        </div>
    )
}

const SlideGrid: React.FC<SlideGridProps> = ({ onSlideClick, onEditModalChange }) => {
    const { slides, activeSlideId, setActiveSlide, updateSlide, deleteSlide, reorderSlides } = usePresentationStore()
    const [editingSlide, setEditingSlide] = useState<Slide | null>(null)

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    const handleSlideClick = (slide: Slide) => {
        setActiveSlide(slide.id)
        window.ipcRenderer.send('update-output', JSON.stringify(slide))
        onSlideClick?.(slide)
    }

    const handleEditClick = (e: React.MouseEvent, slide: Slide) => {
        e.stopPropagation()
        setEditingSlide(slide)
        onEditModalChange?.(true)
    }

    const handleDeleteClick = (e: React.MouseEvent, slideId: string) => {
        e.stopPropagation()
        deleteSlide(slideId)
    }

    const handleSaveEdit = (id: string, updates: Partial<Slide>) => {
        updateSlide(id, updates)
    }

    const handleCloseModal = () => {
        setEditingSlide(null)
        onEditModalChange?.(false)
    }

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        if (over && active.id !== over.id) {
            const oldIndex = slides.findIndex((s) => s.id === active.id)
            const newIndex = slides.findIndex((s) => s.id === over.id)
            reorderSlides(oldIndex, newIndex)
        }
    }

    return (
        <>
            <div className="p-4 overflow-y-auto h-full">
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                    슬라이드 ({slides.length}) · 숫자키 1-9로 이동
                </h2>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={slides.map((s) => s.id)} strategy={rectSortingStrategy}>
                        <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                            {slides.map((slide, index) => (
                                <SortableSlideCard
                                    key={slide.id}
                                    slide={slide}
                                    index={index}
                                    isActive={activeSlideId === slide.id}
                                    onSlideClick={() => handleSlideClick(slide)}
                                    onEditClick={(e) => handleEditClick(e, slide)}
                                    onDeleteClick={(e) => handleDeleteClick(e, slide.id)}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>
            </div>

            <EditModal
                isOpen={editingSlide !== null}
                onClose={handleCloseModal}
                slide={editingSlide}
                onSave={handleSaveEdit}
            />
        </>
    )
}

export default SlideGrid
