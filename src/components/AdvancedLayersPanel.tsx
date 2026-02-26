import { useState } from 'react'
import { usePresentationStore } from '../store'
import { generateId } from '../utils/generateId'

const AdvancedLayersPanel: React.FC = () => {
    const { activeProp, activeMessage, setProp, setMessage, clearLayer } = usePresentationStore()

    const [messageText, setMessageText] = useState('')
    const [isScrolling, setIsScrolling] = useState(true)
    const [speed, setSpeed] = useState(15)

    const [propPosition, setPropPosition] = useState<'top-right' | 'top-left' | 'bottom-left' | 'bottom-right' | 'center'>('top-right')

    const handleSendTicker = () => {
        if (!messageText.trim()) return
        setMessage({
            id: generateId(),
            content: messageText,
            isScrolling,
            speed
        })
    }

    const handleClearTicker = () => {
        clearLayer('message')
        setMessageText('')
    }

    const handleSelectLogo = async () => {
        const files = await window.ipcRenderer.selectMediaFiles()
        if (files && files.length > 0) {
            const fileUrl = `file:///${files[0].replace(/\\/g, '/')}`
            setProp({
                id: generateId(),
                type: 'logo',
                url: fileUrl,
                position: propPosition as 'top-right' | 'top-left' | 'bottom-left' | 'bottom-right' | 'center'
            })
        }
    }

    const handleClearLogo = () => {
        clearLayer('prop')
    }

    return (
        <div className="p-4 bg-gray-900 border-t border-gray-800 flex-none flex flex-col gap-4">
            {/* Prop (Logo) Config */}
            <div>
                <div className="flex justify-between items-center mb-2">
                    <h3 className="text-xs font-semibold text-gray-400">교회 로고 (Prop)</h3>
                    {activeProp && (
                        <button onClick={handleClearLogo} className="text-xs text-red-400 hover:text-red-300">지우기</button>
                    )}
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleSelectLogo}
                        className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm py-1.5 px-3 rounded border border-gray-700"
                    >
                        로고 파일 선택
                    </button>
                    <select
                        value={propPosition}
                        onChange={(e) => {
                            const newPos = e.target.value as 'top-right' | 'top-left' | 'bottom-left' | 'bottom-right' | 'center'
                            setPropPosition(newPos)
                            if (activeProp) setProp({ ...activeProp, position: newPos })
                        }}
                        className="bg-gray-800 text-gray-300 text-sm px-2 py-1.5 rounded border border-gray-700"
                    >
                        <option value="top-left">좌상단</option>
                        <option value="top-right">우상단</option>
                        <option value="bottom-left">좌하단</option>
                        <option value="bottom-right">우하단</option>
                    </select>
                </div>
                {activeProp && activeProp.url && (
                    <div className="mt-2 text-xs text-blue-400 truncate">
                        활성화됨: {activeProp.url.split('/').pop()}
                    </div>
                )}
            </div>

            {/* Message (Ticker) Config */}
            <div>
                <div className="flex justify-between items-center mb-2">
                    <h3 className="text-xs font-semibold text-gray-400">하단 자막 (Message)</h3>
                    {activeMessage && (
                        <button onClick={handleClearTicker} className="text-xs text-red-400 hover:text-red-300">지우기</button>
                    )}
                </div>
                <div className="flex gap-2 mb-2">
                    <input
                        type="text"
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSendTicker() }}
                        placeholder="자막 내용을 입력하세요"
                        className="flex-1 bg-gray-800 text-white text-sm px-3 py-1.5 rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                    />
                    <button
                        onClick={handleSendTicker}
                        className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-1.5 rounded"
                    >
                        송출
                    </button>
                </div>
                <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isScrolling}
                            onChange={(e) => setIsScrolling(e.target.checked)}
                            className="bg-gray-800 border-gray-700 rounded text-blue-500 focus:ring-0"
                        />
                        <span className="text-xs text-gray-300">스크롤 애니메이션</span>
                    </label>
                    {isScrolling && (
                        <div className="flex items-center gap-2 flex-1">
                            <span className="text-xs text-gray-400">속도</span>
                            <input
                                type="range"
                                min="5"
                                max="30"
                                value={speed}
                                onChange={(e) => setSpeed(Number(e.target.value))}
                                className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                                style={{ direction: 'rtl' }} // Make moving right slower (higher number = slower)
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default AdvancedLayersPanel
