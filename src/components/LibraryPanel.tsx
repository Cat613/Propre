import { Music2, Search, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { parseProject } from '../../shared/schema'
import { currentDocument } from '../store/runtime'
import { flushPersistence } from '../store/persistence'
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
    openPresentation,
    addToast,
    currentPresentationId,
    importPresentations,
  } = usePresentationStore(
    useShallow((state) => ({
      library: state.library,
      addToPlaylist: state.addToPlaylist,
      selectPresentation: state.selectPresentation,
      createNewPresentation: state.createNewPresentation,
      saveCurrentPresentation: state.saveCurrentPresentation,
      deletePresentation: state.deletePresentation,
      slides: state.slides,
      openPresentation: state.openPresentation,
      addToast: state.addToast,
      currentPresentationId: state.currentPresentationId,
      importPresentations: state.importPresentations,
    })),
  )

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

  const filteredLibrary = library.filter((p) =>
    p.title.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('presentationId', id)
  }

  const handleExport = async () => {
    let title = 'Untitled Presentation'
    const currentPresentation = library.find((p) => p.id === currentPresentationId)
    if (currentPresentation) {
      title = currentPresentation.title
    } else {
      const candidateSlide = slides.find((s) => s.content || (s.elements && s.elements.length > 0))
      if (candidateSlide) {
        if (candidateSlide.content) {
          title = candidateSlide.content.split('\n')[0].substring(0, 20)
        } else if (candidateSlide.elements) {
          const textElement = candidateSlide.elements.find((el) => el.type === 'text') as any
          if (textElement && textElement.text) {
            title = textElement.text.split('\n')[0].substring(0, 20)
          }
        }
      }
    }

    try {
      window.dispatchEvent(new Event('propre-flush-edits'))
      // Export the in-memory draft even when its normal storage location is unavailable.
      await flushPersistence().catch(() => {})
      const data = JSON.stringify(currentDocument() || { title, slides }, null, 2)
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

  const handleExportAll = async () => {
    try {
      await flushPersistence()
      const result = await window.ipcRenderer.createBackup()
      if (result.success) {
        addToast('전체 백업 내보내기가 완료되었습니다.', 'success')
      } else if (!result.canceled) {
        addToast('전체 백업 내보내기에 실패했습니다.', 'error')
      }
    } catch (e) {
      addToast('전체 백업 내보내기에 실패했습니다.', 'error')
    }
  }

  const handleImport = async () => {
    try {
      const result = await window.ipcRenderer.loadProject()
      if (result.success && result.data) {
        const parsed = parseProject(result.data)
        const loaded = await window.ipcRenderer.bootstrap()
        usePresentationStore.setState({ mediaBin: loaded.media })
        if (parsed.presentations.length === 1) openPresentation(parsed.presentations[0])
        else await importPresentations(parsed.presentations)
        addToast(
          `${parsed.presentations.length}개 자료를 새 자료로 불러왔습니다. 자동 저장됩니다.`,
          'success',
        )
      } else if (!result.canceled && result.error) {
        addToast('불러오기에 실패했습니다.', 'error')
      }
    } catch (e) {
      addToast('파일 파싱에 실패했습니다.', 'error')
    }
  }

  return (
    <>
      <div className="shrink-0 p-3 border-b border-white/5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="workbench-muted">
            찬양 목록 <span className="ml-1 text-gray-600">{library.length}</span>
          </p>
          <div className="flex items-center gap-2 ml-auto">
            <div className="relative" ref={fileMenuRef}>
              <button onClick={() => setFileMenuOpen(!fileMenuOpen)} className="workbench-button">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
                파일
              </button>

              {fileMenuOpen && (
                <div className="absolute right-0 mt-1 w-48 bg-[#172131] border border-white/10 rounded-xl shadow-2xl z-50 p-1">
                  <button
                    onClick={() => {
                      setFileMenuOpen(false)
                      void saveCurrentPresentation().catch(() =>
                        addToast('자동 저장에 실패했습니다.', 'error'),
                      )
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-white/5 flex items-center gap-2"
                  >
                    <svg
                      className="w-3.5 h-3.5 text-emerald-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                      />
                    </svg>
                    자동 저장 확인
                    <span className="ml-auto text-[10px] text-gray-500">Ctrl+S</span>
                  </button>
                  <button
                    className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-white/5"
                    onClick={() => {
                      setFileMenuOpen(false)
                      void flushPersistence()
                        .catch(() => {})
                        .then(() => window.ipcRenderer.restoreBackup())
                        .then((result) => {
                          if (result.success) location.reload()
                          else if (!result.canceled) addToast(result.error || '복원 실패', 'error')
                        })
                        .catch(() => addToast('복원 전 저장에 실패했습니다.', 'error'))
                    }}
                  >
                    전체 백업 복원
                  </button>
                  <button
                    className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-white/5"
                    onClick={() => {
                      setFileMenuOpen(false)
                      if (
                        !confirm(
                          '마지막 저장 직전의 자료로 복구할까요? 현재 자료도 백업에 보관합니다.',
                        )
                      )
                        return
                      void flushPersistence()
                        .then(() => window.ipcRenderer.recoverPrevious())
                        .then(
                          () => location.reload(),
                          () => addToast('최근 백업을 복구하지 못했습니다.', 'error'),
                        )
                    }}
                  >
                    직전 저장본 복구
                  </button>
                  <div className="border-t border-white/5 my-1"></div>
                  <button
                    onClick={() => {
                      setFileMenuOpen(false)
                      handleExport()
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-white/5 flex items-center gap-2"
                  >
                    <svg
                      className="w-3.5 h-3.5 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                      />
                    </svg>
                    파일로 내보내기
                  </button>
                  <button
                    onClick={() => {
                      setFileMenuOpen(false)
                      handleExportAll()
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-white/5 flex items-center gap-2"
                  >
                    <svg
                      className="w-3.5 h-3.5 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                    전체 백업 내보내기
                  </button>
                  <button
                    onClick={() => {
                      setFileMenuOpen(false)
                      handleImport()
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-white/5 flex items-center gap-2"
                  >
                    <svg
                      className="w-3.5 h-3.5 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                    프로젝트 불러오기
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={createNewPresentation}
              className="workbench-button workbench-button-primary"
              title="새로운 찬양(프레젠테이션)을 만듭니다"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              새 찬양
            </button>
          </div>
        </div>

        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 topx-2 py-1.5 text-gray-500"
          />
          <input
            type="text"
            aria-label="찬양 검색"
            placeholder="제목 검색..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="workbench-field workbench-search-field w-full"
          />
          {searchTerm && (
            <button
              type="button"
              aria-label="찬양 검색 지우기"
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-2 p-0.5 text-gray-500 hover:text-gray-200"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="workbench-scroll min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
        {!filteredLibrary.length && (
          <div className="flex min-h-28 flex-col items-center justify-center gap-2 px-3 py-5 text-center">
            <Music2 size={24} strokeWidth={1.5} className="text-gray-600" />
            <p className="text-xs text-gray-400">
              {searchTerm ? '검색된 찬양이 없습니다.' : '첫 찬양을 준비해보세요'}
            </p>
            <p className="text-[10px] leading-relaxed text-gray-500">
              {searchTerm
                ? '다른 제목으로 검색해보세요.'
                : '새 찬양을 만들거나 파일을 불러올 수 있습니다.'}
            </p>
          </div>
        )}
        {filteredLibrary.map((presentation) => (
          <div
            key={presentation.id}
            data-testid="library-item"
            role="button"
            tabIndex={0}
            draggable
            onDragStart={(e) => handleDragStart(e, presentation.id)}
            onClick={() => selectPresentation(presentation.id)}
            onKeyDown={(event) => {
              if (
                event.target === event.currentTarget &&
                (event.key === 'Enter' || event.key === ' ')
              ) {
                event.preventDefault()
                event.stopPropagation()
                selectPresentation(presentation.id)
              }
            }}
            className={`group relative flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors ${
              currentPresentationId === presentation.id
                ? 'border-blue-400/20 bg-blue-500/10'
                : 'border-transparent hover:bg-white/5'
            }`}
          >
            <div className="flex flex-1 items-center gap-2 min-w-0 pr-2">
              <svg
                className={`w-3.5 h-3.5 shrink-0 ${currentPresentationId === presentation.id ? 'text-blue-400' : 'text-gray-500'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                />
              </svg>
              <div className="min-w-0">
                <span
                  className={`block text-xs truncate ${currentPresentationId === presentation.id ? 'text-blue-300 font-medium' : 'text-gray-300'}`}
                >
                  {presentation.title}
                </span>
                <p className="mt-0.5 text-[10px] text-gray-500">
                  {presentation.slides.length} 슬라이드
                </p>
              </div>
            </div>

            <div className="absolute right-1.5 flex items-center gap-1 rounded bg-gray-800 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void addToPlaylist(presentation.id).catch(() => {})
                }}
                className="p-1 text-gray-400 hover:text-green-400 rounded hover:bg-gray-600"
                title="플레이리스트에 추가"
                aria-label={`콘티에 추가: ${presentation.title}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm('정말로 이 곡을 삭제하시겠습니까?')) {
                    void deletePresentation(presentation.id).catch(() => {})
                  }
                }}
                className="p-1 text-gray-400 hover:text-red-400 rounded hover:bg-gray-600"
                title="삭제"
                aria-label={`찬양 삭제: ${presentation.title}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
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
