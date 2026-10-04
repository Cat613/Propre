import { useState, useEffect, useRef } from 'react'
import { usePresentationStore } from '../store'
import ScaledSlide from './ScaledSlide'

const PreviewPanel: React.FC = () => {
    const { activeSlideId, slides, globalSlideStyle, activeBackground, activeProps, activeMessage } = usePresentationStore()
    const containerRef = useRef<HTMLDivElement>(null)
    const [canvasScale, setCanvasScale] = useState(1)

    const activeSlide = slides.find((s) => s.id === activeSlideId)

    useEffect(() => {
        if (!containerRef.current) return
        const updateScale = (width: number) => {
            setCanvasScale(width / 1920)
        }
        updateScale(containerRef.current.clientWidth)
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                updateScale(entry.contentRect.width)
            }
        })
        observer.observe(containerRef.current)
        return () => observer.disconnect()
    }, [])

    return (
        <div className="flex-none flex flex-col bg-gray-900 border-l border-gray-800">
            <div className="p-3 bg-gray-900 border-b border-gray-800 flex items-center justify-between">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    미리보기 (OUTPUT)
                </h2>
                {activeSlide || (activeProps && activeProps.some(p => p.isVisible !== false)) ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-green-500/10 text-green-400 border border-green-500/20">
                        Active
                    </span>
                ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded text-gray-500">
                        Inactive
                    </span>
                )}
            </div>

            <div className="flex-1 p-4 flex items-center justify-center bg-gray-900 overflow-hidden">
                <div ref={containerRef} className="aspect-video w-full bg-black rounded-lg overflow-hidden shadow-2xl relative border border-gray-800">
                    {/* Background Layer */}
                    <div className="absolute inset-0 z-0">
                        {activeBackground.type === 'image' && activeBackground.url && (
                            <img src={activeBackground.url} className="w-full h-full object-cover" alt="Background" />
                        )}
                        {activeBackground.type === 'video' && activeBackground.url && (
                            <video src={activeBackground.url} className="w-full h-full object-cover" autoPlay loop muted />
                        )}

                        {/* Full-screen Background Dimmer Layer for Preview */}
                        {(() => {
                            if (!activeSlide) return null
                            const useCustomStyle = activeSlide.styles?.useCustomStyle === true
                            const dimValue = (useCustomStyle && activeSlide.styles?.backgroundDim !== undefined)
                                ? activeSlide.styles.backgroundDim
                                : globalSlideStyle?.backgroundDim || 0

                            if (dimValue > 0) {
                                return (
                                    <div
                                        className="absolute inset-0 w-full h-full pointer-events-none"
                                        style={{ backgroundColor: `rgba(0, 0, 0, ${dimValue})`, zIndex: 1 }}
                                    />
                                )
                            }
                            return null
                        })()}
                    </div>

                    {/* Slide Content Layer */}
                    <div className="absolute inset-0 z-10">
                        {activeSlide ? (
                            <ScaledSlide
                                slide={activeSlide}
                                overrideStyle={{ backgroundColor: 'transparent', backgroundImage: 'none' }}
                                globalStyleOverride={globalSlideStyle}
                                disableDimOverlay={true}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400 font-medium">
                                <span className={activeBackground.url || (activeProps && activeProps.length > 0) ? "opacity-0" : ""}>송출 대기 중</span>
                            </div>
                        )}
                    </div>

                    {/* Layer 4: Props/Logos (Z-index 30 - 고정 안내) */}
                    <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden flex items-center justify-center">
                        <div style={{ width: 1920, height: 1080, transform: `scale(${canvasScale})`, position: 'relative', flexShrink: 0 }}>
                            {activeProps && activeProps.map(prop => {
                                if (prop.isVisible === false) return null
                                const scale = prop.scale ?? 1.0
                                let style: React.CSSProperties = {}

                                if (prop.position === 'custom') {
                                    style = {
                                        left: `${prop.customX ?? 50}%`,
                                        top: `${prop.customY ?? 50}%`,
                                        transform: `translate(-50%, -50%) scale(${scale})`
                                    }
                                } else if (prop.position === 'center') {
                                    style = {
                                        left: '50%',
                                        top: '50%',
                                        transform: `translate(-50%, -50%) scale(${scale})`
                                    }
                                } else {
                                    style = { transform: `scale(${scale})` }
                                    if (prop.position.includes('top')) style.top = '2rem'
                                    if (prop.position.includes('bottom')) style.bottom = '2rem'
                                    if (prop.position.includes('left')) style.left = '2rem'
                                    if (prop.position.includes('right')) style.right = '2rem'

                                    if (prop.position === 'top-left') style.transformOrigin = 'top left'
                                    if (prop.position === 'top-right') style.transformOrigin = 'top right'
                                    if (prop.position === 'bottom-left') style.transformOrigin = 'bottom left'
                                    if (prop.position === 'bottom-right') style.transformOrigin = 'bottom right'
                                }

                                return (
                                    <div
                                        key={prop.id}
                                        className="absolute flex items-center justify-center drop-shadow-lg"
                                        style={style}
                                    >
                                        {(prop.type === 'logo' || prop.type === 'image') && prop.url && (
                                            <img src={prop.url} alt="Prop" className="max-w-none" />
                                        )}
                                        {prop.type === 'text' && prop.content && (
                                            <div className="text-white font-bold whitespace-pre text-center leading-tight" style={{ fontSize: '76px', textShadow: '4px 4px 8px rgba(0,0,0,0.8)' }}>
                                                {prop.content}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Layer 5: Message Ticker (Z-index 40) */}
                    <div className="absolute inset-x-0 bottom-0 z-40 pointer-events-none transition-transform duration-500">
                        {activeMessage && (
                            <div className="bg-black/70 py-1 border-t border-gray-800 backdrop-blur-sm overflow-hidden whitespace-nowrap">
                                <div
                                    className="text-yellow-400 font-bold text-xs px-2 inline-block drop-shadow-md"
                                    style={{
                                        animation: activeMessage.isScrolling ? `marquee ${activeMessage.speed || 15}s linear infinite` : 'none'
                                    }}
                                >
                                    {activeMessage.content}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default PreviewPanel
