import { useEffect, useState } from 'react'
import type { Slide, ActiveBackground } from '../types'
import ScaledSlide from './ScaledSlide'

// Minimal types to avoid full dependency if possible, but we use types.ts
interface OutputState {
    type: string
    slide: Slide | null
    background: ActiveBackground
}

const OutputDisplay: React.FC = () => {
    const [currentSlide, setCurrentSlide] = useState<Slide | null>(null)
    const [currentBackground, setCurrentBackground] = useState<ActiveBackground>({ type: 'none' })

    useEffect(() => {
        // Listen for updates from main process
        const removeListener = window.ipcRenderer.on('update-output', (data: string) => {
            try {
                // Handle legacy string commands
                if (data === '__BLACK__') {
                    setCurrentSlide(null)
                    setCurrentBackground({ type: 'none' })
                    // Or maybe keep background black? Requirement says 'Black' usually means everything black
                    return
                }
                if (data === '__LOGO__') {
                    // Implement logo logic if needed, for now just clear text
                    setCurrentSlide(null)
                    return
                }
                if (data === '') {
                    setCurrentSlide(null)
                    // Assuming clearText behavior for empty string if not specified
                    return
                }

                // Parse new JSON structure
                const parsed = JSON.parse(data)

                // Check if it's the new complex state object
                if (parsed.type === 'state-update') {
                    const state = parsed as OutputState
                    setCurrentSlide(state.slide)
                    setCurrentBackground(state.background || { type: 'none' })
                } else {
                    // Legacy: it's just a Slide object
                    // In legacy mode, slide background was part of slide
                    const slide = parsed as Slide
                    setCurrentSlide(slide)
                    if (slide.backgroundUrl) {
                        setCurrentBackground({
                            type: slide.type === 'video' ? 'video' : 'image',
                            url: slide.backgroundUrl
                        })
                    }
                    // If legacy slide has no background, we might keep previous? 
                    // But legacy behavior was usually replacement. 
                    // Let's assume strict replacement for legacy to avoid confusion.
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
            <div className="absolute inset-0 z-0">
                {currentBackground.type === 'image' && currentBackground.url && (
                    <img
                        src={currentBackground.url}
                        alt="Background"
                        className="w-full h-full object-cover"
                    />
                )}
                {currentBackground.type === 'video' && currentBackground.url && (
                    <video
                        key={currentBackground.url} // Re-mount if URL changes to ensure autoplay
                        src={currentBackground.url}
                        className="w-full h-full object-cover"
                        autoPlay
                        loop
                        muted // Output usually carries audio, but for background loop usually muted or handled separately. Let's mutate for now unless requested.
                    />
                )}
            </div>

            {/* Layer 2: Text/Slide Content */}
            <div className="absolute inset-0 z-10">
                {currentSlide && (
                    <ScaledSlide
                        slide={currentSlide}
                        width={window.innerWidth}
                        height={window.innerHeight}
                        // Pass transparent background to ScaledSlide so it doesn't cover our Layer 1
                        overrideStyle={{ backgroundColor: 'transparent', backgroundImage: 'none' }}
                    />
                )}
            </div>
        </div>
    )
}

export default OutputDisplay
