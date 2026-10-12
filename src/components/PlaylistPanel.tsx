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
import { Archive, Download, ListMusic, Plus, Save, Upload } from 'lucide-react'
import { SortablePlaylistItem } from './SortablePlaylistItem'

const PlaylistPanel: React.FC = () => {
  const [busy, setBusy] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const setlists = usePresentationStore((s) => s.setlists)
  const songs = usePresentationStore((s) => s.setlistSongs)
  const activeId = usePresentationStore((s) => s.activeSetlistId)
  const library = usePresentationStore((s) => s.library)
  useModalGuard(busy)
  const runFile = async (operation: 'save' | 'load', append = false) => {
    if (busy) return
    setBusy(true)
    try {
      const result = await usePresentationStore.getState().playlistFile(operation, append)
      if (result.success)
        usePresentationStore
          .getState()
          .addToast(
            operation === 'save'
              ? '플레이리스트 파일을 저장했습니다.'
              : `${result.itemCount}개 순서를 ${append ? '현재 콘티에 추가했습니다' : '불러왔습니다'}. 새 곡 ${result.added}개 · 기존 곡 ${result.reused}개`,
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-white/5 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-gray-200">
              <ListMusic size={14} className="shrink-0 text-gray-500" />
              <span className="truncate" title={active?.title}>
                {active?.title || '현재 콘티'}
              </span>
              <span
                aria-label={`${playlist.length}곡`}
                className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-normal text-gray-500"
              >
                {playlist.length}
              </span>
            </h2>
            <p className="mt-1 pl-5 text-[10px] text-gray-500">
              {active?.date || '날짜 미정'}
              <span className="mx-1.5 text-gray-600">·</span>자동 저장
            </p>
          </div>
          <button
            type="button"
            aria-label="콘티 보관함"
            disabled={busy}
            onClick={() => setManagerOpen(true)}
            className="workbench-button workbench-compact-action shrink-0"
            title="보관한 콘티 찾기·복제"
          >
            <Archive size={13} />
            보관함
          </button>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <button
            type="button"
            aria-label="파일 저장"
            disabled={busy || playlist.length === 0}
            onClick={() => void runFile('save')}
            className="workbench-button workbench-compact-action"
            title="현재 콘티를 파일로 저장"
          >
            <Save size={12} />
            저장
          </button>
          <button
            type="button"
            aria-label="새 콘티로 불러오기"
            disabled={busy}
            onClick={() => void runFile('load')}
            className="workbench-button workbench-compact-action"
            title="콘티 파일을 새 콘티로 불러오기"
          >
            <Download size={12} />
            불러오기
          </button>
          <button
            type="button"
            aria-label="현재 콘티에 추가"
            disabled={busy || !activeId}
            onClick={() => void runFile('load', true)}
            className="workbench-button workbench-compact-action"
            title="콘티 파일의 곡을 현재 순서 끝에 추가"
          >
            <Plus size={12} />
            추가
          </button>
        </div>
      </div>
      {selectedSong && (
        <div className="shrink-0 border-b border-white/5 bg-blue-400/[0.03] px-3 py-2 space-y-2">
          <p className="text-[11px] text-blue-300">
            편집 중: {owner?.title || '콘티 곡'}
            {owner?.deletedAt ? ' (휴지통)' : ''} · 원곡은 별도로 보존됩니다.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void publish()}
            className="workbench-button w-full"
          >
            <Upload size={12} />
            {originalExists ? '찬양 목록 원곡에 반영' : '찬양 목록에 새 곡으로 저장'}
          </button>
        </div>
      )}
      {!selectedSong && selectedOriginal && (
        <p className="shrink-0 px-3 py-2 text-[10px] leading-relaxed text-gray-500 border-b border-white/5">
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
        className="workbench-scroll min-h-0 flex-1 overflow-y-auto p-2 space-y-0.5"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {playlist.length === 0 ? (
          <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 p-3 text-center">
            <ListMusic size={25} strokeWidth={1.5} className="text-gray-600" />
            <p className="text-xs text-gray-400">콘티에 곡을 추가해보세요</p>
            <p className="text-[10px] leading-relaxed text-gray-500">
              Songs의 ＋ 버튼을 누르거나 곡을 여기로 끌어오세요.
            </p>
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
