import { useShallow } from 'zustand/react/shallow'
import React from 'react'
import { BookOpen, Sparkles } from 'lucide-react'
import { usePresentationStore } from '../store'
import type { Slide } from '../types'
import { mediaKind } from '../../shared/model'

interface ToolbarActionsProps {
  onOpenBulkEdit: () => void
  onOpenBibleInsert: () => void
  onOpenSongPreparation: () => void
}

const ToolbarActions: React.FC<ToolbarActionsProps> = ({
  onOpenBulkEdit,
  onOpenBibleInsert,
  onOpenSongPreparation,
}) => {
  const { addSlide, clearLayer, clearAll } = usePresentationStore(
    useShallow((state) => ({
      addSlide: state.addSlide,
      clearLayer: state.clearLayer,
      clearAll: state.clearAll,
    })),
  )

  const handleNewSlide = () => {
    const newSlide: Slide = {
      id: crypto.randomUUID(),
      content: '',
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
        if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(filePath)) {
          usePresentationStore.getState().addMediaToBin([filePath])
          return
        }
        const type = mediaKind(filePath) as 'image' | 'video'

        const newSlide: Slide = {
          id: crypto.randomUUID(),
          content: '',
          type,
          backgroundUrl: filePath,
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
      usePresentationStore
        .getState()
        .addToast('미디어를 등록하지 못했습니다. 파일 형식·크기·저장 공간을 확인해주세요.', 'error')
    }
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-3 border-r border-gray-700 pr-4 py-1">
      {/* Group 1: Clear Actions */}
      <div className="flex flex-wrap items-center bg-gray-900/40 rounded-lg p-1 border border-gray-700/50 shadow-inner">
        <button
          onClick={() => clearLayer('background')}
          className="px-3 py-1.5 text-xs font-semibold text-gray-400 hover:bg-gray-700 hover:text-white rounded transition-colors flex items-center gap-1.5"
          title="배경 그림/영상을 지웁니다"
        >
          <svg
            className="w-4 h-4 text-red-500/80"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          배경 지우기
        </button>
        <div className="w-px h-4 bg-gray-700 mx-1" />
        <button
          onClick={() => clearLayer('slide')}
          className="px-3 py-1.5 text-xs font-semibold text-gray-400 hover:bg-gray-700 hover:text-white rounded transition-colors flex items-center gap-1.5"
          title="슬라이드 송출을 멈추고 텍스트를 지웁니다"
        >
          <svg
            className="w-4 h-4 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16m-7 6h7"
            />
          </svg>
          텍스트 지우기
        </button>
        <div className="w-px h-4 bg-gray-700 mx-1" />
        <button
          onClick={clearAll}
          className="px-3 py-1.5 text-xs font-semibold text-red-400/80 hover:bg-red-500/20 hover:text-red-300 rounded transition-colors flex items-center gap-1.5"
          title="배경·텍스트·오디오·프롭·자막 송출을 모두 즉시 중단합니다"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          모두 지우기
        </button>
      </div>

      {/* Group 2: Add Slides */}
      <div className="flex flex-wrap items-center bg-gray-900/40 rounded-lg p-1 border border-gray-700/50 shadow-inner [&_button]:whitespace-nowrap">
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
          onClick={onOpenBibleInsert}
          className="px-3 py-1.5 text-xs font-semibold text-yellow-400/90 hover:bg-yellow-500/20 hover:text-yellow-300 rounded transition-colors flex items-center gap-1.5"
          title="현재 찬양 자료에 성경 구절을 말씀 슬라이드로 추가합니다"
        >
          <BookOpen className="w-4 h-4" aria-hidden="true" />
          성경 구절 추가
        </button>
        <div className="w-px h-4 bg-gray-700 mx-1" />
        <button
          onClick={handleAddMedia}
          className="px-3 py-1.5 text-xs font-semibold text-purple-400/90 hover:bg-purple-500/20 hover:text-purple-300 rounded transition-colors flex items-center gap-1.5"
          title="이미지/영상을 배경으로 하는 새 미디어 슬라이드를 추가합니다"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          미디어 슬라이드 추가
        </button>
      </div>

      {/* Group 3: Editors */}
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <button
          onClick={() => onOpenBulkEdit()}
          className="px-3 py-1.5 text-xs font-semibold bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
          title="모든 슬라이드의 텍스트를 한 페이지에서 빠르게 편집합니다"
        >
          <svg
            className="w-4 h-4 text-indigo-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
            />
          </svg>
          전체 텍스트 목록 편집
        </button>

        <button
          type="button"
          onClick={onOpenSongPreparation}
          className="px-3 py-2 text-xs font-bold bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white rounded-lg transition-all flex items-center gap-1.5 shadow-md"
          title="PDF·이미지에서 가사와 송폼을 분석해 찬양과 플레이리스트를 준비합니다"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          AI로 찬양 준비
        </button>
      </div>
    </div>
  )
}

export default ToolbarActions
