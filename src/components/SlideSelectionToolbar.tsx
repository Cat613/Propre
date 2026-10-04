import React, { useState } from 'react'
import { usePresentationStore } from '../store'
import { LABEL_COLORS, PRESET_LABELS, PRESET_COLORS } from '../types'

const SlideSelectionToolbar: React.FC = () => {
    const {
        selectedSlideIds,
        setSelectedSlideIds,
        copiedSlides,
        batchUpdateSlides,
        batchDeleteSlides,
        copySelectedSlides,
        pasteSlides
    } = usePresentationStore()

    const [customLabelText, setCustomLabelText] = useState('')
    const [isCopiedTip, setIsCopiedTip] = useState(false)

    if (!selectedSlideIds || selectedSlideIds.length === 0) return null

    const handleApplyPresetLabel = (label: string) => {
        if (label === 'None') {
            batchUpdateSlides(selectedSlideIds, {
                label: 'None',
                labelColor: 'transparent',
                borderColor: 'transparent'
            })
            return
        }

        const defaultColor = LABEL_COLORS[label] || '#3B82F6'
        batchUpdateSlides(selectedSlideIds, {
            label: label,
            labelColor: defaultColor,
            borderColor: defaultColor
        })
    }

    const handleApplyCustomLabel = () => {
        if (!customLabelText.trim()) return
        const currentLabel = customLabelText.trim()
        const color = LABEL_COLORS[currentLabel] || '#3B82F6'
        batchUpdateSlides(selectedSlideIds, {
            label: currentLabel,
            labelColor: color,
            borderColor: color
        })
        setCustomLabelText('')
    }

    const handleApplyColor = (colorHex: string) => {
        batchUpdateSlides(selectedSlideIds, {
            labelColor: colorHex,
            borderColor: colorHex
        })
    }

    const handleCopy = () => {
        copySelectedSlides()
        setIsCopiedTip(true)
        setTimeout(() => setIsCopiedTip(false), 2000)
    }

    return (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 bg-gray-900/95 backdrop-blur-md border border-gray-700/80 shadow-2xl rounded-2xl p-2.5 px-5 flex flex-wrap items-center gap-4 text-white transition-all duration-300 max-w-[95%] overflow-x-auto border-t border-t-gray-600/50">
            
            {/* 1. Selection Count & Clear Selection */}
            <div className="flex items-center gap-2 pr-3 border-r border-gray-700/80 flex-shrink-0">
                <span className="flex items-center justify-center bg-blue-600 font-bold text-xs px-2.5 py-1 rounded-full shadow-inner text-white">
                    {selectedSlideIds.length}개 선택됨
                </span>
                <button
                    onClick={() => setSelectedSlideIds([])}
                    className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition-colors"
                    title="선택 해제 (ESC)"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {/* 2. Quick Labels Section */}
            <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-gray-400 font-semibold mr-1">영역:</span>
                {PRESET_LABELS.map((opt) => {
                    const color = LABEL_COLORS[opt] || 'transparent'
                    const isNone = opt === 'None'
                    return (
                        <button
                            key={opt}
                            onClick={() => handleApplyPresetLabel(opt)}
                            className="px-2.5 py-1 text-xs font-semibold rounded-lg transition-transform active:scale-95 hover:brightness-125 shadow-sm border"
                            style={{
                                backgroundColor: isNone ? '#374151' : color,
                                borderColor: isNone ? '#4B5563' : color,
                                color: '#ffffff',
                            }}
                            title={`'${opt === 'None' ? '라벨 없음' : opt}' 영역으로 변경`}
                        >
                            {opt === 'None' ? '✕ 없음' : opt}
                        </button>
                    )
                })}

                {/* Custom Label Input */}
                <div className="flex items-center ml-1 bg-gray-800/80 border border-gray-600 rounded-lg overflow-hidden focus-within:border-blue-500">
                    <input
                        type="text"
                        placeholder="직접 입력..."
                        value={customLabelText}
                        onChange={(e) => setCustomLabelText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing || e.keyCode === 229) return
                            if (e.key === 'Enter') {
                                e.preventDefault()
                                handleApplyCustomLabel()
                            }
                        }}
                        className="bg-transparent text-xs text-white px-2 py-1 w-20 outline-none placeholder-gray-500"
                    />
                    <button
                        onClick={handleApplyCustomLabel}
                        className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold transition-colors"
                        title="적용"
                    >
                        +
                    </button>
                </div>
            </div>

            {/* 3. Border & Label Color Picker Section */}
            <div className="flex items-center gap-1.5 pl-3 border-l border-gray-700/80">
                <span className="text-xs text-gray-400 font-semibold mr-1">테두리/색상:</span>
                {PRESET_COLORS.map((item) => (
                    <button
                        key={item.name}
                        onClick={() => handleApplyColor(item.color)}
                        className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 active:scale-95 shadow-sm ${
                            item.color === 'transparent' ? 'bg-gray-800 border-gray-500 flex items-center justify-center' : ''
                        }`}
                        style={{
                            backgroundColor: item.color !== 'transparent' ? item.color : 'transparent',
                            borderColor: item.color !== 'transparent' ? '#ffffff40' : undefined
                        }}
                        title={item.name}
                    >
                        {item.color === 'transparent' && (
                            <span className="text-[10px] text-gray-400">✕</span>
                        )}
                    </button>
                ))}
                {/* Custom Hex Color Picker */}
                <label
                    className="w-6 h-6 rounded-full border-2 border-white/50 bg-gradient-to-tr from-pink-500 via-blue-500 to-amber-500 cursor-pointer transition-transform hover:scale-110 active:scale-95 flex items-center justify-center shadow-sm relative overflow-hidden"
                    title="커스텀 색상 선택"
                >
                    <input
                        type="color"
                        onChange={(e) => handleApplyColor(e.target.value)}
                        className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                    />
                </label>
            </div>

            {/* 4. Action Operations: Copy, Paste, Delete */}
            <div className="flex items-center gap-2 pl-3 border-l border-gray-700/80">
                <button
                    onClick={handleCopy}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm border ${
                        isCopiedTip
                            ? 'bg-green-600/90 border-green-500 text-white'
                            : 'bg-gray-800 hover:bg-gray-700 border-gray-600 text-gray-200'
                    }`}
                    title="선택된 슬라이드 복사 (Cmd+C)"
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    {isCopiedTip ? '복사됨!' : '복사'}
                </button>
                <button
                    onClick={pasteSlides}
                    disabled={!copiedSlides || copiedSlides.length === 0}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 border border-blue-500 text-white transition-colors flex items-center gap-1 shadow-sm"
                    title="선택된 슬라이드 뒤에 붙여넣기 (Cmd+V)"
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    붙여넣기 {copiedSlides.length > 0 && `(${copiedSlides.length})`}
                </button>
                <button
                    onClick={() => batchDeleteSlides(selectedSlideIds)}
                    className="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-red-500/20 hover:bg-red-600 border border-red-500/30 hover:border-red-500 text-red-300 hover:text-white transition-colors flex items-center gap-1 shadow-sm ml-1"
                    title="선택된 슬라이드 일괄 삭제 (Del / Backspace)"
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    삭제
                </button>
            </div>
        </div>
    )
}

export default SlideSelectionToolbar
