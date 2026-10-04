import { useState, useEffect } from 'react'
import { usePresentationStore } from '../store'
import type { Slide } from '../types'
import EditModal from './EditModal'
import SlideSelectionToolbar from './SlideSelectionToolbar'
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragStartEvent,
    DragOverlay,
} from '@dnd-kit/core'
import {
    SortableContext,
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
    isSelected: boolean
    isGroupDragging?: boolean
    onSlideClick: (e: React.MouseEvent) => void
    onEditClick: (e: React.MouseEvent) => void
    onDeleteClick: (e: React.MouseEvent) => void
    onSaveEdit: (id: string, updates: Partial<Slide>) => void
}> = ({ slide, index, isActive, isSelected, isGroupDragging, onSlideClick, onEditClick, onDeleteClick, onSaveEdit }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: slide.id })

    const labelColor = slide.labelColor && slide.labelColor !== 'transparent' ? slide.labelColor : undefined
    const customBorder = slide.borderColor && slide.borderColor !== 'transparent' ? slide.borderColor : labelColor

    const style = {
        transform: CSS.Transform.toString(transform),
        transition: isDragging ? undefined : transition,
        opacity: isDragging || isGroupDragging ? 0.35 : 1,
        borderColor: !isActive && !isSelected && customBorder ? customBorder : undefined,
    }

    const [isEditing, setIsEditing] = useState(false)
    const [editText, setEditText] = useState(slide.content)

    useEffect(() => {
        setEditText(slide.content)
    }, [slide.content])

    const handleDoubleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        setIsEditing(true)
    }

    const handleSave = () => {
        setIsEditing(false)
        if (editText !== slide.content) {
            onSaveEdit(slide.id, { content: editText }) // Optimistic local UI update
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
            setEditText(slide.content)
            setIsEditing(false)
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            handleSave()
        }
    }

    const handleCardKeyDown = (e: React.KeyboardEvent) => {
        if (!isEditing && e.key === 'Enter') {
            e.preventDefault()
            setIsEditing(true)
        }
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`
        relative h-28 rounded-xl text-left cursor-grab active:cursor-grabbing overflow-hidden focus:outline-none
        transition-shadow duration-200 border-2 group
        ${isActive
                    ? 'bg-gray-800 border-orange-500 ring-2 ring-orange-500/40 shadow-lg shadow-orange-500/20 z-10'
                    : isSelected
                        ? 'bg-blue-950/50 border-blue-400 ring-2 ring-blue-500/40 shadow-md shadow-blue-500/10 z-10'
                        : 'bg-gray-800/80 hover:bg-gray-700 border-gray-700 hover:border-gray-500'
                }
        ${!isActive && !isSelected && customBorder ? 'shadow-sm' : ''}
      `}
            {...attributes}
            {...listeners}
            onKeyDown={(e) => {
                listeners?.onKeyDown?.(e as any)
                handleCardKeyDown(e)
            }}
        >
            {/* Top Border Color Glow / Accent Line */}
            {customBorder && (
                <div
                    className="absolute top-0 left-0 right-0 h-1.5 opacity-90 shadow"
                    style={{ backgroundColor: customBorder }}
                />
            )}

            {/* Content Area */}
            <div className="p-3 pt-2 h-full flex flex-col justify-between">
                <div className="flex items-center gap-1.5 relative z-10">
                    {/* Slide Number */}
                    <span className={`w-5 h-5 flex items-center justify-center text-[11px] font-bold rounded shadow-sm ${
                        isActive ? 'bg-orange-500 text-white' : isSelected ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-300'
                    }`}>
                        {index + 1}
                    </span>
                    {isSelected && (
                        <span className="w-5 h-5 bg-blue-600 text-white rounded flex items-center justify-center text-[11px] font-extrabold shadow-sm" title="선택됨">
                            ✓
                        </span>
                    )}
                </div>

                {/* Delete Button */}
                <button
                    onClick={onDeleteClick}
                    className="absolute top-2 right-2 p-1.5 rounded bg-gray-700/90 hover:bg-red-600 text-gray-300 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow"
                    title="슬라이드 삭제"
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                {/* Edit Button */}
                <button
                    onClick={onEditClick}
                    className="absolute top-2 right-9 p-1.5 rounded bg-gray-700/90 hover:bg-blue-600 text-gray-300 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity z-10 shadow"
                    title="슬라이드 편집"
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                </button>

                {/* Clickable overlay */}
                {!isEditing && <div onClick={onSlideClick} onDoubleClick={handleDoubleClick} className="absolute inset-0 z-0" />}

                {/* Slide Content Preview or Editor */}
                {isEditing ? (
                    <textarea
                        autoFocus
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={handleKeyDown}
                        onClick={e => e.stopPropagation()}
                        onPointerDown={e => e.stopPropagation()} // Prevent DnD dragging
                        className="absolute inset-0 z-20 w-full h-full p-2 pt-8 pb-6 text-xs bg-gray-800 text-white resize-none outline-none border-2 border-blue-500 rounded-xl shadow-xl"
                        placeholder="텍스트 입력 (Cmd+Enter 저장)"
                    />
                ) : (
                    <p className="text-xs text-gray-200 line-clamp-2 whitespace-pre-line mt-1 relative z-0 pointer-events-none font-medium drop-shadow-sm">
                        {slide.content || (slide.backgroundUrl ? '(미디어)' : '(빈 슬라이드)')}
                    </p>
                )}

                <div className="flex items-center justify-between relative z-0 pointer-events-none mt-auto pt-1">
                    {/* Label Badge */}
                    {slide.label && slide.label !== 'None' ? (
                        <span
                            className="px-2 py-0.5 text-[10px] font-extrabold rounded-md text-white shadow-sm border border-white/20 uppercase tracking-tight truncate max-w-[100px]"
                            style={{ backgroundColor: customBorder || '#3B82F6' }}
                        >
                            {slide.label}
                        </span>
                    ) : <span />}

                    {/* Active Indicator */}
                    {isActive && (
                        <span className="flex items-center gap-1 text-xs font-bold text-orange-400">
                            <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                            LIVE
                        </span>
                    )}
                </div>
            </div>
        </div>
    )
}

const SlideGrid: React.FC<SlideGridProps> = ({ onSlideClick, onEditModalChange }) => {
    const {
        slides,
        activeSlideId,
        setActiveSlide,
        updateSlide,
        deleteSlide,
        reorderSlides,
        selectedSlideIds,
        setSelectedSlideIds,
        toggleSelectSlide,
        reorderMultiSlides,
        copySelectedSlides,
        pasteSlides,
        batchDeleteSlides
    } = usePresentationStore()

    const [editingSlide, setEditingSlide] = useState<Slide | null>(null)
    const [activeDragId, setActiveDragId] = useState<string | null>(null)

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    )

    // Keyboard shortcuts for Copy, Paste, Delete, and Escape on multi-selected slides
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement
            if (
                editingSlide !== null ||
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target.isContentEditable
            ) {
                return
            }

            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
                if (selectedSlideIds && selectedSlideIds.length > 0) {
                    e.preventDefault()
                    copySelectedSlides()
                }
            } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
                e.preventDefault()
                pasteSlides()
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedSlideIds && selectedSlideIds.length > 0) {
                e.preventDefault()
                batchDeleteSlides(selectedSlideIds)
            } else if (e.key === 'Escape' && selectedSlideIds && selectedSlideIds.length > 0) {
                setSelectedSlideIds([])
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [selectedSlideIds, editingSlide, copySelectedSlides, pasteSlides, batchDeleteSlides, setSelectedSlideIds])

    const handleSlideClick = (e: React.MouseEvent, slide: Slide) => {
        e.stopPropagation()
        if (e.shiftKey) {
            toggleSelectSlide(slide.id, false, true)
        } else if (e.metaKey || e.ctrlKey) {
            toggleSelectSlide(slide.id, true, false)
        } else {
            setActiveSlide(slide.id)
            setSelectedSlideIds([]) // Simply clicking clears selection (does not show checkmark or toolbar)
            onSlideClick?.(slide)
        }
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

    const handleDragStart = (event: DragStartEvent) => {
        setActiveDragId(String(event.active.id))
    }

    const handleDragCancel = () => {
        setActiveDragId(null)
    }

    const handleDragEnd = (event: DragEndEvent) => {
        setActiveDragId(null)
        const { active, over } = event
        if (over && active.id !== over.id) {
            const activeId = String(active.id)
            const overId = String(over.id)
            if (selectedSlideIds && selectedSlideIds.includes(activeId) && selectedSlideIds.length > 1) {
                reorderMultiSlides(activeId, overId)
            } else {
                const oldIndex = slides.findIndex((s) => s.id === activeId)
                const newIndex = slides.findIndex((s) => s.id === overId)
                reorderSlides(oldIndex, newIndex)
            }
        }
    }

    const isMultiDragging = Boolean(activeDragId && selectedSlideIds?.includes(activeDragId) && selectedSlideIds.length > 1)

    return (
        <div className="relative h-full flex flex-col overflow-hidden">
            <div className="p-4 overflow-y-auto flex-1 pb-20">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                        슬라이드 ({slides.length}) · Shift/Ctrl 다중 선택 및 드래그 일괄 이동
                    </h2>
                </div>
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragCancel={handleDragCancel}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext items={slides.map((s) => s.id)} strategy={rectSortingStrategy}>
                        <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                            {slides.map((slide, index) => (
                                <SortableSlideCard
                                    key={slide.id}
                                    slide={slide}
                                    index={index}
                                    isActive={activeSlideId === slide.id}
                                    isSelected={Boolean(selectedSlideIds && selectedSlideIds.includes(slide.id))}
                                    isGroupDragging={Boolean(isMultiDragging && selectedSlideIds?.includes(slide.id))}
                                    onSlideClick={(e) => handleSlideClick(e, slide)}
                                    onEditClick={(e) => handleEditClick(e, slide)}
                                    onDeleteClick={(e) => handleDeleteClick(e, slide.id)}
                                    onSaveEdit={handleSaveEdit}
                                />
                            ))}
                        </div>
                    </SortableContext>

                    {/* Drag Overlay for Custom Visuals during dragging */}
                    <DragOverlay>
                        {activeDragId ? (
                            (() => {
                                const dragSlide = slides.find(s => s.id === activeDragId)
                                const dragIndex = slides.findIndex(s => s.id === activeDragId)
                                if (!dragSlide) return null

                                const isMulti = Boolean(selectedSlideIds && selectedSlideIds.includes(activeDragId) && selectedSlideIds.length > 1)
                                const labelColor = dragSlide.labelColor && dragSlide.labelColor !== 'transparent' ? dragSlide.labelColor : undefined
                                const customBorder = dragSlide.borderColor && dragSlide.borderColor !== 'transparent' ? dragSlide.borderColor : labelColor

                                return (
                                    <div className="relative cursor-grabbing">
                                        {/* Stacked cards visual representation when dragging multiple slides */}
                                        {isMulti && (
                                            <>
                                                <div className="absolute inset-0 bg-blue-900 border-2 border-blue-400 rounded-xl transform rotate-3 scale-95 translate-x-2.5 translate-y-2.5 opacity-75 shadow-lg" />
                                                <div className="absolute inset-0 bg-blue-950 border-2 border-blue-500 rounded-xl transform -rotate-1 scale-95 -translate-x-1 translate-y-1.5 opacity-85 shadow-md" />
                                            </>
                                        )}

                                        <div
                                            className={`relative h-28 w-56 rounded-xl text-left bg-gray-800 border-2 shadow-2xl p-3 pt-2 flex flex-col justify-between ${
                                                isMulti ? 'border-blue-400 ring-4 ring-blue-500/40 bg-blue-950/90' : 'border-orange-500 ring-2 ring-orange-500/30'
                                            }`}
                                            style={{ borderColor: !isMulti && customBorder ? customBorder : undefined }}
                                        >
                                            {customBorder && (
                                                <div
                                                    className="absolute top-0 left-0 right-0 h-1.5 opacity-90 shadow rounded-t-xl"
                                                    style={{ backgroundColor: customBorder }}
                                                />
                                            )}

                                            <div className="flex items-center justify-between z-10">
                                                <span className={`w-5 h-5 flex items-center justify-center text-[11px] font-bold rounded shadow-sm ${
                                                    isMulti ? 'bg-blue-500 text-white' : 'bg-orange-500 text-white'
                                                }`}>
                                                    {dragIndex + 1}
                                                </span>
                                                {isMulti && (
                                                    <span className="px-2 py-0.5 bg-blue-600 text-white font-extrabold text-[11px] rounded-full shadow border border-blue-300 animate-pulse">
                                                        {selectedSlideIds.length}개 일괄 이동 중
                                                    </span>
                                                )}
                                            </div>

                                            <p className="text-xs text-gray-200 line-clamp-2 whitespace-pre-line mt-1 relative z-10 font-medium drop-shadow-sm">
                                                {dragSlide.content || (dragSlide.backgroundUrl ? '(미디어)' : '(빈 슬라이드)')}
                                            </p>

                                            <div className="flex items-center justify-between z-10 mt-auto pt-1">
                                                {dragSlide.label && dragSlide.label !== 'None' ? (
                                                    <span
                                                        className="px-2 py-0.5 text-[10px] font-extrabold rounded-md text-white shadow-sm border border-white/20 uppercase tracking-tight truncate max-w-[100px]"
                                                        style={{ backgroundColor: customBorder || '#3B82F6' }}
                                                    >
                                                        {dragSlide.label}
                                                    </span>
                                                ) : <span />}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })()
                        ) : null}
                    </DragOverlay>
                </DndContext>
            </div>

            {/* Floating Selection Action Toolbar */}
            <SlideSelectionToolbar />

            <EditModal
                isOpen={editingSlide !== null}
                onClose={handleCloseModal}
                slide={editingSlide}
                onSave={handleSaveEdit}
            />
        </div>
    )
}

export default SlideGrid
