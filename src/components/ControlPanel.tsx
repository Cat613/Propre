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
        loadLibrary,
        currentPresentationTitle,
        setCurrentPresentationTitle,
        saveCurrentPresentation
    } = usePresentationStore()

    const [isEditingTitle, setIsEditingTitle] = useState(false)
    const [editingTitleText, setEditingTitleText] = useState('')
    const [activeRightTab, setActiveRightTab] = useState<'media' | 'styles' | 'layers' | 'settings'>('media')

    useEffect(() => {
        if (isEditingTitle) {
            setEditingTitleText(currentPresentationTitle || '새 프레젠테이션')
        }
    }, [isEditingTitle, currentPresentationTitle])

    const handleTitleSave = () => {
        setIsEditingTitle(false)
        setCurrentPresentationTitle(editingTitleText)
        saveCurrentPresentation() // Autosave to library
    }

    // Use global hotkeys hook
    useHotkeys()

    // Load library on startup
    useEffect(() => {
        loadLibrary()
    }, [loadLibrary])

    // Number keys for quick slide selection (Specific to ControlPanel)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't trigger if typing in input/textarea or modal is open
            const target = e.target as HTMLElement
            if (
                isModalOpen ||
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

    return (
        <div className="h-screen w-screen bg-gray-900 text-gray-100 flex flex-col overflow-hidden">
            <PanelGroup direction="horizontal">
                {/* Left Sidebar */}
                <Panel defaultSize={15} minSize={10} maxSize={30} className="bg-gray-900 flex flex-col">
                    <LeftSidebar />
                </Panel>

                <PanelResizeHandle className="w-1 bg-gray-800 hover:bg-blue-600 transition-colors cursor-col-resize" />

                {/* Main Content */}
                <Panel defaultSize={60} minSize={30} className="bg-gray-800 flex flex-col overflow-hidden">
                    {/* Header */}
                    <header className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700 flex-shrink-0">
                        <div className="flex items-center gap-3">
                            {isEditingTitle ? (
                                <input
                                    autoFocus
                                    className="text-lg font-bold text-blue-400 bg-gray-900 border border-blue-500 rounded px-2 py-0.5 outline-none w-64"
                                    value={editingTitleText}
                                    onChange={(e) => setEditingTitleText(e.target.value)}
                                    onBlur={handleTitleSave}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleTitleSave()
                                        if (e.key === 'Escape') {
                                            setEditingTitleText(currentPresentationTitle || '새 프레젠테이션')
                                            setIsEditingTitle(false)
                                        }
                                    }}
                                />
                            ) : (
                                <h1
                                    className="text-lg font-bold text-blue-400 cursor-text hover:bg-gray-700/50 px-2 py-0.5 rounded -ml-2 transition-colors"
                                    onDoubleClick={() => setIsEditingTitle(true)}
                                    title="더블클릭하여 제목 수정"
                                >
                                    {currentPresentationTitle || '새 프레젠테이션'}
                                </h1>
                            )}
                            <span className="px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded">
                                {slides.length} 슬라이드
                            </span>
                        </div>
                        <div className="text-xs text-gray-500">
                            F1: 텍스트 삭제 · F2: 모두 삭제 · F4: 배경 삭제
                        </div>
                    </header>

                    {/* Slide Grid Area - FULL MIDDLE */}
                    <div className="flex-1 overflow-y-auto min-h-0 bg-gray-800">
                        <SlideGrid />
                    </div>
                </Panel>

                <PanelResizeHandle className="w-1 bg-gray-800 hover:bg-blue-600 transition-colors cursor-col-resize" />

                {/* Right Sidebar */}
                <Panel defaultSize={22} minSize={20} maxSize={50} className="bg-gray-900 flex flex-col">
                    <PreviewPanel />

                    {/* Tab Navigation */}
                    <div className="flex-none flex bg-gray-800 border-b border-gray-700 text-[10px] font-medium uppercase tracking-wider">
                        <button
                            onClick={() => setActiveRightTab('media')}
                            className={`flex-1 py-3 text-center transition-colors border-b-2 ${activeRightTab === 'media' ? 'border-blue-500 text-blue-400 bg-gray-900' : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-700/50'}`}
                        >
                            미디어
                        </button>
                        <button
                            onClick={() => setActiveRightTab('styles')}
                            className={`flex-1 py-3 text-center transition-colors border-b-2 ${activeRightTab === 'styles' ? 'border-blue-500 text-blue-400 bg-gray-900' : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-700/50'}`}
                        >
                            스타일
                        </button>
                        <button
                            onClick={() => setActiveRightTab('layers')}
                            className={`flex-1 py-3 text-center transition-colors border-b-2 ${activeRightTab === 'layers' ? 'border-blue-500 text-blue-400 bg-gray-900' : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-700/50'}`}
                        >
                            레이어
                        </button>
                        <button
                            onClick={() => setActiveRightTab('settings')}
                            className={`flex-1 py-3 text-center transition-colors border-b-2 ${activeRightTab === 'settings' ? 'border-blue-500 text-blue-400 bg-gray-900' : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-700/50'}`}
                        >
                            설정
                        </button>
                    </div>

                    {/* Tab Content */}
                    <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
                        {activeRightTab === 'media' && <MediaBin />}
                        {activeRightTab === 'styles' && <GlobalStylePanel />}
                        {activeRightTab === 'layers' && <AdvancedLayersPanel />}
                        {activeRightTab === 'settings' && <SettingsTabPanel />}
                    </div>

                    <ControlToolbar />
                </Panel>
            </PanelGroup>
        </div>
    )
}

export default ControlPanel
