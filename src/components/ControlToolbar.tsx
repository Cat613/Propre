import { useEffect, useState } from 'react'
import { usePresentationStore } from '../store'
import AudioPlayer from './AudioPlayer'
import BulkEditModal from './BulkEditModal'
import SettingsModal from './SettingsModal'
import ToolbarActions from './ToolbarActions'
import DisplaySelect from './DisplaySelect'

interface DisplayInfo {
    id: number
    label: string
    bounds: { x: number, y: number, width: number, height: number }
}

const ControlToolbar: React.FC = () => {
    const { toggleStage, isStageEnabled, toggleOutput, isOutputEnabled } = usePresentationStore()

    const [displays, setDisplays] = useState<DisplayInfo[]>([])
    const [outputDisplay, setOutputDisplay] = useState<number | ''>('')
    const [stageDisplay, setStageDisplay] = useState<number | ''>('')

    // Modals state
    const [isBulkEditOpen, setIsBulkEditOpen] = useState(false)
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)
    const [initialBulkText, setInitialBulkText] = useState<string | undefined>(undefined)

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

    const handleOpenBulkEdit = (initialText?: string) => {
        if (initialText) setInitialBulkText(initialText)
        setIsBulkEditOpen(true)
    }

    return (
        <div className="bg-gray-800 border-b border-gray-700 p-2 flex flex-wrap items-center justify-between gap-y-3 gap-x-2 shadow-sm">
            {/* Left: Toolbar Actions (Clear, Add, AI) */}
            <ToolbarActions
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenBulkEdit={handleOpenBulkEdit}
            />

            {/* Right: Audio Player, Stage Toggle, Screen Select, Settings */}
            <div className="flex flex-wrap items-center gap-3">
                <AudioPlayer />

                <div className="w-px h-6 bg-gray-700 mx-1" />

                <button
                    onClick={toggleOutput}
                    className={`px-3 py-1.5 text-xs font-semibold border rounded-lg transition-colors flex items-center gap-1.5 shadow-sm
                        ${isOutputEnabled
                            ? 'bg-blue-600/20 text-blue-400 border-blue-500/50 hover:bg-blue-600/30'
                            : 'bg-gray-900/40 text-gray-400 border-gray-700/50 hover:text-gray-200 hover:bg-gray-800'
                        }
                    `}
                    title="메인 화면(Output Display) 켜기/끄기"
                >
                    <div className={`w-2 h-2 rounded-full ${isOutputEnabled ? 'bg-blue-400 animate-pulse shadow-[0_0_8px_rgba(96,165,250,0.6)]' : 'bg-gray-600'}`} />
                    메인 화면 송출
                </button>

                <button
                    onClick={toggleStage}
                    className={`px-3 py-1.5 text-xs font-semibold border rounded-lg transition-colors flex items-center gap-1.5 shadow-sm
                        ${isStageEnabled
                            ? 'bg-purple-600/20 text-purple-400 border-purple-500/50 hover:bg-purple-600/30'
                            : 'bg-gray-900/40 text-gray-400 border-gray-700/50 hover:text-gray-200 hover:bg-gray-800'
                        }
                    `}
                    title="무대 모니터(Stage Display) 활성화"
                >
                    <div className={`w-2 h-2 rounded-full ${isStageEnabled ? 'bg-purple-400 animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.6)]' : 'bg-gray-600'}`} />
                    무대 화면 송출
                </button>

                <div className="w-px h-6 bg-gray-700 mx-1" />

                <DisplaySelect
                    displays={displays}
                    outputDisplay={outputDisplay}
                    stageDisplay={stageDisplay}
                    onOutputChange={handleOutputDisplayChange}
                    onStageChange={handleStageDisplayChange}
                />

                <div className="w-px h-6 bg-gray-700 mx-1" />

                <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors shadow-sm"
                    title="설정"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                </button>
            </div>

            <BulkEditModal
                isOpen={isBulkEditOpen}
                onClose={() => {
                    setIsBulkEditOpen(false)
                    setInitialBulkText(undefined)
                }}
                initialTextOverride={initialBulkText}
            />

            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />
        </div>
    )
}

export default ControlToolbar
