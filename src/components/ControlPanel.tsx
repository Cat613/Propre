import { useEffect, useState } from 'react'
import LeftSidebar from './LeftSidebar'
import SlideGrid from './SlideGrid'
import PreviewPanel from './PreviewPanel'
import ControlToolbar from './ControlToolbar'
import MediaBin from './MediaBin'
import { usePresentationStore } from '../store'
import { useHotkeys } from '../hooks/useHotkeys'

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
        <div className="flex h-screen bg-gray-900 text-gray-100">
            {/* Left Sidebar */}
            <aside className="w-64 bg-gray-900 border-r border-gray-800 flex-shrink-0">
                <LeftSidebar />
            </aside>

            {/* Main Content */}
            <main className="flex-1 bg-gray-800 overflow-hidden flex flex-col">
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

                {/* Slide Grid Area (Flexible height) */}
                <div className="flex-1 overflow-y-auto min-h-0">
                    <SlideGrid onEditModalChange={setIsEditModalOpen} />
                </div>

                {/* Media Bin (Fixed height) */}
                <div className="flex-shrink-0">
                    <MediaBin />
                </div>
            </main>

            {/* Right Sidebar */}
            <aside className="w-80 bg-gray-900 border-l border-gray-800 flex-shrink-0 flex flex-col">
                <div className="flex-1 overflow-y-auto">
                    <PreviewPanel />
                </div>
                <ControlToolbar />
            </aside>
        </div>
    )
}

export default ControlPanel
