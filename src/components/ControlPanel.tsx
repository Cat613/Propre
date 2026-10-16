import { useShallow } from 'zustand/react/shallow'
import AppUpdatePanel from './AppUpdatePanel'
import SaveStatus from './SaveStatus'
import { Image, Layers, Pencil, Settings2, SlidersHorizontal } from 'lucide-react'
import ToastContainer from './ToastContainer'
import AudioPlayer from './AudioPlayer'
import StageMessageStatusBar from './StageMessageStatusBar'
import { hotkeysBlocked } from '../hooks/useModalGuard'
import React, { useEffect, useState } from 'react'
import LeftSidebar from './LeftSidebar'
import SlideGrid from './SlideGrid'
import PreviewPanel from './PreviewPanel'
import GlobalStylePanel from './GlobalStylePanel'
import AdvancedLayersPanel from './AdvancedLayersPanel'
import SettingsTabPanel from './SettingsTabPanel'
import ControlToolbar from './ControlToolbar'
import MediaBin from './MediaBin'
import { usePresentationStore } from '../store'
import { useHotkeys } from '../hooks/useHotkeys'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

const ControlPanel: React.FC = () => {
  const {
    slides,
    setActiveSlide,
    clearText,
    clearBackground,
    clearAll,
    isModalOpen,
    currentPresentationTitle,
    setCurrentPresentationTitle,
    preparationBusy,
  } = usePresentationStore(
    useShallow((state) => ({
      slides: state.slides,
      setActiveSlide: state.setActiveSlide,
      clearText: state.clearText,
      clearBackground: state.clearBackground,
      clearAll: state.clearAll,
      isModalOpen: state.isModalOpen,
      currentPresentationTitle: state.currentPresentationTitle,
      setCurrentPresentationTitle: state.setCurrentPresentationTitle,
      preparationBusy: state.preparationBusy,
    })),
  )

  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editingTitleText, setEditingTitleText] = useState('')
  const [activeRightTab, setActiveRightTab] = useState<'media' | 'styles' | 'layers' | 'settings'>(
    'media',
  )

  useEffect(() => {
    if (isEditingTitle) {
      setEditingTitleText(currentPresentationTitle ?? '')
    }
  }, [isEditingTitle, currentPresentationTitle])

  const handleTitleSave = () => {
    setIsEditingTitle(false)
    setCurrentPresentationTitle(editingTitleText)
  }

  // Use global hotkeys hook
  useHotkeys()

  // Number keys for quick slide selection (Specific to ControlPanel)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in input/textarea or modal is open
      const target = e.target as HTMLElement
      if (
        hotkeysBlocked(e) ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      // Number keys 1-9 for quick slide selection
      if (e.key >= '1' && e.key <= '9') {
        const index = parseInt(e.key) - 1
        if (index < slides.length) {
          const targetSlide = slides[index]
          setActiveSlide(targetSlide.id)
        }
        return
      }

      // Additional Control Panel specific hotkeys (F1, F2, F4)
      if (e.key === 'F1') {
        e.preventDefault()
        clearText()
      } else if (e.key === 'F2') {
        e.preventDefault()
        clearAll()
      } else if (e.key === 'F4') {
        e.preventDefault()
        clearBackground()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [slides, isModalOpen, setActiveSlide, clearText, clearAll, clearBackground])

  const interfaceTheme = usePresentationStore((s) => s.interfaceTheme)
  const currentId = usePresentationStore((s) => s.currentPresentationId)
  const setlistSongs = usePresentationStore((s) => s.setlistSongs)
  const isSetlistSong = setlistSongs.some((song) => song.presentation.id === currentId)
  const tabs = [
    { id: 'media', label: '미디어', icon: Image },
    { id: 'styles', label: '스타일', icon: SlidersHorizontal },
    { id: 'layers', label: '레이어', icon: Layers },
    { id: 'settings', label: '설정', icon: Settings2 },
  ] as const

  return (
    <div
      data-control-root="true"
      data-theme={interfaceTheme}
      aria-busy={preparationBusy}
      className="workbench h-screen w-screen flex flex-col overflow-hidden"
    >
      {preparationBusy && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] rounded-xl border border-blue-400/20 bg-blue-950 px-4 py-3 text-sm text-blue-200"
        >
          변경 내용을 적용하는 중… · F2로 전체 중단 가능
        </div>
      )}
      <AudioPlayer />
      <StageMessageStatusBar />
      <ToastContainer />
      <PanelGroup
        direction="horizontal"
        className="min-h-0 flex-1 p-3"
        autoSaveId="propre-workbench-panels-v1"
      >
        <Panel
          id="workbench-left"
          defaultSize={23}
          minSize={17}
          maxSize={35}
          className="workbench-panel flex min-w-0 flex-col"
        >
          <LeftSidebar />
        </Panel>
        <PanelResizeHandle
          aria-label="왼쪽 패널 너비 조절"
          className="workbench-resize workbench-resize-horizontal"
        />
        <Panel
          id="workbench-editor"
          defaultSize={50}
          minSize={30}
          className="workbench-panel flex min-w-0 flex-col"
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/5 px-4 py-4">
            <div className="min-w-0 flex-1">
              <p className="workbench-muted mb-2">
                슬라이드 편집 <span className="mx-1 text-gray-600">/</span>{' '}
                {isSetlistSong ? '콘티 곡' : '찬양 자료'}
              </p>
              {isEditingTitle ? (
                <input
                  autoFocus
                  aria-label="프레젠테이션 제목"
                  className="workbench-field w-full text-base font-semibold"
                  value={editingTitleText}
                  onChange={(e) => setEditingTitleText(e.target.value)}
                  onBlur={handleTitleSave}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTitleSave()
                    if (e.key === 'Escape') {
                      setEditingTitleText(currentPresentationTitle ?? '')
                      setIsEditingTitle(false)
                    }
                  }}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <h1
                    className="min-w-0 truncate text-lg font-semibold tracking-tight cursor-text"
                    onDoubleClick={() => setIsEditingTitle(true)}
                    title="더블클릭하여 제목 수정"
                  >
                    {currentPresentationTitle || '새 프레젠테이션'}
                  </h1>
                  <button
                    type="button"
                    aria-label="제목 수정"
                    onClick={() => setIsEditingTitle(true)}
                    className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-200"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              )}
            </div>
            <span className="mt-7 shrink-0 rounded-md border border-white/5 bg-white/5 px-2 py-1 text-[11px] tabular-nums text-gray-400">
              {slides.length} 슬라이드
            </span>
          </header>
          <ControlToolbar />
          <div data-workbench-editor="true" className="min-h-0 flex-1 workbench-editor-surface">
            <SlideGrid />
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-1 border-t border-white/5 px-4 py-2 text-[10px] text-gray-500">
            <SaveStatus />
            <AppUpdatePanel />
            <span>← → 이동 · F1 텍스트 · F2 전체 중지</span>
          </footer>
        </Panel>
        <PanelResizeHandle
          aria-label="오른쪽 패널 너비 조절"
          className="workbench-resize workbench-resize-horizontal"
        />
        <Panel
          id="workbench-inspector"
          defaultSize={27}
          minSize={22}
          maxSize={42}
          className="workbench-panel flex min-w-0 flex-col"
        >
          <PreviewPanel />
          <nav aria-label="송출 도구" className="shrink-0 border-b border-white/5 p-3">
            <div className="workbench-tabs">
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  type="button"
                  key={id}
                  aria-pressed={activeRightTab === id}
                  onClick={() => setActiveRightTab(id)}
                  className="workbench-tab"
                >
                  <Icon size={13} className="shrink-0" />
                  {label}
                </button>
              ))}
            </div>
          </nav>
          <div
            data-workbench-inspector="true"
            className="workbench-inspector workbench-scroll flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            {activeRightTab === 'media' && <MediaBin />}
            {activeRightTab === 'styles' && <GlobalStylePanel />}
            {activeRightTab === 'layers' && <AdvancedLayersPanel />}
            {activeRightTab === 'settings' && <SettingsTabPanel />}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}

export default ControlPanel
