import { useEffect, useState, useRef } from 'react'
import ScaledSlide from './ScaledSlide'
import { OutputState, LayerState } from '../types'

const OutputDisplay: React.FC = () => {
    // Default empty layers state
    const [layers, setLayers] = useState<LayerState>({
        audio: null,
        background: { type: 'none' },
        slide: null,
        announcement: null,
        prop: null,
        message: null
    })
    const [globalSlideStyle, setGlobalSlideStyle] = useState<OutputState['globalSlideStyle']>()
    const [isGreenScreen, setIsGreenScreen] = useState(false)
    const [screenId, setScreenId] = useState<string>('main')

    // Audio ref for controlling playback
    const audioRef = useRef<HTMLAudioElement>(null)

    useEffect(() => {
        // Extract screenId from URL parameters
        // The URL is typically something like "http://localhost:5173/#output-display?screenId=chroma"
        const hashParams = new URLSearchParams(window.location.hash.split('?')[1] || '')
        const id = hashParams.get('screenId') || 'main'
        setScreenId(id)

        // Listen for targeted updates from main process router
        const removeListener = window.ipcRenderer.on('update-screen', (data: any) => {
            try {
                // Handle legacy string commands
                if (data === '__BLACK__') {
                    setLayers({
                        audio: null,
                        background: { type: 'none' },
                        slide: null,
                        announcement: null,
                        prop: null,
                        message: null
                    })
                    return
                }

                const parsed = typeof data === 'string' ? JSON.parse(data) : data

                // Check if it's the new structured object
                if (parsed.type === 'state-update') {
                    const state = parsed as OutputState

                    if (state.layers) {
                        setLayers(state.layers)
                    } else {
                        // Support backward compatibility during transition
                        setLayers(prev => ({
                            ...prev,
                            slide: (state as any).slide || null,
                            background: (state as any).background || { type: 'none' }
                        }))
                    }

                    if (state.globalSlideStyle) {
                        setGlobalSlideStyle(state.globalSlideStyle)
                    }
                    if (state.isGreenScreen !== undefined) {
                        setIsGreenScreen(state.isGreenScreen)
                    }
                } else {
                    // Fallback for simple string content (if any legacy code remains)
                    // Assuming it's just slide content
                    // ...
                }
            } catch (e) {
                console.error('Failed to parse output data:', e)
            }
        })

        return () => {
            removeListener()
        }
    }, [])

    // Control audio playback via ref
    useEffect(() => {
        if (audioRef.current) {
            if (layers.audio && layers.audio.url) {
                // If the url changed or it was paused, play it
                if (audioRef.current.src !== layers.audio.url) {
                    audioRef.current.src = layers.audio.url
                }
                audioRef.current.loop = layers.audio.loop ?? false
                audioRef.current.volume = layers.audio.volume ?? 1.0

                audioRef.current.play().catch(e => console.error("Audio play failed:", e))
            } else {
                audioRef.current.pause()
                audioRef.current.currentTime = 0
            }
        }
    }, [layers.audio])

    return (
        <div className="w-screen h-screen bg-black overflow-hidden relative" data-screen-id={screenId}>

            {/* Layer 0: Audio (Hidden) */}
            <audio ref={audioRef} className="hidden" />

            {/* Layer 1: Background (Z-index 0) */}
            <div
                className="absolute inset-0 z-0 transition-opacity duration-500 ease-in-out"
                style={{
                    backgroundColor: isGreenScreen ? '#00B140' : '#000000'
                }}
            >
                {!isGreenScreen && layers.background.type === 'image' && layers.background.url && (
                    <img
                        src={layers.background.url}
                        className="w-full h-full object-cover transition-opacity duration-1000"
                        alt="Background"
                    />
                )}
                {!isGreenScreen && layers.background.type === 'video' && layers.background.url && (
                    <video
                        key={layers.background.url} // Re-mount if URL changes to ensure autoplay
                        src={layers.background.url}
                        className="w-full h-full object-cover transition-opacity duration-1000"
                        autoPlay
                        loop
                        muted
                    />
                )}

                {/* Full-screen Background Dimmer Layer (Applied if slide demands it) */}
                {!isGreenScreen && (() => {
                    if (!layers.slide) return null;
                    const useCustomStyle = layers.slide.styles?.useCustomStyle === true;
                    const dimValue = (useCustomStyle && layers.slide.styles?.backgroundDim !== undefined)
                        ? layers.slide.styles.backgroundDim
                        : globalSlideStyle?.backgroundDim || 0;

                    if (dimValue > 0) {
                        return (
                            <div
                                className="absolute inset-0 w-full h-full pointer-events-none transition-opacity duration-500"
                                style={{ backgroundColor: `rgba(0, 0, 0, ${dimValue})` }}
                            />
                        );
                    }
                    return null;
                })()}
            </div>

            {/* Layer 2: Main Slide Content (Z-index 10) */}
            <div className={`absolute inset-0 z-10 transition-opacity duration-300 ${layers.slide ? 'opacity-100' : 'opacity-0'}`}>
                {layers.slide && (
                    <ScaledSlide
                        slide={layers.slide}
                        overrideStyle={{ backgroundColor: 'transparent', backgroundImage: 'none' }}
                        globalStyleOverride={globalSlideStyle}
                        disableDimOverlay={true}
                        isGreenScreen={isGreenScreen}
                    />
                )}
            </div>

            {/* Layer 3: Announcement (Z-index 20) */}
            {/* Planned for future implementation */}
            <div className={`absolute inset-0 z-20 pointer-events-none transition-opacity duration-300 ${layers.announcement ? 'opacity-100' : 'opacity-0'}`}>
                {layers.announcement && (
                    <ScaledSlide
                        slide={layers.announcement}
                        overrideStyle={{ backgroundColor: 'transparent', backgroundImage: 'none' }}
                        globalStyleOverride={globalSlideStyle}
                        disableDimOverlay={true}
                        isGreenScreen={isGreenScreen}
                    />
                )}
            </div>

            {/* Layer 4: Props/Logos (Z-index 30) */}
            <div className="absolute inset-0 z-30 pointer-events-none">
                {layers.prop && layers.prop.type === 'logo' && layers.prop.url && (
                    <div
                        className="absolute w-48 h-auto"
                        style={{
                            top: layers.prop.position.includes('top') ? '2rem' : 'auto',
                            bottom: layers.prop.position.includes('bottom') ? '2rem' : 'auto',
                            left: layers.prop.position.includes('left') ? '2rem' : 'auto',
                            right: layers.prop.position.includes('right') ? '2rem' : 'auto',
                        }}
                    >
                        <img src={layers.prop.url} alt="Prop" className="w-full h-auto drop-shadow-lg" />
                    </div>
                )}
            </div>

            {/* Layer 5: Message Ticker (Z-index 40) */}
            <div className="absolute inset-x-0 bottom-0 z-40 pointer-events-none transition-transform duration-500">
                {layers.message && (
                    <div className="bg-black/70 py-4 border-t border-gray-800 backdrop-blur-sm overflow-hidden whitespace-nowrap">
                        <div
                            className="text-yellow-400 font-bold text-4xl px-8 inline-block drop-shadow-md"
                            style={{
                                WebkitTextStroke: isGreenScreen ? '2px black' : 'none',
                                animation: layers.message.isScrolling ? `marquee ${layers.message.speed || 15}s linear infinite` : 'none'
                            }}
                        >
                            {layers.message.content}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default OutputDisplay
