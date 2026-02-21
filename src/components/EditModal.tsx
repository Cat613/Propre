import { useState, useEffect } from 'react'
import type { Slide, SlideStyles, SlideLabel } from '../types'
import { LABEL_COLORS } from '../types'
import { usePresentationStore } from '../store'
import ScaledSlide from './ScaledSlide'

interface EditModalProps {
    isOpen: boolean
    onClose: () => void
    slide: Slide | null
    onSave: (id: string, updates: Partial<Slide>) => void
}

const LABEL_OPTIONS: SlideLabel[] = ['None', 'Intro', 'Verse 1', 'Verse 2', 'Verse 3', 'Chorus', 'Bridge', 'Ending']

const EditModal: React.FC<EditModalProps> = ({ isOpen, onClose, slide, onSave }) => {
    const { activeSlideId } = usePresentationStore()
    const [content, setContent] = useState('')
    const [fontSize, setFontSize] = useState(4)
    const [color, setColor] = useState('#ffffff')
    const [backgroundColor, setBackgroundColor] = useState('#000000')
    const [backgroundUrl, setBackgroundUrl] = useState<string | undefined>(undefined)
    const [backgroundDim, setBackgroundDim] = useState(0)
    const [mediaType, setMediaType] = useState<Slide['type']>('text')
    const [label, setLabel] = useState<SlideLabel>('None')
    const [useCustomStyle, setUseCustomStyle] = useState(false)

    useEffect(() => {
        if (slide) {
            setContent(slide.content || '')
            const fontSizeNum = parseFloat(slide.styles?.fontSize || '4rem')
            setFontSize(isNaN(fontSizeNum) ? 4 : fontSizeNum)
            setColor(slide.styles?.color || '#ffffff')
            setBackgroundColor(slide.styles?.backgroundColor || '#000000')
            setBackgroundUrl(slide.backgroundUrl)
            setBackgroundDim(slide.styles?.backgroundDim || 0)
            setMediaType(slide.type)
            setLabel(slide.label || 'None')
            setUseCustomStyle(slide.styles?.useCustomStyle || false)
        }
    }, [slide])

    if (!isOpen || !slide) return null

    const handleSave = () => {
        const updates: Partial<Slide> = {
            content,
            type: mediaType,
            backgroundUrl,
            label,
            labelColor: LABEL_COLORS[label],
            styles: {
                ...slide.styles,
                fontSize: `${fontSize}rem`,
                color,
                backgroundColor,
                backgroundDim,
                useCustomStyle,
            } as SlideStyles,
        }

        onSave(slide.id, updates)

        if (slide.id === activeSlideId) {
            const updatedSlide: Slide = { ...slide, ...updates }
            window.ipcRenderer.send('update-output', JSON.stringify(updatedSlide))
        }

        onClose()
    }

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose()
    }

    const handleChangeMedia = async () => {
        try {
            const filePaths = await window.ipcRenderer.selectMediaFiles()
            if (filePaths.length > 0) {
                const filePath = filePaths[0]
                const extension = filePath.split('.').pop()?.toLowerCase() || ''
                const videoExtensions = ['mp4', 'mov', 'webm']
                setBackgroundUrl(`file://${filePath}`)
                setMediaType(videoExtensions.includes(extension) ? 'video' : 'image')
            }
        } catch (error) {
            console.error('Failed to select media:', error)
        }
    }

    const handleRemoveBackground = () => {
        setBackgroundUrl(undefined)
        setMediaType('text')
    }

    const previewSlide: Slide = {
        ...slide,
        content,
        type: mediaType,
        backgroundUrl,
        label,
        labelColor: LABEL_COLORS[label],
        styles: { ...slide.styles, fontSize: `${fontSize}rem`, color, backgroundColor, backgroundDim, useCustomStyle },
    }

    const getFileName = (url?: string) => {
        if (!url) return '없음'
        const parts = url.replace('file://', '').split(/[/\\]/)
        return parts[parts.length - 1] || '없음'
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={handleBackdropClick}
        >
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-3xl mx-4 border border-gray-700 overflow-hidden max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 bg-gray-800 border-b border-gray-700 sticky top-0">
                    <h2 className="text-lg font-bold text-white">슬라이드 편집</h2>
                    <button onClick={onClose} className="p-1 hover:bg-gray-700 rounded">
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    {/* Preview */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">미리보기</label>
                        <div className="aspect-video rounded-lg overflow-hidden border border-gray-700 bg-black">
                            <ScaledSlide slide={previewSlide} />
                        </div>
                    </div>

                    {/* Label Selector */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">슬라이드 라벨</label>
                        <div className="flex gap-2 flex-wrap">
                            {LABEL_OPTIONS.map((opt) => (
                                <button
                                    key={opt}
                                    onClick={() => setLabel(opt)}
                                    className={`px-3 py-1.5 text-sm rounded-full border-2 font-medium ${label === opt
                                        ? 'border-white text-white'
                                        : 'border-gray-600 text-gray-400 hover:border-gray-500'
                                        }`}
                                    style={{
                                        backgroundColor: label === opt ? LABEL_COLORS[opt] : 'transparent',
                                        borderColor: label === opt ? LABEL_COLORS[opt] : undefined,
                                    }}
                                >
                                    {opt}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Background Media */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">배경 미디어</label>
                        <div className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg border border-gray-700">
                            <div className="flex-1">
                                <p className="text-sm text-gray-400">
                                    현재 배경: <span className="text-gray-200">{getFileName(backgroundUrl)}</span>
                                    {backgroundUrl && (
                                        <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-700 rounded text-gray-300">{mediaType}</span>
                                    )}
                                </p>
                            </div>
                            <button onClick={handleChangeMedia} className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded">변경</button>
                            {backgroundUrl && (
                                <button onClick={handleRemoveBackground} className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded">제거</button>
                            )}
                        </div>

                        {/* Background Dim Slider */}
                        <div className="mt-3">
                            <div className="flex items-center justify-between mb-1 text-sm text-gray-400">
                                <span>배경 어둡기</span>
                                <span>{Math.round(backgroundDim * 100)}%</span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={backgroundDim}
                                onChange={(e) => setBackgroundDim(parseFloat(e.target.value))}
                                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                            />
                        </div>
                    </div>

                    {/* Text Content */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">텍스트 내용</label>
                        <textarea
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            rows={4}
                            className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                            placeholder="슬라이드에 표시할 텍스트를 입력하세요..."
                        />
                    </div>

                    {/* Style Options */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <label className="text-sm font-medium text-gray-300">스타일 설정</label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={useCustomStyle}
                                    onChange={e => setUseCustomStyle(e.target.checked)}
                                    className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-600 rounded focus:ring-blue-500"
                                />
                                <span className="text-sm text-gray-400">전역 스타일 무시 (개별 폰트/색상 지정)</span>
                            </label>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">폰트 크기 (rem)</label>
                                <input
                                    type="number"
                                    value={fontSize}
                                    onChange={(e) => setFontSize(parseFloat(e.target.value) || 1)}
                                    min={1} max={20} step={0.5}
                                    disabled={!useCustomStyle}
                                    className={`w-full px-4 py-2 border rounded-lg text-white focus:ring-2 focus:ring-blue-500 ${!useCustomStyle ? 'bg-gray-700 border-gray-600 opacity-50 cursor-not-allowed' : 'bg-gray-800 border-gray-600'}`}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">글자 색상</label>
                                <div className="flex items-center gap-2">
                                    <input type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={!useCustomStyle} className={`w-12 h-10 rounded border border-gray-600 ${!useCustomStyle ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`} />
                                    <input type="text" value={color} onChange={(e) => setColor(e.target.value)} disabled={!useCustomStyle} className={`flex-1 px-3 py-2 border rounded text-white text-sm ${!useCustomStyle ? 'bg-gray-700 border-gray-600 opacity-50 cursor-not-allowed' : 'bg-gray-800 border-gray-600'}`} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">배경 색상</label>
                                <div className="flex items-center gap-2">
                                    <input type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} className="w-12 h-10 rounded border border-gray-600 cursor-pointer" />
                                    <input type="text" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white text-sm" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-800 border-t border-gray-700 sticky bottom-0">
                    <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg">취소</button>
                    <button onClick={handleSave} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg">저장</button>
                </div>
            </div>
        </div>
    )
}

export default EditModal
