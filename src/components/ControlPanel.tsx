import { useEffect, useState } from 'react'
import LeftSidebar from './LeftSidebar'
import SlideGrid from './SlideGrid'
import PreviewPanel from './PreviewPanel'
import GlobalStylePanel from './GlobalStylePanel'
import AdvancedLayersPanel from './AdvancedLayersPanel'
import ControlToolbar from './ControlToolbar'
import MediaBin from './MediaBin'
import { usePresentationStore } from '../store'
import { useHotkeys } from '../hooks/useHotkeys'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

const ControlPanel: React.FC = () => {
    const { slides, setActiveSlide, loadLibrary, clearText, clearAll, clearBackground } = usePresentationStore()
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)

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
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable ||
                isEditModalOpen
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
    }, [slides, isEditModalOpen, setActiveSlide, clearText, clearAll, clearBackground])

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
                            <h1 className="text-lg font-bold text-blue-400">프레젠테이션</h1>
                            <span className="px-2 py-0.5 text-xs bg-gray-700 text-gray-300 rounded">
                                {slides.length} 슬라이드
                            </span>
                        </div>
                        <div className="text-xs text-gray-500">
                            F1: 텍스트 삭제 · F2: 모두 삭제 · F4: 배경 삭제
                        </div>
                    </header>

                    <PanelGroup direction="vertical">
                        {/* Slide Grid Area */}
                        <Panel defaultSize={70} minSize={30} className="flex flex-col bg-gray-800">
                            <div className="flex-1 overflow-y-auto min-h-0">
                                <SlideGrid onEditModalChange={setIsEditModalOpen} />
                            </div>
                        </Panel>

                        <PanelResizeHandle className="h-1 bg-gray-700 hover:bg-blue-600 transition-colors cursor-row-resize flex items-center justify-center">
                            <div className="w-8 h-0.5 bg-gray-500 rounded-full my-0.5" />
                        </PanelResizeHandle>

                        {/* Media Bin */}
                        <Panel defaultSize={30} minSize={15} className="flex flex-col bg-gray-900">
                            <div className="flex-1 overflow-hidden">
                                <MediaBin />
                            </div>
                        </Panel>
                    </PanelGroup>
                </Panel>

                <PanelResizeHandle className="w-1 bg-gray-800 hover:bg-blue-600 transition-colors cursor-col-resize" />

                {/* Right Sidebar */}
                <Panel defaultSize={25} minSize={20} maxSize={50} className="bg-gray-900 flex flex-col">
                    <div className="flex-1 overflow-y-auto flex flex-col">
                        <PreviewPanel />
                        <GlobalStylePanel />
                        <AdvancedLayersPanel />
                    </div>
                    <ControlToolbar />
                </Panel>
            </PanelGroup>
        </div>
    )
}

export default ControlPanel
