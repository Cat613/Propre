import React, { useState, useRef, useEffect } from 'react'
import { usePresentationStore } from '../store'

const LibraryPanel: React.FC = () => {
    const {
        library,
        addToPlaylist,
        selectPresentation,
        createNewPresentation,
        saveCurrentPresentation,
        deletePresentation,
        slides,
        setSlides,
        addToast,
        currentPresentationId
    } = usePresentationStore()

    const [searchTerm, setSearchTerm] = useState('')
    const [fileMenuOpen, setFileMenuOpen] = useState(false)
    const fileMenuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (fileMenuRef.current && !fileMenuRef.current.contains(event.target as Node)) {
                setFileMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const filteredLibrary = library.filter(p =>
        p.title.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const handleDragStart = (e: React.DragEvent, id: string) => {
        e.dataTransfer.setData('presentationId', id)
    }

    const handleExport = async () => {
        let title = 'Untitled Presentation'
        const currentPresentation = library.find(p => p.id === currentPresentationId)
        if (currentPresentation) {
            title = currentPresentation.title
        } else {
            const candidateSlide = slides.find(s => s.content || (s.elements && s.elements.length > 0))
            if (candidateSlide) {
                if (candidateSlide.content) {
                    title = candidateSlide.content.split('\n')[0].substring(0, 20)
                } else if (candidateSlide.elements) {
                    const textElement = candidateSlide.elements.find(el => el.type === 'text') as any
                    if (textElement && textElement.text) {
                        title = textElement.text.split('\n')[0].substring(0, 20)
                    }
                }
            }
        }

        try {
            const data = JSON.stringify({ title, slides }, null, 2)
            const result = await window.ipcRenderer.saveProject(data)
            if (result.success) {
                addToast('내보내기가 완료되었습니다.', 'success')
            } else if (!result.canceled) {
                addToast('내보내기에 실패했습니다.', 'error')
            }
        } catch (e) {
            addToast('내보내기에 실패했습니다.', 'error')
        }
    }

    const handleImport = async () => {
        try {
            const result = await window.ipcRenderer.loadProject()
            if (result.success && result.data) {
                const parsed = JSON.parse(result.data)
                if (parsed.slides && Array.isArray(parsed.slides)) {
                    setSlides(parsed.slides)
                    addToast('성공적으로 불러왔습니다. 저장 버튼을 눌러 라이브러리에 추가해주세요.', 'success')
                } else {
                    addToast('지원하지 않는 파일 형식입니다.', 'error')
                }
            } else if (!result.canceled && result.error) {
                addToast('불러오기에 실패했습니다.', 'error')
            }
        } catch (e) {
            addToast('파일 파싱에 실패했습니다.', 'error')
        }
    }

    return (
        <>
            <div className="p-3 bg-gray-900 border-b border-gray-800">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 ml-auto">
                        <div className="relative" ref={fileMenuRef}>
                            <button
                                onClick={() => setFileMenuOpen(!fileMenuOpen)}
                                className="px-2 py-1 text-[11px] bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors flex items-center gap-1 shadow-sm border border-gray-600"
                            >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                                </svg>
                                파일
                            </button>

                            {fileMenuOpen && (
                                <div className="absolute right-0 mt-1 w-40 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-50 py-1">
                                    <button
                                        onClick={() => { setFileMenuOpen(false); saveCurrentPresentation(); }}
                                        className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 flex items-center gap-2"
                                    >
                                        <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                                        </svg>
                                        라이브러리에 저장
                                        <span className="ml-auto text-[10px] text-gray-500">Ctrl+S</span>
                                    </button>
                                    <div className="border-t border-gray-700 my-1"></div>
                                    <button
                                        onClick={() => { setFileMenuOpen(false); handleExport(); }}
                                        className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 flex items-center gap-2"
                                    >
                                        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                        </svg>
                                        파일로 내보내기
                                    </button>
                                    <button
                                        onClick={() => { setFileMenuOpen(false); handleImport(); }}
                                        className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 flex items-center gap-2"
                                    >
                                        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                        </svg>
                                        프로젝트 불러오기
                                    </button>
                                </div>
                            )}
                        </div>

                        <button
                            onClick={createNewPresentation}
                            className="px-2 py-1 text-[11px] font-medium bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors flex items-center gap-1 shadow-sm"
                            title="새로운 찬양(프레젠테이션)을 만듭니다"
                        >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            새 찬양
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
                        className={`group flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${currentPresentationId === presentation.id
                            ? 'bg-blue-600/20 shadow-[inset_2px_0_0_0_rgb(59,130,246)]'
                            : 'hover:bg-gray-700/50'
                            }`}
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <svg className={`w-4 h-4 ${currentPresentationId === presentation.id ? 'text-blue-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                            </svg>
                            <span className={`text-sm truncate ${currentPresentationId === presentation.id ? 'text-blue-300 font-medium' : 'text-gray-300'}`}>
                                {presentation.title}
                            </span>
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
