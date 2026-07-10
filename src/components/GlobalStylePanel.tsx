import React, { useState } from 'react'
import { usePresentationStore } from '../store'

const GlobalStylePanel: React.FC = () => {
    const { globalSlideStyle, updateGlobalSlideStyle, globalStylePresets, addGlobalStylePreset, deleteGlobalStylePreset, addToast, activePresetId, setActivePresetId } = usePresentationStore()
    const [isSaving, setIsSaving] = useState(false)
    const [newPresetName, setNewPresetName] = useState('')

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

            <div className="mb-4 bg-gray-800 p-2 rounded-lg border border-gray-700">
                {isSaving ? (
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={newPresetName}
                            onChange={(e) => setNewPresetName(e.target.value)}
                            placeholder="프리셋 이름"
                            className="flex-1 bg-gray-900 text-xs border border-gray-700 rounded px-2 py-1.5 focus:border-blue-500 text-gray-300 min-w-0"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && newPresetName.trim()) {
                                    const newId = 'preset-' + Date.now()
                                    addGlobalStylePreset({
                                        id: newId,
                                        name: newPresetName.trim(),
                                        style: globalSlideStyle
                                    })
                                    setActivePresetId(newId)
                                    setIsSaving(false)
                                    setNewPresetName('')
                                } else if (e.key === 'Escape') {
                                    setIsSaving(false)
                                    setNewPresetName('')
                                }
                            }}
                        />
                        <button
                            onClick={() => {
                                if (newPresetName.trim()) {
                                    const newId = 'preset-' + Date.now()
                                    addGlobalStylePreset({
                                        id: newId,
                                        name: newPresetName.trim(),
                                        style: globalSlideStyle
                                    })
                                    setActivePresetId(newId)
                                    setIsSaving(false)
                                    setNewPresetName('')
                                }
                            }}
                            className="px-2 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-[10px] transition-colors flex-none"
                        >
                            저장
                        </button>
                        <button
                            onClick={() => { setIsSaving(false); setNewPresetName(''); }}
                            className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded text-[10px] transition-colors flex-none"
                        >
                            취소
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center justify-between gap-2">
                        <select
                            value={activePresetId || ''}
                            className="flex-1 bg-gray-900 text-xs border border-gray-700 rounded px-2 py-1.5 focus:border-blue-500 text-gray-300 min-w-0"
                            onChange={(e) => {
                                const val = e.target.value
                                if (val) {
                                    const preset = globalStylePresets.find(p => p.id === val)
                                    if (preset) updateGlobalSlideStyle(preset.style, preset.id)
                                } else {
                                    setActivePresetId(null)
                                }
                            }}
                        >
                            <option value="">-- 프리셋 선택 --</option>
                            {globalStylePresets.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>

                        {activePresetId && (
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => {
                                        const preset = globalStylePresets.find(p => p.id === activePresetId)
                                        if (preset) {
                                            addGlobalStylePreset({
                                                id: preset.id,
                                                name: preset.name,
                                                style: globalSlideStyle
                                            })
                                            addToast(`${preset.name} 프리셋이 덮어쓰기 되었습니다.`, 'info')
                                        }
                                    }}
                                    className="px-2 py-1.5 bg-green-600/20 text-green-400 hover:bg-green-600/40 rounded text-[10px] border border-green-500/30 transition-colors whitespace-nowrap flex-none"
                                    title="선택한 프리셋으로 현재 설정 덮어쓰기"
                                >
                                    업데이트
                                </button>
                                <button
                                    onClick={() => {
                                        deleteGlobalStylePreset(activePresetId)
                                        setActivePresetId(null)
                                        addToast('프리셋이 삭제되었습니다.', 'info')
                                    }}
                                    className="px-2 py-1.5 bg-red-600/20 text-red-400 hover:bg-red-600/40 rounded text-[10px] border border-red-500/30 transition-colors whitespace-nowrap flex-none"
                                    title="선택한 프리셋 삭제"
                                >
                                    삭제
                                </button>
                            </div>
                        )}

                        <button
                            onClick={() => {
                                setNewPresetName('')
                                setIsSaving(true)
                            }}
                            className="px-2 py-1.5 bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 rounded text-[10px] border border-blue-500/30 transition-colors whitespace-nowrap flex-none"
                        >
                            + 현재 저장
                        </button>
                    </div>
                )}
            </div>

            <div className="space-y-3">
                {/* Font Size & Color */}
                <div className="flex gap-2">
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-1 text-xs text-gray-500">
                            <label>크기</label>
                            <input
                                type="number"
                                value={globalSlideStyle.fontSize}
                                onChange={(e) => updateGlobalSlideStyle({ fontSize: Number(e.target.value) })}
                                className="w-14 bg-gray-800 text-white rounded px-1 text-xs border border-gray-700 text-right"
                            />
                        </div>
                        <input
                            type="range"
                            min="10"
                            max="200"
                            step="1"
                            value={globalSlideStyle.fontSize}
                            onChange={(e) => updateGlobalSlideStyle({ fontSize: parseInt(e.target.value) })}
                            className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            draggable={false}
                            onDragStart={(e) => e.preventDefault()}
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

                {/* Line Height */}
                <div>
                    <div className="flex items-center justify-between mb-1 text-xs text-gray-500">
                        <label>줄 간격 (Line Height)</label>
                        <span>{globalSlideStyle.lineHeight ?? 1.4}</span>
                    </div>
                    <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.1"
                        value={globalSlideStyle.lineHeight ?? 1.4}
                        onChange={(e) => updateGlobalSlideStyle({ lineHeight: parseFloat(e.target.value) })}
                        className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        draggable={false}
                        onDragStart={(e) => e.preventDefault()}
                    />
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
                        draggable={false}
                        onDragStart={(e) => e.preventDefault()}
                    />
                </div>
                {/* Fine Tuning Offsets */}
                <div className="flex gap-4">
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-1 text-xs text-gray-500">
                            <label>가로 미세조정 (X)</label>
                            <input
                                type="number"
                                value={globalSlideStyle.offsetX || 0}
                                onChange={(e) => updateGlobalSlideStyle({ offsetX: Number(e.target.value) })}
                                className="w-14 bg-gray-800 text-white rounded px-1 text-xs border border-gray-700 text-right"
                            />
                        </div>
                        <input
                            type="range"
                            min="-500"
                            max="500"
                            step="1"
                            value={globalSlideStyle.offsetX || 0}
                            onChange={(e) => updateGlobalSlideStyle({ offsetX: parseInt(e.target.value) })}
                            className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            draggable={false}
                            onDragStart={(e) => e.preventDefault()}
                        />
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-1 text-xs text-gray-500">
                            <label>세로 미세조정 (Y)</label>
                            <input
                                type="number"
                                value={globalSlideStyle.offsetY || 0}
                                onChange={(e) => updateGlobalSlideStyle({ offsetY: Number(e.target.value) })}
                                className="w-14 bg-gray-800 text-white rounded px-1 text-xs border border-gray-700 text-right"
                            />
                        </div>
                        <input
                            type="range"
                            min="-500"
                            max="500"
                            step="1"
                            value={globalSlideStyle.offsetY || 0}
                            onChange={(e) => updateGlobalSlideStyle({ offsetY: parseInt(e.target.value) })}
                            className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            draggable={false}
                            onDragStart={(e) => e.preventDefault()}
                        />
                    </div>
                </div>
            </div>

            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-6 mb-3">
                성경 출처 스타일 (Bible Reference)
            </h3>
            <div className="space-y-3">
                {/* Font Size & Color */}
                <div className="flex gap-2">
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-1 text-xs text-gray-500">
                            <label>크기</label>
                            <input
                                type="number"
                                value={globalSlideStyle.bibleRefFontSize || 48}
                                onChange={(e) => updateGlobalSlideStyle({ bibleRefFontSize: Number(e.target.value) })}
                                className="w-14 bg-gray-800 text-white rounded px-1 text-xs border border-gray-700 text-right"
                            />
                        </div>
                        <input
                            type="range"
                            min="10"
                            max="150"
                            step="1"
                            value={globalSlideStyle.bibleRefFontSize || 48}
                            onChange={(e) => updateGlobalSlideStyle({ bibleRefFontSize: parseInt(e.target.value) })}
                            className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            draggable={false}
                            onDragStart={(e) => e.preventDefault()}
                        />
                    </div>
                    <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">색상</label>
                        <div className="flex gap-2">
                            <input
                                type="color"
                                value={globalSlideStyle.bibleRefFontColor || '#EAB308'}
                                onChange={(e) => updateGlobalSlideStyle({ bibleRefFontColor: e.target.value })}
                                className="h-7 w-8 rounded cursor-pointer bg-transparent border-none p-0"
                            />
                            <input
                                type="text"
                                value={globalSlideStyle.bibleRefFontColor || '#EAB308'}
                                onChange={(e) => updateGlobalSlideStyle({ bibleRefFontColor: e.target.value })}
                                className="w-full bg-gray-800 text-white rounded px-2 py-1 text-sm border border-gray-700"
                            />
                        </div>
                    </div>
                </div>

                {/* Font Family */}
                <div>
                    <label className="block text-xs text-gray-500 mb-1">글꼴 (Font Family)</label>
                    <select
                        value={globalSlideStyle.bibleRefFontFamily || 'serif'}
                        onChange={(e) => updateGlobalSlideStyle({ bibleRefFontFamily: e.target.value })}
                        className="w-full bg-gray-800 text-white rounded px-2 py-1 text-sm border border-gray-700 outline-none"
                    >
                        <option value="sans-serif">Sans Serif</option>
                        <option value="serif">Serif</option>
                        <option value="monospace">Monospace</option>
                        <option value="'Nanum Gothic', sans-serif">나눔고딕 (Nanum Gothic)</option>
                        <option value="'Malgun Gothic', sans-serif">맑은 고딕 (Malgun Gothic)</option>
                    </select>
                </div>

                {/* Position */}
                <div>
                    <label className="block text-xs text-gray-500 mb-1">위치 (Position)</label>
                    <div className="grid grid-cols-2 gap-1 bg-gray-800 rounded p-1 border border-gray-700">
                        {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((pos) => {
                            const isSelected = (globalSlideStyle.bibleRefPosition || 'top-left') === pos;
                            return (
                                <button
                                    key={pos}
                                    onClick={() => updateGlobalSlideStyle({ bibleRefPosition: pos })}
                                    className={`p-1.5 rounded text-[10px] transition-colors ${isSelected
                                        ? 'bg-blue-600 text-white'
                                        : 'text-gray-400 hover:text-white hover:bg-gray-700'
                                        }`}
                                >
                                    {pos === 'top-left' ? '↖️ 좌측 상단' : pos === 'top-right' ? '↗️ 우측 상단' : pos === 'bottom-left' ? '↙️ 좌측 하단' : '↘️ 우측 하단'}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Fine Tuning Offsets */}
                <div className="flex gap-4">
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-1 text-xs text-gray-500">
                            <label>여백 X (px)</label>
                            <input
                                type="number"
                                value={globalSlideStyle.bibleRefOffsetX ?? 80}
                                onChange={(e) => updateGlobalSlideStyle({ bibleRefOffsetX: Number(e.target.value) })}
                                className="w-14 bg-gray-800 text-white rounded px-1 text-xs border border-gray-700 text-right"
                            />
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="500"
                            step="1"
                            value={globalSlideStyle.bibleRefOffsetX ?? 80}
                            onChange={(e) => updateGlobalSlideStyle({ bibleRefOffsetX: parseInt(e.target.value) })}
                            className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            draggable={false}
                            onDragStart={(e) => e.preventDefault()}
                        />
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-1 text-xs text-gray-500">
                            <label>여백 Y (px)</label>
                            <input
                                type="number"
                                value={globalSlideStyle.bibleRefOffsetY ?? 64}
                                onChange={(e) => updateGlobalSlideStyle({ bibleRefOffsetY: Number(e.target.value) })}
                                className="w-14 bg-gray-800 text-white rounded px-1 text-xs border border-gray-700 text-right"
                            />
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="500"
                            step="1"
                            value={globalSlideStyle.bibleRefOffsetY ?? 64}
                            onChange={(e) => updateGlobalSlideStyle({ bibleRefOffsetY: parseInt(e.target.value) })}
                            className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            draggable={false}
                            onDragStart={(e) => e.preventDefault()}
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}

export default GlobalStylePanel
