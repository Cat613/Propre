import { useState, useEffect, useRef } from 'react'
import type { Slide, SlideStyles, SlideLabel, CanvasElement, TextElement, ShapeElement } from '../types'
import { LABEL_COLORS } from '../types'
import { usePresentationStore } from '../store'
import ScaledSlide from './ScaledSlide'
import { Rnd } from 'react-rnd'

interface EditModalProps {
    isOpen: boolean
    onClose: () => void
    slide: Slide | null
    onSave: (id: string, updates: Partial<Slide>) => void
}

const LABEL_OPTIONS: SlideLabel[] = ['None', 'Intro', 'Verse 1', 'Verse 2', 'Verse 3', 'Chorus', 'Bridge', 'Ending']

const EditModal: React.FC<EditModalProps> = ({ isOpen, onClose, slide, onSave }) => {
    const { globalSlideStyle } = usePresentationStore()
    const [fontSize, setFontSize] = useState(4)
    const [color, setColor] = useState('#ffffff')
    const [backgroundColor, setBackgroundColor] = useState('#000000')
    const [backgroundUrl, setBackgroundUrl] = useState<string | undefined>(undefined)
    const [backgroundDim, setBackgroundDim] = useState(0)
    const [mediaType, setMediaType] = useState<Slide['type']>('text')
    const [label, setLabel] = useState<SlideLabel>('None')
    const [useCustomStyle, setUseCustomStyle] = useState(false)

    const [elements, setElements] = useState<CanvasElement[]>([])
    const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (slide) {
            // Auto-migrate legacy content to an element if no elements exist
            let initialElements = slide.elements ? [...slide.elements] : []
            if (initialElements.length === 0 && slide.content) {
                initialElements.push({
                    id: `legacy-${Date.now()}`,
                    type: 'text',
                    text: slide.content,
                    x: 5,
                    y: 5,
                    width: 90,
                    height: 90,
                    zIndex: 10,
                    styles: slide.styles || {}
                } as TextElement)
            }
            setElements(initialElements)

            // Still keep legacy style state for simple fallback if needed
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

    const handleAddText = () => {
        const newEl: TextElement = {
            id: `text-${Date.now()}`,
            type: 'text',
            text: '새로운 텍스트',
            x: 25, y: 25, width: 50, height: 20, zIndex: elements.length + 10,
            styles: { color: '#ffffff', fontSize: '60px', textAlign: 'center' }
        }
        setElements([...elements, newEl])
        setSelectedElementId(newEl.id)
    }

    const handleAddShape = () => {
        const newEl: ShapeElement = {
            id: `shape-${Date.now()}`,
            type: 'shape',
            shapeType: 'rectangle',
            x: 40, y: 40, width: 20, height: 20, zIndex: elements.length + 10,
            backgroundColor: '#3B82F6'
        }
        setElements([...elements, newEl])
        setSelectedElementId(newEl.id)
    }

    const handleUpdateElement = (id: string, updates: Partial<CanvasElement>) => {
        setElements(elements.map(el => el.id === id ? { ...el, ...updates } as CanvasElement : el))
    }

    const handleRemoveElement = (id: string) => {
        setElements(elements.filter(el => el.id !== id))
        if (selectedElementId === id) setSelectedElementId(null)
    }

    const handleSave = () => {
        const updates: Partial<Slide> = {
            // Phase 3: Save elements
            elements,
            // Fallback for simple renderer
            content: elements.filter(e => e.type === 'text').map(e => (e as TextElement).text).join('\n'),
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
        elements,
        // Legacy fallback properties for ScaledSlide background rendering
        content: '',
        type: mediaType,
        backgroundUrl,
        label,
        labelColor: LABEL_COLORS[label],
        styles: { ...slide.styles, fontSize: `${fontSize}rem`, color, backgroundColor, backgroundDim, useCustomStyle },
    }

    const selectedElement = elements.find(e => e.id === selectedElementId)

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
                    {/* Preview / Canvas Area */}
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-sm font-medium text-gray-300">캔버스 에디터 (미리보기)</label>
                            <div className="flex gap-2">
                                <button onClick={handleAddText} className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-white">+ 텍스트 추가</button>
                                <button onClick={handleAddShape} className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-white">+ 도형 추가</button>
                            </div>
                        </div>
                        <div
                            className="aspect-video rounded-lg overflow-hidden border border-gray-700 bg-black relative"
                            ref={containerRef}
                            onClick={() => setSelectedElementId(null)}
                        >
                            <ScaledSlide slide={previewSlide} globalStyleOverride={globalSlideStyle} />

                            {/* Interactive Overlay for Rnd */}
                            <div className="absolute inset-0 z-50 pointer-events-none">
                                {elements.map(el => (
                                    <Rnd
                                        key={el.id}
                                        className={`pointer-events-auto border-2 ${selectedElementId === el.id ? 'border-blue-500 bg-blue-500/10' : 'border-transparent hover:border-gray-500/50'}`}
                                        bounds="parent"
                                        position={{
                                            x: typeof el.x === 'number' && el.x <= 100 ? (containerRef.current?.clientWidth || 0) * (el.x / 100) : (el.x as number),
                                            y: typeof el.y === 'number' && el.y <= 100 ? (containerRef.current?.clientHeight || 0) * (el.y / 100) : (el.y as number)
                                        }}
                                        size={{
                                            width: typeof el.width === 'number' && el.width <= 100 ? `${el.width}%` : `${el.width}px`,
                                            height: typeof el.height === 'number' && el.height <= 100 ? `${el.height}%` : `${el.height}px`
                                        }}
                                        onDragStop={(_e, d) => {
                                            if (!containerRef.current) return
                                            const xPct = (d.x / containerRef.current.clientWidth) * 100
                                            const yPct = (d.y / containerRef.current.clientHeight) * 100
                                            handleUpdateElement(el.id, { x: xPct, y: yPct })
                                        }}
                                        onResizeStop={(_e, _dir, ref, _delta, position) => {
                                            if (!containerRef.current) return
                                            const wPct = (ref.offsetWidth / containerRef.current.clientWidth) * 100
                                            const hPct = (ref.offsetHeight / containerRef.current.clientHeight) * 100
                                            const xPct = (position.x / containerRef.current.clientWidth) * 100
                                            const yPct = (position.y / containerRef.current.clientHeight) * 100
                                            handleUpdateElement(el.id, { x: xPct, y: yPct, width: wPct, height: hPct })
                                        }}
                                        onClick={(e: any) => {
                                            e.stopPropagation()
                                            setSelectedElementId(el.id)
                                        }}
                                    >
                                        {/* Blank div just to catch drag events cleanly over the actual rendered component below it */}
                                        <div className="w-full h-full cursor-move" />
                                    </Rnd>
                                ))}
                            </div>
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

                        {/* Element Properties Panel */}
                        {selectedElement ? (
                            <div className="bg-gray-800 p-4 rounded-lg border border-blue-900/50">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-white font-medium">선택된 요소 속성</h3>
                                    <button onClick={() => handleRemoveElement(selectedElement.id)} className="text-xs px-2 py-1 bg-red-600/20 text-red-500 rounded hover:bg-red-600/40">삭제</button>
                                </div>

                                {selectedElement.type === 'text' && (
                                    <div className="space-y-4">
                                        <textarea
                                            value={(selectedElement as TextElement).text}
                                            onChange={(e) => handleUpdateElement(selectedElement.id, { text: e.target.value })}
                                            rows={3}
                                            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white text-sm"
                                            placeholder="텍스트 입력"
                                        />
                                        <div className="grid grid-cols-3 gap-3">
                                            <div>
                                                <label className="text-xs text-gray-400 block mb-1">폰트 크기</label>
                                                <input type="text" value={(selectedElement as TextElement).styles?.fontSize || ''} onChange={e => handleUpdateElement(selectedElement.id, { styles: { ...(selectedElement as TextElement).styles, fontSize: e.target.value, useCustomStyle: true } })} className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white text-sm" placeholder="e.g. 60px" />
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-400 block mb-1">글자 색상</label>
                                                <input type="color" value={(selectedElement as TextElement).styles?.color || '#ffffff'} onChange={e => handleUpdateElement(selectedElement.id, { styles: { ...(selectedElement as TextElement).styles, color: e.target.value, useCustomStyle: true } })} className="w-full h-7 rounded border border-gray-700 cursor-pointer" />
                                            </div>
                                            <div className="flex flex-col gap-2 justify-center pt-5">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input type="checkbox" checked={!!(selectedElement as TextElement).styles?.textOutline} onChange={e => handleUpdateElement(selectedElement.id, { styles: { ...(selectedElement as TextElement).styles, textOutline: e.target.checked, useCustomStyle: true } })} className="w-3 h-3 text-blue-600 bg-gray-800 border-gray-600 rounded focus:ring-blue-500" />
                                                    <span className="text-xs text-gray-400">외곽선 (Stroke)</span>
                                                </label>
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input type="checkbox" checked={!!(selectedElement as TextElement).styles?.textShadow} onChange={e => handleUpdateElement(selectedElement.id, { styles: { ...(selectedElement as TextElement).styles, textShadow: e.target.checked, useCustomStyle: true } })} className="w-3 h-3 text-blue-600 bg-gray-800 border-gray-600 rounded focus:ring-blue-500" />
                                                    <span className="text-xs text-gray-400">그림자 (Shadow)</span>
                                                </label>
                                            </div>
                                            <div className="col-span-3 mt-2 border-t border-gray-700 pt-3">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={!!((selectedElement as TextElement).styles?.backgroundColor && (selectedElement as TextElement).styles?.backgroundColor !== 'transparent')}
                                                        onChange={e => {
                                                            handleUpdateElement(selectedElement.id, {
                                                                styles: {
                                                                    ...(selectedElement as TextElement).styles,
                                                                    backgroundColor: e.target.checked ? 'rgba(0, 0, 0, 0.5)' : 'transparent',
                                                                    useCustomStyle: true
                                                                }
                                                            })
                                                        }}
                                                        className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-600 rounded focus:ring-blue-500"
                                                        id={`bg-toggle-${selectedElement.id}`}
                                                    />
                                                    <label htmlFor={`bg-toggle-${selectedElement.id}`} className="text-sm font-medium text-gray-300 cursor-pointer">텍스트 배경 사용</label>
                                                </div>

                                                {((selectedElement as TextElement).styles?.backgroundColor && (selectedElement as TextElement).styles?.backgroundColor !== 'transparent') && (() => {
                                                    // Parse existing rgba() or hex to get color and alpha
                                                    const bg = (selectedElement as TextElement).styles!.backgroundColor!;
                                                    let hexColor = '#000000';
                                                    let alpha = 0.5;

                                                    if (bg.startsWith('rgba')) {
                                                        const parts = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                                                        if (parts) {
                                                            const r = parseInt(parts[1]).toString(16).padStart(2, '0');
                                                            const g = parseInt(parts[2]).toString(16).padStart(2, '0');
                                                            const b = parseInt(parts[3]).toString(16).padStart(2, '0');
                                                            hexColor = `#${r}${g}${b}`;
                                                            alpha = parts[4] !== undefined ? parseFloat(parts[4]) : 1;
                                                        }
                                                    } else if (bg.startsWith('#')) {
                                                        hexColor = bg.substring(0, 7);
                                                        if (bg.length === 9) {
                                                            alpha = parseInt(bg.substring(7, 9), 16) / 255;
                                                        } else {
                                                            alpha = 1;
                                                        }
                                                    }

                                                    const updateRgba = (newHex: string, newAlpha: number) => {
                                                        const r = parseInt(newHex.slice(1, 3), 16);
                                                        const g = parseInt(newHex.slice(3, 5), 16);
                                                        const b = parseInt(newHex.slice(5, 7), 16);
                                                        handleUpdateElement(selectedElement.id, {
                                                            styles: {
                                                                ...(selectedElement as TextElement).styles,
                                                                backgroundColor: `rgba(${r}, ${g}, ${b}, ${newAlpha})`,
                                                                useCustomStyle: true
                                                            }
                                                        });
                                                    };

                                                    return (
                                                        <div className="flex items-center gap-4 bg-gray-900/50 p-3 rounded-lg border border-gray-700/50">
                                                            <div className="flex flex-col gap-1">
                                                                <label className="text-xs text-gray-400">배경 색상</label>
                                                                <input
                                                                    type="color"
                                                                    value={hexColor}
                                                                    onChange={e => updateRgba(e.target.value, alpha)}
                                                                    className="w-12 h-8 rounded border border-gray-700 cursor-pointer"
                                                                />
                                                            </div>
                                                            <div className="flex-1 flex flex-col gap-1">
                                                                <div className="flex justify-between items-center">
                                                                    <label className="text-xs text-gray-400">미디어 어둡기 (투명도)</label>
                                                                    <span className="text-xs text-gray-500">{Math.round(alpha * 100)}%</span>
                                                                </div>
                                                                <input
                                                                    type="range" min="0" max="1" step="0.05"
                                                                    value={alpha}
                                                                    onChange={e => updateRgba(hexColor, parseFloat(e.target.value))}
                                                                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                                                />
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {selectedElement.type === 'shape' && (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs text-gray-400 block mb-1">배경 색상</label>
                                            <input type="color" value={(selectedElement as ShapeElement).backgroundColor || '#3B82F6'} onChange={e => handleUpdateElement(selectedElement.id, { backgroundColor: e.target.value })} className="w-full h-7 rounded border border-gray-700 cursor-pointer" />
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-400 block mb-1">도형 형태</label>
                                            <select value={(selectedElement as ShapeElement).shapeType} onChange={e => handleUpdateElement(selectedElement.id, { shapeType: e.target.value as any })} className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-white text-sm">
                                                <option value="rectangle">사각형</option>
                                                <option value="ellipse">원형</option>
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-center py-4 bg-gray-800/50 rounded-lg border border-gray-700 border-dashed">
                                <p className="text-gray-500 text-sm">캔버스에서 요소를 선택하면 속성을 편집할 수 있습니다.</p>
                            </div>
                        )}

                        {/* Background Settings Wrapper (Kept for compatibility, could be moved into a "Background Tab" later) */}
                        <details className="group">
                            <summary className="cursor-pointer text-sm font-medium text-gray-400 hover:text-gray-200">고급 배경 설정 (레거시 호환)</summary>
                            <div className="mt-3 space-y-4 p-4 bg-gray-800 rounded-lg border border-gray-700">
                                {/* Style Options */}
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <label className="text-sm font-medium text-gray-300">구버전 스타일 오버라이드 지정 (선택 해제된 요소 없을때)</label>
                                        <label className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={useCustomStyle}
                                                onChange={e => setUseCustomStyle(e.target.checked)}
                                                className="w-4 h-4 text-blue-600 bg-gray-800 border-gray-600 rounded focus:ring-blue-500"
                                            />
                                            <span className="text-sm text-gray-400">적용</span>
                                        </label>
                                    </div>
                                    <div className="grid grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-400 mb-2">배경 색상</label>
                                            <div className="flex items-center gap-2">
                                                <input type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} className="w-12 h-10 rounded border border-gray-600 cursor-pointer" />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-400 mb-2">배경 어둡기</label>
                                            <input
                                                type="range" min="0" max="1" step="0.05"
                                                value={backgroundDim} onChange={(e) => setBackgroundDim(parseFloat(e.target.value))}
                                                className="w-full h-2 mt-3 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </details>

                        {/* Footer */}
                        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-800 border-t border-gray-700 sticky bottom-0">
                            <button onClick={onClose} className="px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg">취소</button>
                            <button onClick={handleSave} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg">저장</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default EditModal
