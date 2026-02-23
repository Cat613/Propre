import { useEffect, useState } from 'react'
import ScaledSlide from './ScaledSlide'
import { OutputState } from '../types'

const OutputDisplay: React.FC = () => {
    const [currentSlide, setCurrentSlide] = useState<OutputState['slide']>(null)
    const [currentBackground, setCurrentBackground] = useState<OutputState['background']>({ type: 'none' })
    const [globalSlideStyle, setGlobalSlideStyle] = useState<OutputState['globalSlideStyle']>()

    useEffect(() => {
        // Listen for updates from main process
        const removeListener = window.ipcRenderer.on('update-output', (data: string) => {
            try {
                // Handle legacy string commands
                if (data === '__BLACK__') {
                    setCurrentSlide(null)
                    setCurrentBackground({ type: 'none' })
                    return
                }

                const parsed = JSON.parse(data)

                // Check if it's the new structured object
                if (parsed.type === 'state-update') {
                    const state = parsed as OutputState
                    setCurrentSlide(state.slide)
                    setCurrentBackground(state.background || { type: 'none' })
                    if (state.globalSlideStyle) {
                        setGlobalSlideStyle(state.globalSlideStyle)
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

    return (
        <div className="w-screen h-screen bg-black overflow-hidden relative">
            {/* Layer 1: Background */}
            <div
                className="absolute inset-0 z-0"
                style={{
                    backgroundColor: '#000000'
                }}
            >
                {currentBackground.type === 'image' && currentBackground.url && (
                    <img
                        src={currentBackground.url}
                        className="w-full h-full object-cover"
                        alt="Background"
                    />
                )}
                {currentBackground.type === 'video' && currentBackground.url && (
                    <video
                        key={currentBackground.url} // Re-mount if URL changes to ensure autoplay
                        src={currentBackground.url}
                        className="w-full h-full object-cover"
                        autoPlay
                        loop
                        muted
                    />
                )}

                {/* Full-screen Background Dimmer Layer */}
                {(() => {
                    if (!currentSlide) return null;
                    const useCustomStyle = currentSlide.styles?.useCustomStyle === true;
                    const dimValue = (useCustomStyle && currentSlide.styles?.backgroundDim !== undefined)
                        ? currentSlide.styles.backgroundDim
                        : globalSlideStyle?.backgroundDim || 0;

                    if (dimValue > 0) {
                        return (
                            <div
                                className="absolute inset-0 w-full h-full pointer-events-none"
                                style={{ backgroundColor: `rgba(0, 0, 0, ${dimValue})`, zIndex: 1 }}
                            />
                        );
                    }
                    return null;
                })()}
            </div>

            {/* Layer 2: Slide Content */}
            <div className="absolute inset-0 z-10">
                {currentSlide ? (
                    <ScaledSlide
                        slide={currentSlide}
                        overrideStyle={{ backgroundColor: 'transparent', backgroundImage: 'none' }}
                        globalStyleOverride={globalSlideStyle}
                        disableDimOverlay={true}
                    />
                ) : (
                    // Black screen when no slide
                    <div />
                )}
            </div>
        </div>
    )
}

export default OutputDisplay
