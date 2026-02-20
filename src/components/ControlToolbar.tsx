import { useEffect, useState } from 'react'
import { usePresentationStore } from '../store'
import type { Slide } from '../types'
import AudioPlayer from './AudioPlayer'

interface DisplayInfo {
    id: number
    label: string
    bounds: { x: number, y: number, width: number, height: number }
}

const ControlToolbar: React.FC = () => {
    const {
        addSlide,
        saveCurrentPresentation,
        clearBackground,
        clearText,
        clearAll,
        toggleStage,
        isStageEnabled
    } = usePresentationStore()

    const [displays, setDisplays] = useState<DisplayInfo[]>([])
    const [outputDisplay, setOutputDisplay] = useState<number | ''>('')
    const [stageDisplay, setStageDisplay] = useState<number | ''>('')

    useEffect(() => {
        const fetchDisplays = async () => {
            if (window.ipcRenderer.getDisplays) {
                const list = await window.ipcRenderer.getDisplays()
                setDisplays(list)

                const active = await window.ipcRenderer.getActiveDisplays()
                if (active.output) setOutputDisplay(active.output)
                if (active.stage) setStageDisplay(active.stage)
            }
        }
        fetchDisplays()
    }, [])

    const handleOutputDisplayChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = Number(e.target.value)
        setOutputDisplay(val)
        await window.ipcRenderer.setOutputDisplay(val)
    }

    const handleStageDisplayChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = Number(e.target.value)
        setStageDisplay(val)
        await window.ipcRenderer.setStageDisplay(val)
    }

    const handleNewSlide = () => {
        const newSlide: Slide = {
            id: crypto.randomUUID(),
            content: '텍스트를 입력하세요',
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
                const extension = filePath.split('.').pop()?.toLowerCase() || ''
                const videoExtensions = ['mp4', 'mov', 'webm']

                let type: Slide['type'] = 'image'
                if (videoExtensions.includes(extension)) {
                    type = 'video'
                }

                const newSlide: Slide = {
                    id: crypto.randomUUID(),
                    content: '',
                    type,
                    backgroundUrl: `file://${filePath}`,
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
            console.error('Failed to select media files:', error)
        }
    }

    const handleSaveToLibrary = async () => {
        await saveCurrentPresentation()
        console.log('Saved to library')
    }

    // --- Clear Actions ---
    const handleClearAll = () => clearAll()
    const handleClearBackground = () => clearBackground()
    const handleClearText = () => clearText()

    // --- Stage Action ---
    const handleToggleStage = () => toggleStage()

    return (
        <div className="p-4 border-t border-gray-800 flex flex-col gap-3">
            {/* Top Row: File Ops & Audio */}
            <div className="flex items-center gap-2">
                {/* Save Button */}
                <button
                    onClick={handleSaveToLibrary}
                    className="px-3 py-2 rounded-lg bg-blue-900/50 hover:bg-blue-800 border border-blue-700/50 transition-all text-blue-100 hover:text-white flex items-center gap-2"
                    title="라이브러리에 저장"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                    </svg>
                    <span className="text-xs font-semibold">저장</span>
                </button>

                {/* Stage Button !!! */}
                <button
                    onClick={handleToggleStage}
                    className={`px-3 py-2 rounded-lg border transition-all flex items-center gap-2 ${isStageEnabled
                        ? 'bg-green-700 hover:bg-green-600 border-green-500 text-white'
                        : 'bg-gray-800 hover:bg-gray-700 border-gray-600 text-gray-400'
                        }`}
                    title="스테이지 디스플레이 토글"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs font-semibold">Stage</span>
                </button>

                {/* Audio Player (Compact) */}
                <div className="flex-1 min-w-0">
                    <AudioPlayer />
                </div>
            </div>

            {/* Middle Row: Slide Creation */}
            <div className="flex gap-2">
                <button
                    onClick={handleNewSlide}
                    className="flex-1 flex items-center justify-center gap-2 p-3 rounded-lg bg-green-600 hover:bg-green-700 transition-all text-white font-medium"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span>새 슬라이드</span>
                </button>
                <button
                    onClick={handleAddMedia}
                    className="flex-1 flex items-center justify-center gap-2 p-3 rounded-lg bg-blue-600 hover:bg-blue-700 transition-all text-white font-medium"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span>미디어</span>
                </button>
            </div>

            {/* Middle Row 2: Display Selection */}
            {displays.length > 0 && (
                <div className="flex flex-col gap-1 p-2 bg-gray-800 rounded border border-gray-700">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">Output 모니터:</span>
                        <select
                            className="bg-gray-700 text-white rounded px-1 min-w-[100px] py-0.5 outline-none"
                            value={outputDisplay}
                            onChange={handleOutputDisplayChange}
                        >
                            <option value="">자동 설정</option>
                            {displays.map(d => (
                                <option key={d.id} value={d.id}>{d.label} ({d.bounds.width}x{d.bounds.height})</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">Stage 모니터:</span>
                        <select
                            className="bg-gray-700 text-white rounded px-1 min-w-[100px] py-0.5 outline-none"
                            value={stageDisplay}
                            onChange={handleStageDisplayChange}
                        >
                            <option value="">자동 설정</option>
                            {displays.map(d => (
                                <option key={d.id} value={d.id}>{d.label} ({d.bounds.width}x{d.bounds.height})</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            {/* Bottom Row: Output Control (Clear Buttons) */}
            <div className="grid grid-cols-3 gap-2">
                {/* Clear Text (F1) */}
                <button
                    onClick={handleClearText}
                    className="flex flex-col items-center justify-center gap-1 p-3 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 transition-all group"
                >
                    <svg className="w-5 h-5 text-gray-400 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                    <span className="text-xs text-gray-300">Clear Slide</span>
                    <span className="text-[10px] text-gray-500">F1</span>
                </button>

                {/* Clear All (F2) */}
                <button
                    onClick={handleClearAll}
                    className="flex flex-col items-center justify-center gap-1 p-3 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 transition-all group"
                >
                    <svg className="w-5 h-5 text-red-400 group-hover:text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span className="text-xs text-gray-300">Clear All</span>
                    <span className="text-[10px] text-gray-500">F2</span>
                </button>

                {/* Clear Background (F4) */}
                <button
                    onClick={handleClearBackground}
                    className="flex flex-col items-center justify-center gap-1 p-3 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-gray-600 transition-all group"
                >
                    <svg className="w-5 h-5 text-blue-400 group-hover:text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs text-gray-300">Clear BG</span>
                    <span className="text-[10px] text-gray-500">F4</span>
                </button>
            </div>
        </div>
    )
}

export default ControlToolbar
