import { useState, useRef } from 'react'
import { usePresentationStore } from '../store'
import type { MediaItem } from '../types'

const MediaBin: React.FC = () => {
    const { mediaBin, addMediaToBin, removeMediaFromBin, triggerBackground } = usePresentationStore()
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleImport = async () => {
        try {
            const filePaths = await window.ipcRenderer.selectMediaFiles()
            if (filePaths.length > 0) {
                // In a real app we might copy files to a project folder
                // For now we just use the paths
                addMediaToBin(filePaths)
            }
        } catch (error) {
            console.error('Failed to import media:', error)
        }
    }

    const handleMediaClick = (media: MediaItem) => {
        triggerBackground(media)
    }

    return (
        <div className="flex flex-col h-48 bg-gray-900 border-t border-gray-800">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    미디어 빈 (Media Bin)
                </h2>
                <button
                    onClick={handleImport}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
                >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Import
                </button>
            </div>

            {/* Media Grid */}
            <div className="flex-1 overflow-y-auto p-2">
                {mediaBin.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-gray-600">
                        <svg className="w-8 h-8 opacity-20 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="text-xs">미디어를 가져오세요</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                        {mediaBin.map((media) => (
                            <div
                                key={media.id}
                                onClick={() => handleMediaClick(media)}
                                className="group relative aspect-video bg-gray-800 rounded overflow-hidden cursor-pointer border border-transparent hover:border-blue-500"
                            >
                                {media.type === 'video' ? (
                                    <video
                                        src={media.url}
                                        className="w-full h-full object-cover"
                                        muted
                                        loop // Preview loop
                                        onMouseOver={(e) => e.currentTarget.play()}
                                        onMouseOut={(e) => e.currentTarget.pause()}
                                    />
                                ) : (
                                    <img
                                        src={media.url}
                                        alt={media.name}
                                        className="w-full h-full object-cover"
                                    />
                                )}

                                {/* Type Badge */}
                                <span className="absolute bottom-1 right-1 px-1 py-0.5 text-[8px] bg-black/60 text-white rounded uppercase">
                                    {media.type}
                                </span>

                                {/* Name Overlay */}
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <p className="text-[10px] text-white truncate">{media.name}</p>
                                </div>

                                {/* Delete Button */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        removeMediaFromBin(media.id)
                                    }}
                                    className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-red-600 text-white rounded opacity-0 group-hover:opacity-100 transition-all"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default MediaBin
