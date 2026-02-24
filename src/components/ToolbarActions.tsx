import React from 'react'
import { usePresentationStore } from '../store'
import type { Slide } from '../types'
import { useAIExtraction } from '../hooks/useAIExtraction'

interface ToolbarActionsProps {
    onOpenSettings: () => void
    onOpenBulkEdit: (initialText?: string) => void
}

const ToolbarActions: React.FC<ToolbarActionsProps> = ({ onOpenSettings, onOpenBulkEdit }) => {
    const {
        addSlide,
        clearLayer,
        clearAll,
        geminiApiKey
    } = usePresentationStore()

    const { isAILoading, handleAIExtract } = useAIExtraction({
        geminiApiKey,
        onRequireApiKey: onOpenSettings,
        onSuccess: (text) => onOpenBulkEdit(text)
    })

    const handleNewSlide = () => {
        const newSlide: Slide = {
            id: crypto.randomUUID(),
            content: '텍스트를 입력하세요',
            type: 'text',
            styles: {},
            label: 'None',
            labelColor: 'transparent',
        }
        addSlide(newSlide)
    }

    const handleAddMedia = async () => {
        try {
            const filePaths = await window.ipcRenderer.selectMediaFiles()
            if (filePaths.length === 0) return

            filePaths.forEach((filePath) => {
                const extension = filePath.split('.').pop()?.toLowerCase() || ''
                const videoExtensions = ['mp4', 'mov', 'webm']
                let type: Slide['type'] = 'image'
                if (videoExtensions.includes(extension)) type = 'video'

                const newSlide: Slide = {
                    id: crypto.randomUUID(),
                    content: '',
                    type,
                    backgroundUrl: `file://${filePath}`,
                    styles: {
                        fontSize: '4rem',
                        color: '#ffffff',
                        textAlign: 'center',
                    },
                    label: 'None',
                    labelColor: 'transparent',
                }
                addSlide(newSlide)
            })
        } catch (error) {
            console.error('Failed to select media files:', error)
        }
    }

    return (
        <div className="flex flex-wrap items-center gap-3 border-r border-gray-700 pr-4 py-1">

            {/* Group 1: Clear Actions */}
            <div className="flex items-center bg-gray-900/40 rounded-lg p-1 border border-gray-700/50 shadow-inner">
                <button
                    onClick={() => clearLayer('background')}
                    className="px-3 py-1.5 text-xs font-semibold text-gray-400 hover:bg-gray-700 hover:text-white rounded transition-colors flex items-center gap-1.5"
                    title="배경 그림/영상을 지웁니다"
                >
                    <svg className="w-4 h-4 text-red-500/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    배경 지우기
                </button>
                <div className="w-px h-4 bg-gray-700 mx-1" />
                <button
                    onClick={() => clearLayer('slide')}
                    className="px-3 py-1.5 text-xs font-semibold text-gray-400 hover:bg-gray-700 hover:text-white rounded transition-colors flex items-center gap-1.5"
                    title="슬라이드 송출을 멈추고 텍스트를 지웁니다"
                >
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
                    </svg>
                    텍스트 지우기
                </button>
                <div className="w-px h-4 bg-gray-700 mx-1" />
                <button
                    onClick={clearAll}
                    className="px-3 py-1.5 text-xs font-semibold text-red-400/80 hover:bg-red-500/20 hover:text-red-300 rounded transition-colors flex items-center gap-1.5"
                    title="배경과 텍스트 송출을 모두 즉시 중단합니다"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    모두 지우기
                </button>
            </div>

            {/* Group 2: Add Slides */}
            <div className="flex items-center bg-gray-900/40 rounded-lg p-1 border border-gray-700/50 shadow-inner">
                <button
                    onClick={handleNewSlide}
                    className="px-3 py-1.5 text-xs font-semibold text-blue-400/90 hover:bg-blue-500/20 hover:text-blue-300 rounded transition-colors flex items-center gap-1.5"
                    title="새로운 텍스트 슬라이드를 추가합니다"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    빈 슬라이드 추가
                </button>
                <div className="w-px h-4 bg-gray-700 mx-1" />
                <button
                    onClick={handleAddMedia}
                    className="px-3 py-1.5 text-xs font-semibold text-purple-400/90 hover:bg-purple-500/20 hover:text-purple-300 rounded transition-colors flex items-center gap-1.5"
                    title="이미지/영상을 배경으로 하는 새 미디어 슬라이드를 추가합니다"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    미디어 슬라이드 추가
                </button>
            </div>

            {/* Group 3: Editors */}
            <div className="flex items-center gap-2">
                <button
                    onClick={() => onOpenBulkEdit()}
                    className="px-3 py-1.5 text-xs font-semibold bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                    title="모든 슬라이드의 텍스트를 한 페이지에서 빠르게 편집합니다"
                >
                    <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                    전체 텍스트 목록 편집
                </button>

                {/* AI Vision Feature */}
                <button
                    onClick={handleAIExtract}
                    disabled={isAILoading}
                    className={`px-3 py-2 text-xs font-bold ${isAILoading
                        ? 'bg-amber-600/50 cursor-wait text-white/70'
                        : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white'} 
                    rounded-lg transition-all flex items-center gap-1.5 shadow-md relative overflow-hidden group`}
                    title="종이 악보나 이미지 파일을 선택하면 인공지능이 텍스트 가사를 자동으로 추출하여 슬라이드로 분리해줍니다!"
                >
                    {/* AI Sparkles animation effect */}
                    <div className="absolute inset-0 w-full h-full bg-white/20 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]" />

                    {isAILoading ? (
                        <svg className="animate-spin -ml-1 mr-1 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                    )}
                    {isAILoading ? 'AI 추출 중...' : '이미지/악보 텍스트 자동 변환'}
                </button>
            </div>
        </div>
    )
}

export default ToolbarActions
