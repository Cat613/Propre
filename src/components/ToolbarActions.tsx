import { useShallow } from 'zustand/react/shallow'
import React from 'react'
import { BookOpen, ImagePlus, List, Plus, Sparkles, Square, Type, ImageOff } from 'lucide-react'
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
  const { addSlide } = usePresentationStore(
    useShallow((state) => ({
      addSlide: state.addSlide,
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
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-label="빈 슬라이드 추가"
        onClick={handleNewSlide}
        className="workbench-button"
        title="빈 텍스트 슬라이드를 추가합니다"
      >
        <Plus size={14} className="text-blue-400" />
        텍스트
      </button>
      <button
        type="button"
        aria-label="성경 구절 추가"
        onClick={onOpenBibleInsert}
        className="workbench-button"
        title="현재 찬양 자료에 성경 구절을 추가합니다"
      >
        <BookOpen size={14} />
        성경
      </button>
      <button
        type="button"
        aria-label="미디어 슬라이드 추가"
        onClick={() => void handleAddMedia()}
        className="workbench-button"
        title="이미지·영상 슬라이드를 추가합니다"
      >
        <ImagePlus size={14} />
        미디어
      </button>
      <button
        type="button"
        aria-label="전체 텍스트 목록 편집"
        onClick={onOpenBulkEdit}
        className="workbench-button"
        title="모든 슬라이드의 가사를 한 번에 편집합니다"
      >
        <List size={14} />
        가사 편집
      </button>
      <button
        type="button"
        aria-label="AI로 찬양 준비"
        onClick={onOpenSongPreparation}
        className="workbench-button workbench-button-primary ml-auto"
        title="PDF·이미지에서 가사와 송폼을 분석합니다"
      >
        <Sparkles size={14} />
        AI 찬양 준비
      </button>
    </div>
  )
}

export function OutputClearActions() {
  const clearLayer = usePresentationStore((s) => s.clearLayer)
  const clearAll = usePresentationStore((s) => s.clearAll)
  return (
    <div className="grid grid-cols-3 gap-2" aria-label="송출 중지 도구">
      <button
        type="button"
        aria-label="배경 지우기"
        onClick={() => clearLayer('background')}
        className="workbench-button workbench-compact-action"
        title="배경 그림·영상 지우기 (F4)"
      >
        <ImageOff size={13} />
        배경
      </button>
      <button
        type="button"
        aria-label="텍스트 지우기"
        onClick={() => clearLayer('slide')}
        className="workbench-button workbench-compact-action"
        title="텍스트 송출 중지 (F1)"
      >
        <Type size={13} />
        텍스트
      </button>
      <button
        type="button"
        aria-label="모두 지우기"
        onClick={clearAll}
        className="workbench-button workbench-button-danger workbench-compact-action"
        title="배경·텍스트·오디오·레이어 전체 중지 (F2)"
      >
        <Square size={12} />
        전체 중지
      </button>
    </div>
  )
}
export default ToolbarActions
