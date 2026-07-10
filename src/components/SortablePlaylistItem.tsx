import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PlaylistItem } from '../types';

interface Props {
    item: PlaylistItem;
    index: number;
    currentPresentationId: string | null;
    selectPresentation: (id: string) => void;
    removeFromPlaylist: (id: string) => void;
}

export const SortablePlaylistItem: React.FC<Props> = ({
    item,
    index,
    currentPresentationId,
    selectPresentation,
    removeFromPlaylist,
}) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: item.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1 : 0,
        opacity: isDragging ? 0.8 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            onClick={() => selectPresentation(item.presentationId)}
            className={`group flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                currentPresentationId === item.presentationId
                    ? 'bg-blue-600/20 shadow-[inset_2px_0_0_0_rgb(59,130,246)]'
                    : 'hover:bg-gray-800 bg-transparent'
            } ${isDragging ? 'bg-gray-800 shadow-lg' : ''}`}
        >
            <div
                className={`w-6 h-6 flex items-center justify-center rounded text-xs font-bold transition-colors ${
                    currentPresentationId === item.presentationId
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-800 text-gray-500 group-hover:bg-blue-600 group-hover:text-white'
                }`}
            >
                {index + 1}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 truncate">{item.presentation?.title || 'Unknown'}</p>
                <p className="text-[10px] text-gray-500">{item.presentation?.slides?.length || 0} slides</p>
            </div>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    removeFromPlaylist(item.id);
                }}
                onPointerDown={(e) => e.stopPropagation()} // Prevent dragging when clicking the delete button
                className="p-1 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    );
};
