import { useState } from 'react'
import { usePresentationStore } from '../store'
import type { Presentation } from '../types'
import BiblePanel from './BiblePanel' // Assuming it is created

const LeftSidebar: React.FC = () => {
    const {
        library,
        playlist,
        addToPlaylist,
        removeFromPlaylist,
        selectPresentation,
        createNewPresentation,
        deletePresentation
    } = usePresentationStore()

    const [searchTerm, setSearchTerm] = useState('')
    const [activeTab, setActiveTab] = useState<'songs' | 'bible'>('songs')

    // Filter library based on search term
    const filteredLibrary = library.filter(p =>
        p.title.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const handleDragStart = (e: React.DragEvent, id: string) => {
        e.dataTransfer.setData('presentationId', id)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        const id = e.dataTransfer.getData('presentationId')
        if (id) {
            addToPlaylist(id)
        }
    }

    return (
        <div className="flex flex-col h-full">
            {/* Top Half: Playlist */}
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

            {/* Bottom Half: Tabs + Content */}
            <div className="flex-1 flex flex-col min-h-0 bg-gray-800/30 border-t border-gray-800">
                {/* Tabs */}
                <div className="flex border-b border-gray-800">
                    <button
                        onClick={() => setActiveTab('songs')}
                        className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'songs'
                                ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-500'
                                : 'bg-gray-900 text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        Songs
                    </button>
                    <button
                        onClick={() => setActiveTab('bible')}
                        className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'bible'
                                ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-500'
                                : 'bg-gray-900 text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        Bible
                    </button>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    {activeTab === 'songs' ? (
                        <>
                            <div className="p-3 bg-gray-900 border-b border-gray-800">
                                <div className="flex items-center justify-between mb-2">
                                    <button
                                        onClick={createNewPresentation}
                                        className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-1 ml-auto"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                        New Song
                                    </button>
                                </div>

                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder="제목 검색..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                                    />
                                    <svg className="absolute right-2.5 top-2 w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                                {filteredLibrary.map((presentation) => (
                                    <div
                                        key={presentation.id}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, presentation.id)}
                                        onClick={() => selectPresentation(presentation.id)}
                                        className="group flex items-center justify-between p-2 rounded hover:bg-gray-700/50 cursor-pointer transition-colors"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                                            </svg>
                                            <span className="text-sm text-gray-300 truncate">{presentation.title}</span>
                                        </div>

                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {/* Add to Playlist Button */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    addToPlaylist(presentation.id)
                                                }}
                                                className="p-1 text-gray-400 hover:text-green-400 rounded hover:bg-gray-600"
                                                title="플레이리스트에 추가"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                                </svg>
                                            </button>

                                            {/* Delete Button */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    if (confirm('정말로 이 곡을 삭제하시겠습니까?')) {
                                                        deletePresentation(presentation.id)
                                                    }
                                                }}
                                                className="p-1 text-gray-400 hover:text-red-400 rounded hover:bg-gray-600"
                                                title="삭제"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        // Bible Panel Component
                        <BiblePanel />
                    )}
                </div>
            </div>
        </div>
    )
}

export default LeftSidebar
