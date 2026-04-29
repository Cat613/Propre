import { useState } from 'react'
import { usePresentationStore } from '../store'
import { generateId } from '../utils/generateId'

import PositionPickerModal from './PositionPickerModal'
import { useRef, useEffect } from 'react'

const AutoResizeTextarea: React.FC<{
    value: string;
    onChange: (val: string) => void;
    className?: string;
    placeholder?: string;
}> = ({ value, onChange, className, placeholder }) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
        }
    }, [value]);

    return (
        <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={className}
            placeholder={placeholder}
            rows={1}
            style={{ overflow: 'hidden' }}
        />
    );
};

const AdvancedLayersPanel: React.FC = () => {
    const { activeProps, activeMessage, addProp, updateProp, removeProp, setProps, setMessage, clearLayer } = usePresentationStore()

    const [isPickerOpen, setIsPickerOpen] = useState(false)

    const [messageText, setMessageText] = useState('')
    const [isScrolling, setIsScrolling] = useState(true)
    const [speed, setSpeed] = useState(15)


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

    const handleAddImageProp = async () => {
        const files = await window.ipcRenderer.selectMediaFiles()
        if (files && files.length > 0) {
            const fileUrl = `file:///${files[0].replace(/\\/g, '/')}`
            addProp({
                id: generateId(),
                type: 'image',
                url: fileUrl,
                position: 'custom',
                customX: 50,
                customY: 50,
                scale: 1.0
            })
        }
    }

    const handleAddTextProp = () => {
        addProp({
            id: generateId(),
            type: 'text',
            content: '안내 텍스트',
            position: 'custom',
            customX: 50,
            customY: 50,
            scale: 1.0
        })
    }

    const handleClearAllProps = () => {
        clearLayer('prop')
    }

    return (
        <div className="p-4 bg-gray-900 border-t border-gray-800 flex-none flex flex-col gap-4">
            {/* Prop (Logo/Text) Config */}
            <div>
                <div className="flex justify-between items-center mb-2">
                    <h3 className="text-xs font-semibold text-gray-400">고정 안내 (로고/텍스트)</h3>
                    {activeProps.length > 0 && (
                        <button onClick={handleClearAllProps} className="text-xs text-red-400 hover:text-red-300">모두 지우기</button>
                    )}
                </div>
                
                <div className="flex gap-2 mb-3">
                    <button
                        onClick={handleAddImageProp}
                        className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-[11px] py-1.5 px-2 rounded border border-gray-700 flex items-center justify-center gap-1"
                    >
                        <span>+ 이미지</span>
                    </button>
                    <button
                        onClick={handleAddTextProp}
                        className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-[11px] py-1.5 px-2 rounded border border-gray-700 flex items-center justify-center gap-1"
                    >
                        <span>+ 텍스트</span>
                    </button>
                    <button
                        onClick={() => setIsPickerOpen(true)}
                        className="flex-1 bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 text-[11px] py-1.5 px-2 rounded border border-blue-500/30 flex items-center justify-center gap-1"
                    >
                        <span>배치 설정</span>
                    </button>
                </div>

                {/* Active Props List */}
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {activeProps.map(prop => (
                        <div key={prop.id} className="bg-gray-800 rounded p-2 border border-gray-700 flex items-center gap-2">
                            {prop.type === 'text' ? (
                                <AutoResizeTextarea 
                                    value={prop.content || ''} 
                                    onChange={(val) => updateProp(prop.id, { content: val })}
                                    className="flex-1 bg-gray-900 text-xs text-white px-2 py-1 rounded border border-gray-600 focus:border-blue-500 focus:outline-none min-w-0 resize-none"
                                    placeholder="안내 텍스트"
                                />
                            ) : (
                                <div className="flex-1 text-xs text-blue-400 truncate" title={prop.url}>
                                    {prop.url?.split('/').pop()}
                                </div>
                            )}
                            <button onClick={() => removeProp(prop.id)} className="text-gray-500 hover:text-red-400 p-1">
                                ✕
                            </button>
                        </div>
                    ))}
                    {activeProps.length === 0 && (
                        <div className="text-center text-xs text-gray-600 py-2">
                            추가된 고정 안내가 없습니다.
                        </div>
                    )}
                </div>
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

            {isPickerOpen && (
                <PositionPickerModal 
                    initialProps={activeProps}
                    onSave={(newProps) => {
                        setProps(newProps)
                        setIsPickerOpen(false)
                    }}
                    onClose={() => setIsPickerOpen(false)}
                />
            )}
        </div>
    )
}

export default AdvancedLayersPanel
