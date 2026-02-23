import React from 'react'
import { usePresentationStore } from '../store'

const PlaylistPanel: React.FC = () => {
    const {
        playlist,
        addToPlaylist,
        removeFromPlaylist,
        selectPresentation
    } = usePresentationStore()

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        const id = e.dataTransfer.getData('presentationId')
        if (id) {
            addToPlaylist(id)
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
                    playlist.map((item, index) => (
                        <div
                            key={item.id}
                            onClick={() => selectPresentation(item.presentationId)}
                            className="group flex items-center gap-3 p-2 rounded-lg hover:bg-gray-800 cursor-pointer transition-colors"
                        >
                            <div className="w-6 h-6 flex items-center justify-center rounded bg-gray-800 text-gray-500 text-xs font-bold group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-200 truncate">{item.presentation?.title || 'Unknown'}</p>
                                <p className="text-[10px] text-gray-500">{item.presentation?.slides?.length || 0} slides</p>
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    removeFromPlaylist(item.id)
                                }}
                                className="p-1 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

export default PlaylistPanel
