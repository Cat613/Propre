import React, { useEffect, useState } from 'react'
import { usePresentationStore } from '../store'
import DisplaySelect from './DisplaySelect'
import SettingsModal from './SettingsModal'

interface DisplayInfo {
    id: number
    label: string
    bounds: { x: number, y: number, width: number, height: number }
}

const SettingsTabPanel: React.FC = () => {
    const {
        toggleStage, isStageEnabled, toggleOutput, isOutputEnabled, isGreenScreen, toggleGreenScreen,
        globalStylePresets, defaultSongPresetId, defaultBiblePresetId, setDefaultPreset, deleteGlobalStylePreset
    } = usePresentationStore()

    const [displays, setDisplays] = useState<DisplayInfo[]>([])
    const [outputDisplay, setOutputDisplay] = useState<number | ''>('')
    const [stageDisplay, setStageDisplay] = useState<number | ''>('')
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)

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
        if (window.ipcRenderer.setOutputDisplay) {
            await window.ipcRenderer.setOutputDisplay(val)
        }
    }

    const handleStageDisplayChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = Number(e.target.value)
        setStageDisplay(val)
        if (window.ipcRenderer.setStageDisplay) {
            await window.ipcRenderer.setStageDisplay(val)
        }
    }

    return (
        <div className="p-4 bg-gray-900 border-t border-gray-800 flex flex-col gap-6">

            {/* Global Style Presets */}
            <div>
                <h3 className="text-xs font-semibold text-gray-400 mb-3">글로벌 스타일 자동 적용 (Presets)</h3>
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">일반/찬양 기본 프리셋:</span>
                        <select
                            value={defaultSongPresetId || ''}
                            onChange={(e) => setDefaultPreset('song', e.target.value || null)}
                            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200 focus:border-blue-500 w-32"
                        >
                            <option value="">선택 안함</option>
                            {globalStylePresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">성경(Bible) 기본 프리셋:</span>
                        <select
                            value={defaultBiblePresetId || ''}
                            onChange={(e) => setDefaultPreset('bible', e.target.value || null)}
                            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200 focus:border-blue-500 w-32"
                        >
                            <option value="">선택 안함</option>
                            {globalStylePresets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    {globalStylePresets.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-gray-800">
                            <h4 className="text-[10px] text-gray-500 mb-2">저장된 프리셋 관리</h4>
                            <div className="flex flex-wrap gap-2">
                                {globalStylePresets.map(p => (
                                    <div key={p.id} className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-300">
                                        <span>{p.name}</span>
                                        <button onClick={() => deleteGlobalStylePreset(p.id)} className="text-red-400 hover:text-red-300 ml-1 font-bold">×</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <hr className="border-gray-800" />

            {/* Display Setup */}
            <div>
                <h3 className="text-xs font-semibold text-gray-400 mb-3">모니터 장치 (Displays)</h3>
                <DisplaySelect
                    displays={displays}
                    outputDisplay={outputDisplay}
                    stageDisplay={stageDisplay}
                    onOutputChange={handleOutputDisplayChange}
                    onStageChange={handleStageDisplayChange}
                />
            </div>

            <hr className="border-gray-800" />

            {/* View Toggles */}
            <div>
                <h3 className="text-xs font-semibold text-gray-400 mb-3">화면 송출 설정 (Output)</h3>
                <div className="flex flex-col gap-2">
                    <button
                        onClick={toggleOutput}
                        className={`px-3 py-2 text-sm font-semibold border rounded-lg transition-colors flex items-center justify-between shadow-sm
                            ${isOutputEnabled
                                ? 'bg-blue-600/20 text-blue-400 border-blue-500/50 hover:bg-blue-600/30'
                                : 'bg-gray-900/40 text-gray-400 border-gray-700/50 hover:text-gray-200 hover:bg-gray-800'
                            }
                        `}
                    >
                        메인 화면 출력 (Output)
                        <div className={`w-2.5 h-2.5 rounded-full ${isOutputEnabled ? 'bg-blue-400 animate-pulse shadow-[0_0_8px_rgba(96,165,250,0.6)]' : 'bg-gray-600'}`} />
                    </button>

                    <button
                        onClick={toggleStage}
                        className={`px-3 py-2 text-sm font-semibold border rounded-lg transition-colors flex items-center justify-between shadow-sm
                            ${isStageEnabled
                                ? 'bg-purple-600/20 text-purple-400 border-purple-500/50 hover:bg-purple-600/30'
                                : 'bg-gray-900/40 text-gray-400 border-gray-700/50 hover:text-gray-200 hover:bg-gray-800'
                            }
                        `}
                    >
                        무대 모니터 출력 (Stage)
                        <div className={`w-2.5 h-2.5 rounded-full ${isStageEnabled ? 'bg-purple-400 animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.6)]' : 'bg-gray-600'}`} />
                    </button>

                    <button
                        onClick={toggleGreenScreen}
                        className={`px-3 py-2 text-sm font-semibold border rounded-lg transition-colors flex items-center justify-between shadow-sm
                            ${isGreenScreen
                                ? 'bg-green-600/20 text-green-400 border-green-500/50 hover:bg-green-600/30'
                                : 'bg-gray-900/40 text-gray-400 border-gray-700/50 hover:text-gray-200 hover:bg-gray-800'
                            }
                        `}
                    >
                        크로마키 모드 (GreenScreen)
                        <div className={`w-2.5 h-2.5 rounded-full ${isGreenScreen ? 'bg-green-400 animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.6)]' : 'bg-gray-600'}`} />
                    </button>
                </div>
            </div>

            <hr className="border-gray-800" />

            {/* Advanced Settings */}
            <div>
                <h3 className="text-xs font-semibold text-gray-400 mb-2">고급 환경 설정 (Advanced)</h3>
                <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="w-full px-3 py-2 text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors shadow-sm flex justify-center items-center gap-2"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    시스템 환경 설정 열기
                </button>
            </div>

            {/* Keep Modal inside this component */}
            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />
        </div>
    )
}

export default SettingsTabPanel
