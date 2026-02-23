import React, { useState } from 'react'
import { usePresentationStore } from '../store'

const LibraryPanel: React.FC = () => {
    const {
        library,
        addToPlaylist,
        selectPresentation,
        createNewPresentation,
        saveCurrentPresentation,
        deletePresentation
    } = usePresentationStore()

    const [searchTerm, setSearchTerm] = useState('')

    const filteredLibrary = library.filter(p =>
        p.title.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const handleDragStart = (e: React.DragEvent, id: string) => {
        e.dataTransfer.setData('presentationId', id)
    }

    return (
        <>
            <div className="p-3 bg-gray-900 border-b border-gray-800">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 ml-auto">
                        <button
                            onClick={saveCurrentPresentation}
                            className="px-2 py-1 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors flex items-center gap-1 shadow-sm"
                            title="현재 슬라이드를 라이브러리에 저장합니다"
                        >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                            </svg>
                            저장
                        </button>
                        <button
                            onClick={createNewPresentation}
                            className="px-2 py-1 text-[10px] bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-1 shadow-sm"
                            title="새로운 프레젠테이션(노래)을 만듭니다"
                        >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            새 프레젠테이션
                        </button>
                    </div>
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
    )
}

export default LibraryPanel
