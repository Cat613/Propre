import { useShallow } from 'zustand/react/shallow'
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react'
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
import {
  Archive,
  Download,
  ListMusic,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Upload,
} from 'lucide-react'
import { SortablePlaylistItem } from './SortablePlaylistItem'

const ServicePlanPanel = lazy(() => import('./ServicePlanPanel'))
const ServiceTemplatesDialog = lazy(() => import('./ServiceTemplatesDialog'))
const CueSheetExportDialog = lazy(() => import('./CueSheetExportDialog'))

const PlaylistPanel: React.FC = () => {
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'songs' | 'all'>('songs')
  const [managerMode, setManagerMode] = useState<'browse' | 'create' | 'rename' | null>(null)
  const [templateDialog, setTemplateDialog] = useState<{
    mode: 'browse' | 'save'
    title?: string
    date?: string
  } | null>(null)
  const [exportingFor, setExportingFor] = useState<string | null>(null)
  const actionsRef = useRef<HTMLDetailsElement>(null)
  const closeActions = () => {
    if (actionsRef.current) actionsRef.current.open = false
  }
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(event.target as Node)) closeActions()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  const setlists = usePresentationStore((s) => s.setlists)
  const songs = usePresentationStore((s) => s.setlistSongs)
  const activeId = usePresentationStore((s) => s.activeSetlistId)
  const library = usePresentationStore((s) => s.library)
  useModalGuard(busy)
  const runFile = async (operation: 'save' | 'load', append = false) => {
    if (busy) return
    closeActions()
    actionsRef.current?.querySelector('summary')?.focus()
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
  const runServiceFile = async (operation: 'save' | 'load') => {
    if (busy) return
    closeActions()
    actionsRef.current?.querySelector('summary')?.focus()
    setBusy(true)
    try {
      const result = await usePresentationStore.getState().serviceFile(operation)
      if (result.success)
        usePresentationStore
          .getState()
          .addToast(
            operation === 'save'
              ? '전체 예배 파일을 저장했습니다.'
              : `${result.itemCount}개 순서를 새 예배로 불러왔습니다.`,
            'success',
          )
      else if (!result.canceled)
        usePresentationStore
          .getState()
          .addToast(result.error || '예배 파일 작업에 실패했습니다.', 'error')
    } catch (error) {
      usePresentationStore
        .getState()
        .addToast(
          error instanceof Error ? error.message : '예배 파일 작업에 실패했습니다.',
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
  useEffect(() => {
    if (!activeId) return
    try {
      setView(
        localStorage.getItem(`propre-setlist-view-v1:${activeId}`) === 'all' ? 'all' : 'songs',
      )
    } catch {
      setView('songs')
    }
  }, [activeId])
  const selectedSong = songs.find((s) => s.presentation.id === currentPresentationId)
  const originalExists =
    !!selectedSong && library.some((p) => p.id === selectedSong.sourcePresentationId)
  const selectedOriginal = library.some((p) => p.id === currentPresentationId)
  const owner = setlists.find((s) =>
    s.items.some((item) => item.presentationId === currentPresentationId),
  )
  const publish = async () => {
    if (busy || !selectedSong) return
    closeActions()
    actionsRef.current?.querySelector('summary')?.focus()
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
      <div
        className="relative shrink-0 border-b border-white/5 px-3 py-2.5"
        data-testid="setlist-header"
      >
        <h2 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-gray-200">
          <ListMusic size={14} className="shrink-0 text-gray-500" />
          <button
            type="button"
            aria-label="콘티 이름·날짜 수정"
            disabled={busy || !active || !!active.deletedAt}
            onClick={() => {
              closeActions()
              setManagerMode('rename')
            }}
            title={active ? `${active.title} · 이름과 날짜 수정` : '새 콘티를 먼저 만들어주세요'}
            className="group flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-default"
          >
            <span className="min-w-0 flex-1 truncate">{active?.title || '현재 콘티'}</span>
            {active && <Pencil size={11} className="shrink-0 text-gray-500" />}
            {active?.date && (
              <span className="shrink-0 text-[10px] font-normal text-gray-500">{active.date}</span>
            )}
          </button>
          <span
            aria-label={`${playlist.length}곡`}
            className="shrink-0 text-[10px] font-normal text-gray-500"
          >
            {playlist.length}곡
          </span>
        </h2>
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => setManagerMode('create')}
            className="workbench-button workbench-compact-action min-w-0 flex-1"
            title="이름과 날짜를 입력해 새 콘티 만들기"
          >
            <Plus size={13} />새 콘티
          </button>
          <button
            type="button"
            aria-label="콘티 보관함"
            disabled={busy}
            onClick={() => setManagerMode('browse')}
            className="workbench-button workbench-compact-action shrink-0"
            title="보관한 콘티 찾기·복제"
          >
            <Archive size={13} />
            보관함
          </button>
          <details
            ref={actionsRef}
            className="shrink-0"
            onKeyDown={(e) => {
              if (e.key === 'Escape' && actionsRef.current?.open) {
                e.preventDefault()
                e.stopPropagation()
                closeActions()
                actionsRef.current?.querySelector('summary')?.focus()
              }
            }}
          >
            <summary
              role="button"
              aria-label="콘티 더 보기"
              title="콘티 파일 작업·원곡 반영"
              className={`workbench-button workbench-compact-action list-none [&::-webkit-details-marker]:hidden ${busy ? 'pointer-events-none opacity-40' : ''}`}
              aria-disabled={busy}
              tabIndex={busy ? -1 : 0}
              onClick={(e) => {
                if (busy) e.preventDefault()
              }}
              onKeyDown={(e) => {
                if (busy && (e.key === 'Enter' || e.key === ' ')) e.preventDefault()
              }}
            >
              <MoreHorizontal size={16} />
            </summary>
            <div
              className="absolute right-3 top-full z-50 mt-1 max-h-[55vh] overflow-y-auto w-52 max-w-[calc(100%_-_1.5rem)] rounded-lg border border-white/10 bg-gray-900 p-1 shadow-xl"
              aria-label="콘티 작업"
            >
              <button
                type="button"
                className="flex w-full rounded px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5"
                disabled={busy}
                onClick={() => {
                  closeActions()
                  setTemplateDialog({ mode: 'browse' })
                }}
              >
                예배 템플릿
              </button>
              <button
                type="button"
                className="flex w-full rounded px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5 disabled:opacity-40"
                disabled={busy || !active}
                onClick={() => {
                  closeActions()
                  setTemplateDialog({ mode: 'save' })
                }}
              >
                템플릿으로 저장
              </button>
              <button
                type="button"
                className="flex w-full rounded px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5 disabled:opacity-40"
                disabled={busy || !active}
                onClick={() => {
                  closeActions()
                  setExportingFor(active!.id)
                }}
              >
                큐시트 인쇄·PDF
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5 disabled:opacity-40"
                disabled={busy || !active}
                onClick={() => void runServiceFile('save')}
                title="담당자·메모·연결 자료를 포함한 전체 예배"
              >
                <Save size={13} />
                예배 전체로 저장
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5 disabled:opacity-40"
                disabled={busy}
                onClick={() => void runServiceFile('load')}
              >
                <Download size={13} />
                예배 파일 불러오기
              </button>
              <div className="my-1 border-t border-white/10" />
              <button
                type="button"
                aria-label="파일 저장"
                disabled={busy || playlist.length === 0}
                onClick={() => void runFile('save')}
                className="flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Save size={13} />
                파일로 저장
              </button>
              <button
                type="button"
                aria-label="새 콘티로 불러오기"
                disabled={busy}
                onClick={() => void runFile('load')}
                className="flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download size={13} />새 콘티로 불러오기
              </button>
              <button
                type="button"
                aria-label="현재 콘티에 추가"
                disabled={busy || !activeId}
                onClick={() => void runFile('load', true)}
                className="flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={13} />
                현재 콘티에 추가
              </button>
              {selectedSong && (
                <div className="mt-1 border-t border-white/10 pt-1">
                  <p
                    className="truncate px-3 py-1 text-[10px] text-gray-500"
                    title={selectedSong.presentation.title}
                  >
                    편집곡: {selectedSong.presentation.title}
                  </p>
                  <button
                    type="button"
                    aria-label={
                      originalExists ? '찬양 목록 원곡에 반영' : '찬양 목록에 새 곡으로 저장'
                    }
                    title={
                      originalExists
                        ? '현재 수정본을 찬양 목록 원곡에 반영'
                        : '현재 수정본을 찬양 목록에 새 곡으로 저장'
                    }
                    disabled={busy}
                    onClick={() => void publish()}
                    className="flex w-full cursor-pointer items-center gap-2 rounded px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-40"
                  >
                    <Upload size={13} />
                    {originalExists ? '찬양 목록 원곡에 반영' : '찬양 목록에 새 곡으로 저장'}
                  </button>
                </div>
              )}
            </div>
          </details>
        </div>
      </div>
      {selectedSong && (owner?.id !== activeId || !!owner?.deletedAt) && (
        <p
          className="shrink-0 truncate border-b border-white/5 px-3 py-1.5 text-[10px] text-amber-300"
          title={`편집 중: ${owner?.title || '콘티 곡'}${owner?.deletedAt ? ' (휴지통)' : ''} · 현재 콘티와 다른 자료입니다. 원곡은 별도로 보존됩니다.`}
        >
          편집: {owner?.title || '콘티 곡'}
          {owner?.deletedAt ? ' (휴지통)' : ''}
        </p>
      )}
      {!selectedSong && selectedOriginal && (
        <p
          className="shrink-0 border-b border-white/5 px-3 py-1.5 text-[10px] text-gray-500"
          title="찬양 목록 원곡을 편집합니다. 보관한 콘티는 유지됩니다."
        >
          찬양 목록 원곡 편집 중
        </p>
      )}
      {managerMode && (
        <SetlistManager
          initialAction={managerMode === 'browse' ? undefined : managerMode}
          onClose={() => setManagerMode(null)}
          onTemplates={(seed) => {
            setManagerMode(null)
            setTemplateDialog({ mode: 'browse', ...seed })
          }}
        />
      )}
      {templateDialog && (
        <Suspense fallback={<p className="p-3 text-xs text-gray-500">템플릿 불러오는 중…</p>}>
          <ServiceTemplatesDialog
            initialMode={templateDialog.mode}
            initialTitle={templateDialog.title}
            initialDate={templateDialog.date}
            onClose={() => {
              setTemplateDialog(null)
              requestAnimationFrame(() => actionsRef.current?.querySelector('summary')?.focus())
            }}
          />
        </Suspense>
      )}
      {exportingFor && (
        <Suspense fallback={<p className="p-3 text-xs text-gray-500">큐시트 출력 불러오는 중…</p>}>
          <CueSheetExportDialog
            setlistId={exportingFor}
            onClose={() => {
              setExportingFor(null)
              requestAnimationFrame(() => actionsRef.current?.querySelector('summary')?.focus())
            }}
          />
        </Suspense>
      )}
      {busy && (
        <p role="status" className="px-3 py-1 text-xs text-gray-400">
          파일 작업 중…
        </p>
      )}
      {active?.servicePlan && (
        <div className="workbench-tabs mx-2 my-1 shrink-0" role="group" aria-label="콘티 보기">
          {(['songs', 'all'] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              className={`workbench-tab px-2 py-1 text-[11px] ${view === mode ? 'bg-blue-500/15 text-blue-300' : 'text-gray-500'}`}
              aria-pressed={view === mode}
              onClick={() => {
                setView(mode)
                try {
                  localStorage.setItem(`propre-setlist-view-v1:${active.id}`, mode)
                } catch {
                  /* View preference is optional. */
                }
              }}
            >
              {mode === 'songs' ? '곡' : '전체 순서'}
            </button>
          ))}
        </div>
      )}
      {view === 'all' && active?.servicePlan ? (
        <Suspense fallback={<p className="p-3 text-xs text-gray-500">전체 순서 불러오는 중…</p>}>
          <ServicePlanPanel key={active.id} list={active} />
        </Suspense>
      ) : (
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
              accessibility={{
                screenReaderInstructions: {
                  draggable:
                    'Enter로 곡을 엽니다. Alt와 위 또는 아래 화살표를 함께 눌러 순서를 이동합니다.',
                },
              }}
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
                    itemCount={playlist.length}
                    moveItem={(from, to) => {
                      if (!busy) void reorderPlaylist(from, to).catch(() => {})
                    }}
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
      )}
    </div>
  )
}

export default PlaylistPanel
