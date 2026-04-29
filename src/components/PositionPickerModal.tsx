import React, { useState, useRef, useEffect } from 'react'
import { PropItem } from '../types'

interface PositionPickerModalProps {
    initialProps: PropItem[]
    onSave: (props: PropItem[]) => void
    onClose: () => void
}

const PositionPickerModal: React.FC<PositionPickerModalProps> = ({ initialProps, onSave, onClose }) => {
    const [localProps, setLocalProps] = useState<PropItem[]>(initialProps)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [canvasScale, setCanvasScale] = useState(1)
    const canvasRef = useRef<HTMLDivElement>(null)
    const draggingRef = useRef<{ id: string, startX: number, startY: number, initialCustomX: number, initialCustomY: number } | null>(null)

    useEffect(() => {
        const updateScale = () => {
            if (canvasRef.current) {
                setCanvasScale(canvasRef.current.clientWidth / 1920)
            }
        }
        updateScale()
        window.addEventListener('resize', updateScale)
        return () => window.removeEventListener('resize', updateScale)
    }, [])

    const handlePointerDown = (e: React.PointerEvent, id: string) => {
        setSelectedId(id)
        if (!canvasRef.current) return
        
        const prop = localProps.find(p => p.id === id)
        if (!prop) return

        draggingRef.current = {
            id,
            startX: e.clientX,
            startY: e.clientY,
            initialCustomX: prop.customX ?? 50,
            initialCustomY: prop.customY ?? 50
        }
        
        e.currentTarget.setPointerCapture(e.pointerId)
        e.stopPropagation()
    }

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!draggingRef.current || !canvasRef.current) return
        const { id, startX, startY, initialCustomX, initialCustomY } = draggingRef.current
        
        const rect = canvasRef.current.getBoundingClientRect()
        const dx = e.clientX - startX
        const dy = e.clientY - startY
        
        const dxPercent = (dx / rect.width) * 100
        const dyPercent = (dy / rect.height) * 100
        
        setLocalProps(prev => prev.map(p => 
            p.id === id 
                ? { ...p, position: 'custom', customX: Math.max(0, Math.min(100, initialCustomX + dxPercent)), customY: Math.max(0, Math.min(100, initialCustomY + dyPercent)) } 
                : p
        ))
    }

    const handlePointerUp = (e: React.PointerEvent) => {
        if (draggingRef.current) {
            e.currentTarget.releasePointerCapture(e.pointerId)
            draggingRef.current = null
        }
    }

    const handleScaleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!selectedId) return
        const scale = parseFloat(e.target.value)
        setLocalProps(prev => prev.map(p => p.id === selectedId ? { ...p, scale } : p))
    }

    return (
        <div className="fixed inset-0 bg-black/80 z-[100] flex flex-col items-center justify-center p-8 backdrop-blur-sm">
            <div className="bg-gray-900 rounded-xl w-full max-w-5xl flex flex-col overflow-hidden border border-gray-700 shadow-2xl">
                <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-800">
                    <h2 className="text-white font-bold">고정 안내 화면 배치 및 크기 설정</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
                </div>
                
                <div className="p-6 bg-gray-950 flex justify-center">
                    {/* 16:9 Canvas */}
                    <div 
                        ref={canvasRef}
                        className="relative bg-black w-full aspect-video border-2 border-gray-800 shadow-inner overflow-hidden select-none flex items-center justify-center"
                    >
                        <div style={{ width: 1920, height: 1080, transform: `scale(${canvasScale})`, position: 'relative', flexShrink: 0 }}>
                            {/* Grid lines for reference */}
                            <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-20">
                                <div className="border-r border-b border-gray-500"></div>
                                <div className="border-r border-b border-gray-500"></div>
                                <div className="border-b border-gray-500"></div>
                                <div className="border-r border-b border-gray-500"></div>
                                <div className="border-r border-b border-gray-500"></div>
                                <div className="border-b border-gray-500"></div>
                                <div className="border-r border-gray-500"></div>
                                <div className="border-r border-gray-500"></div>
                                <div></div>
                            </div>

                            {localProps.map(prop => {
                                const x = prop.customX ?? 50
                                const y = prop.customY ?? 50
                                const scale = prop.scale ?? 1.0
                                const isSelected = selectedId === prop.id

                                return (
                                    <div
                                        key={prop.id}
                                        onPointerDown={(e) => handlePointerDown(e, prop.id)}
                                        onPointerMove={handlePointerMove}
                                        onPointerUp={handlePointerUp}
                                        className={`absolute cursor-move touch-none flex items-center justify-center origin-center ${isSelected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-black z-20' : 'z-10 hover:ring-1 hover:ring-gray-400'}`}
                                        style={{
                                            left: `${x}%`,
                                            top: `${y}%`,
                                            transform: `translate(-50%, -50%) scale(${scale})`,
                                        }}
                                    >
                                        {(prop.type === 'image' || prop.type === 'logo') && prop.url && (
                                            <img src={prop.url} alt="Prop" className="max-w-none pointer-events-none" draggable={false} />
                                        )}
                                        {prop.type === 'text' && (
                                            <div className="text-white font-bold whitespace-pre text-center pointer-events-none leading-tight" style={{ fontSize: '76px', textShadow: '4px 4px 8px rgba(0,0,0,0.8)' }}>
                                                {prop.content || '텍스트 입력'}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>

                {/* Controls Area */}
                <div className="p-4 bg-gray-800 border-t border-gray-700 flex items-center justify-between">
                    <div className="flex-1 flex items-center gap-4">
                        {selectedId ? (
                            <div className="flex items-center gap-2">
                                <label className="text-sm text-gray-300 whitespace-nowrap">선택된 요소 크기:</label>
                                <input 
                                    type="range" 
                                    min="0.1" 
                                    max="5.0" 
                                    step="0.01" 
                                    value={localProps.find(p => p.id === selectedId)?.scale ?? 1.0}
                                    onChange={handleScaleChange}
                                    className="w-48 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                />
                                <span className="text-xs text-gray-400 w-12">{Math.round((localProps.find(p => p.id === selectedId)?.scale ?? 1.0) * 100)}%</span>
                            </div>
                        ) : (
                            <div className="text-sm text-gray-400">요소를 클릭하여 크기를 조절하세요. 화면에서 드래그하여 위치를 이동할 수 있습니다.</div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={onClose} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm transition-colors">취소</button>
                        <button onClick={() => onSave(localProps)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-bold transition-colors">적용하기</button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default PositionPickerModal
