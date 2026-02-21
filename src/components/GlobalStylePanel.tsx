import React from 'react'
import { usePresentationStore } from '../store'

const GlobalStylePanel: React.FC = () => {
    const { globalSlideStyle, updateGlobalSlideStyle } = usePresentationStore()

    const handleAlignChange = (align: 'left' | 'center' | 'right') => {
        updateGlobalSlideStyle({ align })
    }

    const handleVAlignChange = (verticalAlign: 'top' | 'center' | 'bottom') => {
        updateGlobalSlideStyle({ verticalAlign })
    }

    return (
        <div className="p-4 border-b border-gray-800 bg-gray-900">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                일반 텍스트 전역 스타일
            </h3>

            <div className="space-y-3">
                {/* Font Size & Color */}
                <div className="flex gap-2">
                    <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">크기</label>
                        <input
                            type="number"
                            value={globalSlideStyle.fontSize}
                            onChange={(e) => updateGlobalSlideStyle({ fontSize: Number(e.target.value) })}
                            className="w-full bg-gray-800 text-white rounded px-2 py-1 text-sm border border-gray-700 focus:border-blue-500"
                        />
                    </div>
                    <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">색상</label>
                        <div className="flex gap-2">
                            <input
                                type="color"
                                value={globalSlideStyle.fontColor}
                                onChange={(e) => updateGlobalSlideStyle({ fontColor: e.target.value })}
                                className="h-7 w-8 rounded cursor-pointer bg-transparent border-none p-0"
                            />
                            <input
                                type="text"
                                value={globalSlideStyle.fontColor}
                                onChange={(e) => updateGlobalSlideStyle({ fontColor: e.target.value })}
                                className="w-full bg-gray-800 text-white rounded px-2 py-1 text-sm border border-gray-700"
                            />
                        </div>
                    </div>
                </div>

                {/* Font Family */}
                <div>
                    <label className="block text-xs text-gray-500 mb-1">글꼴 (Font Family)</label>
                    <select
                        value={globalSlideStyle.fontFamily}
                        onChange={(e) => updateGlobalSlideStyle({ fontFamily: e.target.value })}
                        className="w-full bg-gray-800 text-white rounded px-2 py-1 text-sm border border-gray-700 outline-none"
                    >
                        <option value="sans-serif">Sans Serif</option>
                        <option value="serif">Serif</option>
                        <option value="monospace">Monospace</option>
                        <option value="'Nanum Gothic', sans-serif">나눔고딕 (Nanum Gothic)</option>
                        <option value="'Malgun Gothic', sans-serif">맑은 고딕 (Malgun Gothic)</option>
                    </select>
                </div>

                {/* Alignment */}
                <div className="flex gap-4">
                    <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">가로 정렬</label>
                        <div className="flex bg-gray-800 rounded p-0.5 border border-gray-700">
                            {(['left', 'center', 'right'] as const).map((align) => (
                                <button
                                    key={align}
                                    onClick={() => handleAlignChange(align)}
                                    className={`flex-1 p-1 rounded text-xs transition-colors ${globalSlideStyle.align === align
                                        ? 'bg-blue-600 text-white'
                                        : 'text-gray-400 hover:text-white hover:bg-gray-700'
                                        }`}
                                >
                                    {align === 'left' ? '⬅️' : align === 'center' ? '↔️' : '➡️'}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">세로 정렬</label>
                        <div className="flex bg-gray-800 rounded p-0.5 border border-gray-700">
                            {(['top', 'center', 'bottom'] as const).map((valign) => (
                                <button
                                    key={valign}
                                    onClick={() => handleVAlignChange(valign)}
                                    className={`flex-1 p-1 rounded text-xs transition-colors ${globalSlideStyle.verticalAlign === valign
                                        ? 'bg-blue-600 text-white'
                                        : 'text-gray-400 hover:text-white hover:bg-gray-700'
                                        }`}
                                >
                                    {valign === 'top' ? '⬆️' : valign === 'center' ? '↕️' : '⬇️'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Background Dimming */}
                <div>
                    <div className="flex items-center justify-between mb-1 text-xs text-gray-500">
                        <label>배경 어둡기 (전역)</label>
                        <span>{Math.round((globalSlideStyle.backgroundDim || 0) * 100)}%</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={globalSlideStyle.backgroundDim || 0}
                        onChange={(e) => updateGlobalSlideStyle({ backgroundDim: parseFloat(e.target.value) })}
                        className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                </div>
            </div>
        </div>
    )
}

export default GlobalStylePanel
