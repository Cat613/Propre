import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { PlaylistItem } from '../types'

interface Props {
  item: PlaylistItem
  index: number
  currentPresentationId: string | null
  selectPresentation: (id: string) => void
  removeFromPlaylist: (id: string) => void
  moveItem: (from: number, to: number) => void
  itemCount: number
}

export const SortablePlaylistItem: React.FC<Props> = ({
  item,
  index,
  currentPresentationId,
  selectPresentation,
  removeFromPlaylist,
  moveItem,
  itemCount,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
    opacity: isDragging ? 0.8 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      data-testid="playlist-item"
      data-presentation-id={item.presentationId}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => selectPresentation(item.presentationId)}
      aria-keyshortcuts="Enter Alt+ArrowUp Alt+ArrowDown"
      title="Enter로 곡 열기 · Alt+위/아래 화살표로 순서 이동"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          selectPresentation(item.presentationId)
        } else if (e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) {
          e.preventDefault()
          e.stopPropagation()
          const next = index + (e.key === 'ArrowUp' ? -1 : 1)
          if (next >= 0 && next < itemCount) moveItem(index, next)
        }
      }}
      className={`group relative flex items-center gap-2 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors ${
        currentPresentationId === item.presentationId
          ? 'bg-blue-500/10 border-blue-400/20'
          : 'border-transparent hover:bg-white/5'
      } ${isDragging ? 'bg-gray-800 shadow-lg' : ''}`}
    >
      <div
        className={`h-6 w-6 shrink-0 flex items-center justify-center rounded-lg text-[11px] tabular-nums transition-colors ${
          currentPresentationId === item.presentationId
            ? 'bg-blue-500/15 text-blue-300'
            : 'bg-white/5 text-gray-500'
        }`}
      >
        {index + 1}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 pr-7">
        <p
          title={item.presentation?.title}
          className="min-w-0 flex-1 truncate text-xs text-gray-200"
        >
          {item.presentation?.title || 'Unknown'}
        </p>
        <span
          className="shrink-0 text-[10px] tabular-nums text-gray-500"
          title={`${item.presentation?.slides?.length || 0} 슬라이드`}
        >
          {item.presentation?.slides?.length || 0}장
        </span>
      </div>
      <button
        aria-label={`순서에서 제거: ${item.presentation.title}`}
        onClick={(e) => {
          e.stopPropagation()
          removeFromPlaylist(item.id)
        }}
        onPointerDown={(e) => e.stopPropagation()} // Prevent dragging when clicking the delete button
        className="absolute right-1.5 p-1 bg-gray-800 rounded text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100 transition-opacity"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  )
}
