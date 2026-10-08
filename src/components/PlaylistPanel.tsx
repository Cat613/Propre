import { useShallow } from 'zustand/react/shallow'
import React, { useState } from 'react'
import { useModalGuard } from '../hooks/useModalGuard'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { usePresentationStore } from '../store'
import SetlistManager from './SetlistManager'
import { SortablePlaylistItem } from './SortablePlaylistItem'

const PlaylistPanel: React.FC = () => {
  const [busy, setBusy] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const setlists = usePresentationStore((s) => s.setlists)
  const songs = usePresentationStore((s) => s.setlistSongs)
  const activeId = usePresentationStore((s) => s.activeSetlistId)
  const library = usePresentationStore((s) => s.library)
  useModalGuard(busy)
  const runFile = async (operation: 'save' | 'load') => {
    if (busy) return
    setBusy(true)
    try {
      const result = await usePresentationStore.getState().playlistFile(operation)
      if (result.success)
        usePresentationStore
          .getState()
          .addToast(
            operation === 'save'
              ? '플레이리스트 파일을 저장했습니다.'
              : `${result.itemCount}개 순서를 불러왔습니다. 새 곡 ${result.added}개 · 기존 곡 ${result.reused}개`,
            'success',
          )
      else if (!result.canceled)
        usePresentationStore
          .getState()
          .addToast(result.error || '파일 작업에 실패했습니다.', 'error')
    } catch {
      usePresentationStore
        .getState()
        .addToast(
          '파일 작업에 실패했습니다. 자동 저장 상태를 확인한 뒤 다시 시도해주세요.',
          'error',
        )
    } finally {
      setBusy(false)
    }
  }
  const {
    playlist,
    addToPlaylist,
    removeFromPlaylist,
    selectPresentation,
    currentPresentationId,
    reorderPlaylist,
  } = usePresentationStore(
    useShallow((state) => ({
      playlist: state.playlist,
      addToPlaylist: state.addToPlaylist,
      removeFromPlaylist: state.removeFromPlaylist,
      selectPresentation: state.selectPresentation,
      currentPresentationId: state.currentPresentationId,
      reorderPlaylist: state.reorderPlaylist,
    })),
  )

  const active = setlists.find((s) => s.id === activeId)
  const selectedSong = songs.find((s) => s.presentation.id === currentPresentationId)
  const originalExists =
    !!selectedSong && library.some((p) => p.id === selectedSong.sourcePresentationId)
  const selectedOriginal = library.some((p) => p.id === currentPresentationId)
  const owner = setlists.find((s) =>
    s.items.some((item) => item.presentationId === currentPresentationId),
  )
  const publish = async () => {
    if (busy || !selectedSong) return
    setBusy(true)
    try {
      const result = await usePresentationStore
        .getState()
        .publishSetlistSong(selectedSong.presentation.id)
      if (result.success)
        usePresentationStore
          .getState()
          .addToast('찬양 목록에 반영했습니다. 다른 콘티는 유지됩니다.', 'success')
      else if (!result.canceled)
        usePresentationStore
          .getState()
          .addToast(result.error || '원곡 저장에 실패했습니다.', 'error')
    } catch {
      usePresentationStore
        .getState()
        .addToast('원곡 저장에 실패했습니다. 자동 저장 상태를 확인해주세요.', 'error')
    } finally {
      setBusy(false)
    }
  }
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Requires moving 5px to start drag, allowing clicks to pass through
      },
    }),
  )

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('presentationId')
    if (id && !busy) {
      void addToPlaylist(id).catch(() => {})
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!busy && over && active.id !== over.id) {
      const oldIndex = playlist.findIndex((item) => item.id === active.id)
      const newIndex = playlist.findIndex((item) => item.id === over.id)
      if (oldIndex !== -1 && newIndex !== -1) {
        void reorderPlaylist(oldIndex, newIndex).catch(() => {})
      }
    }
  }

  return (
    <div className="flex-1 flex flex-col border-b border-gray-800 min-h-0 bg-gray-900">
      <div className="flex items-center justify-between p-3 bg-gray-900 border-b border-gray-800">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">플레이리스트</h2>
        <span className="text-[10px] bg-gray-800 text-gray-500 px-1.5 py-0.5 rounded">
          {playlist.length}
        </span>
      </div>

      <div className="px-3 py-2 border-b border-gray-800 space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-sm text-gray-200 flex-1 truncate" title={active?.title}>
            {active?.title || '새 콘티를 만들어 순서를 준비하세요'}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setManagerOpen(true)}
            className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-500"
          >
            콘티 보관함
          </button>
        </div>
        <p className="text-[11px] text-gray-400">
          {active?.date ? `${active.date} · ` : ''}곡 구성은 이 콘티에 자동 저장됩니다.
        </p>
      </div>
      <div className="flex gap-2 px-3 py-2 border-b border-gray-800">
        <button
          type="button"
          disabled={busy || playlist.length === 0}
          onClick={() => void runFile('save')}
          className="flex-1 text-xs px-2 py-1.5 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          파일 저장
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void runFile('load')}
          className="flex-1 text-xs px-2 py-1.5 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          파일 불러오기
        </button>
      </div>
      {selectedSong && (
        <div className="px-3 py-2 border-b border-gray-800 space-y-2">
          <p className="text-[11px] text-blue-300">
            편집 중: {owner?.title || '콘티 곡'}
            {owner?.deletedAt ? ' (휴지통)' : ''} · 원곡은 별도로 보존됩니다.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void publish()}
            className="w-full text-xs px-2 py-1.5 rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
          >
            {originalExists ? '찬양 목록 원곡에 반영' : '찬양 목록에 새 곡으로 저장'}
          </button>
        </div>
      )}
      {!selectedSong && selectedOriginal && (
        <p className="px-3 py-2 text-[11px] text-gray-400 border-b border-gray-800">
          편집 중: 찬양 목록 원곡 · 보관한 콘티는 유지됩니다.
        </p>
      )}
      {managerOpen && <SetlistManager onClose={() => setManagerOpen(false)} />}
      {busy && (
        <p role="status" className="px-3 py-1 text-xs text-gray-400">
          파일 작업 중…
        </p>
      )}
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={playlist.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              {playlist.map((item, index) => (
                <SortablePlaylistItem
                  key={item.id}
                  item={item}
                  index={index}
                  currentPresentationId={currentPresentationId}
                  selectPresentation={selectPresentation}
                  removeFromPlaylist={(id) => {
                    if (!busy) void removeFromPlaylist(id).catch(() => {})
                  }}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  )
}

export default PlaylistPanel
