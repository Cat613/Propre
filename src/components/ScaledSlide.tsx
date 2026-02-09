import React, { useRef, useEffect, useState } from 'react'
import type { Slide } from '../types'

interface ScaledSlideProps {
    slide: Slide
    width?: number
    height?: number
    scale?: number
    overrideStyle?: React.CSSProperties
}

const ScaledSlide: React.FC<ScaledSlideProps> = ({ slide, width, height, scale: manualScale, overrideStyle }) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const [scale, setScale] = useState(1)

    useEffect(() => {
        if (manualScale) {
            setScale(manualScale)
            return
        }

        const updateScale = () => {
            if (containerRef.current && containerRef.current.parentElement) {
                const parent = containerRef.current.parentElement
                const parentWidth = width || parent.clientWidth
                const parentHeight = height || parent.clientHeight

                // Target 16:9 Aspect Ratio
                const targetRatio = 16 / 9
                const parentRatio = parentWidth / parentHeight

                let newScale
                if (parentRatio > targetRatio) {
                    newScale = parentHeight / 1080
                } else {
                    newScale = parentWidth / 1920
                }
                setScale(newScale)
            }
        }

        updateScale()
        window.addEventListener('resize', updateScale)
        return () => window.removeEventListener('resize', updateScale)
    }, [width, height, manualScale])

    // Default styles from slide
    const slideStyles = slide.styles || {}

    // Bible Styling Override
    const isBible = slide.type === 'bible'

    // Prepare background style - if overrideStyle provides transparent, use it
    // If bible type and no background set, use default bible background
    const defaultBibleBg = '#1e3a8a' // Dark Blue (blue-900 like)

    const backgroundStyle = overrideStyle?.backgroundColor ? {} : {
        backgroundColor: slideStyles.backgroundColor || (isBible ? defaultBibleBg : '#000000'),
        backgroundImage: slide.backgroundUrl && !overrideStyle?.backgroundImage ? `url(${slide.backgroundUrl})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
    }

    return (
        <div
            className="flex items-center justify-center w-full h-full overflow-hidden"
            ref={containerRef}
        >
            <div
                style={{
                    width: 1920,
                    height: 1080,
                    flexShrink: 0,
                    transform: `scale(${scale})`,
                    transformOrigin: 'center center',
                    ...backgroundStyle,
                    ...overrideStyle, // Apply overrides last
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    position: 'relative',
                }}
            >
                {/* Video Layer */}
                {slide.type === 'video' && slide.backgroundUrl && !overrideStyle?.backgroundImage && (
                    <video
                        src={slide.backgroundUrl}
                        className="absolute inset-0 w-full h-full object-cover z-0"
                        muted
                        loop
                    />
                )}

                {/* Bible Reference (Top Left) */}
                {isBible && slide.bibleReference && (
                    <div
                        className="absolute top-16 left-20 text-yellow-500 font-serif font-bold text-5xl z-20"
                        style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.5)' }}
                    >
                        {slide.bibleReference}
                    </div>
                )}

                {/* Content */}
                <div
                    style={{
                        fontSize: slideStyles.fontSize || (isBible ? '3.5rem' : '4rem'),
                        color: slideStyles.color || '#ffffff',
                        fontWeight: slideStyles.fontWeight || (isBible ? 'normal' : 'bold'),
                        textAlign: slideStyles.textAlign || 'center',
                        fontFamily: slideStyles.fontFamily || (isBible ? '"Batang", "Times New Roman", serif' : 'sans-serif'),
                        whiteSpace: 'pre-wrap',
                        zIndex: 10,
                        width: '98%',
                        maxWidth: '98%',
                        textShadow: '2px 2px 4px rgba(0,0,0,0.7)',
                        lineHeight: isBible ? 1.6 : 1.2
                    }}
                >
                    {slide.content}
                </div>
            </div>
        </div>
    )
}

export default ScaledSlide
