import React from 'react'
import {
    DndContext,
    closestCenter,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core'
import {
    SortableContext,
    verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { usePresentationStore } from '../store'
import { SortablePlaylistItem } from './SortablePlaylistItem'

const PlaylistPanel: React.FC = () => {
    const {
        playlist,
        addToPlaylist,
        removeFromPlaylist,
        selectPresentation,
        currentPresentationId,
        reorderPlaylist
    } = usePresentationStore()

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 5, // Requires moving 5px to start drag, allowing clicks to pass through
            },
        })
    )

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        const id = e.dataTransfer.getData('presentationId')
        if (id) {
            addToPlaylist(id)
        }
    }

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        if (over && active.id !== over.id) {
            const oldIndex = playlist.findIndex((item) => item.id === active.id)
            const newIndex = playlist.findIndex((item) => item.id === over.id)
            if (oldIndex !== -1 && newIndex !== -1) {
                reorderPlaylist(oldIndex, newIndex)
            }
        }
    }

    return (
        <div className="flex-1 flex flex-col border-b border-gray-800 min-h-0 bg-gray-900">
            <div className="flex items-center justify-between p-3 bg-gray-900 border-b border-gray-800">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    플레이리스트 (이번 주 순서)
                </h2>
                <span className="text-[10px] bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">
                    {playlist.length}
                </span>
            </div>

            <div
                className="flex-1 overflow-y-auto p-2 space-y-1"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
            >
                {playlist.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-600 gap-2">
                        <span className="text-xs">라이브러리에서 곡을 추가하세요</span>
                    </div>
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={playlist.map(item => item.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            {playlist.map((item, index) => (
                                <SortablePlaylistItem
                                    key={item.id}
                                    item={item}
                                    index={index}
                                    currentPresentationId={currentPresentationId}
                                    selectPresentation={selectPresentation}
                                    removeFromPlaylist={removeFromPlaylist}
                                />
                            ))}
                        </SortableContext>
                    </DndContext>
                )}
            </div>
        </div>
    )
}

export default PlaylistPanel
