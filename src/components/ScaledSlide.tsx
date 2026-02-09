import React, { useRef, useEffect, useState } from 'react'
import type { Slide, BibleStyle } from '../types'

interface ScaledSlideProps {
    slide: Slide
    width?: number
    height?: number
    scale?: number
    overrideStyle?: React.CSSProperties
    bibleStyleOverride?: BibleStyle // New prop
}

const ScaledSlide: React.FC<ScaledSlideProps> = ({ slide, width, height, scale: manualScale, overrideStyle, bibleStyleOverride }) => {
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
    const isBible = slide.type === 'bible'

    // Determine effective styles (Priority: Bible Global > Slide Local > Default)
    // Actually, user wants Global to OVERRIDE everything for Bible slides.
    const effectiveBibleStyle = bibleStyleOverride || {
        fontSize: 60,
        fontColor: '#ffffff',
        bgColor: '#1e3a8a',
        align: 'center',
        verticalAlign: 'center'
    } as BibleStyle

    // Prepare background style
    const defaultBibleBg = effectiveBibleStyle.bgColor

    const backgroundStyle = overrideStyle?.backgroundColor ? {} : {
        backgroundColor: slideStyles.backgroundColor || (isBible ? defaultBibleBg : '#000000'),
        backgroundImage: slide.backgroundUrl && !overrideStyle?.backgroundImage ? `url(${slide.backgroundUrl})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
    }

    // Prepare Text Styles
    const fontSize = isBible ? `${effectiveBibleStyle.fontSize}px` : (slideStyles.fontSize || '4rem')
    const color = isBible ? effectiveBibleStyle.fontColor : (slideStyles.color || '#ffffff')
    const textAlign = isBible ? effectiveBibleStyle.align : (slideStyles.textAlign || 'center')

    // Prepare Flex Alignment
    let justifyContent = 'center'
    let alignItems = 'center'

    if (isBible) {
        // Horizontal Alignment (Cross Axis in Column) -> alignItems
        if (effectiveBibleStyle.align === 'left') alignItems = 'flex-start'
        if (effectiveBibleStyle.align === 'center') alignItems = 'center'
        if (effectiveBibleStyle.align === 'right') alignItems = 'flex-end'

        // Vertical Alignment (Main Axis in Column) -> justifyContent
        if (effectiveBibleStyle.verticalAlign === 'top') justifyContent = 'flex-start'
        if (effectiveBibleStyle.verticalAlign === 'center') justifyContent = 'center'
        if (effectiveBibleStyle.verticalAlign === 'bottom') justifyContent = 'flex-end'
    } else {
        // Default text centering
        if (slideStyles.textAlign === 'left') justifyContent = 'flex-start' // Actually textAlign handles text, but flex handles container? 
        // For standard slides, we usually center the block.
        // Let's keep existing logic for non-bible
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
                    justifyContent, // Applied here
                    alignItems,     // Applied here
                    position: 'relative',
                    padding: isBible ? '60px' : '0', // Add padding for Bible slides to avoid edge
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

                {/* Bible Reference (Top Left) - Only if not overridden by alignment? 
                    User asked for "Top Left Small Reference". 
                    If we align content to bottom right, reference should stay Top Left? 
                    Yes, absolutely positioned.
                */}
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
                        fontSize: fontSize,
                        color: color,
                        fontWeight: slideStyles.fontWeight || (isBible ? 'normal' : 'bold'),
                        textAlign: textAlign,
                        fontFamily: slideStyles.fontFamily || (isBible ? '"Batang", "Times New Roman", serif' : 'sans-serif'),
                        whiteSpace: 'pre-wrap',
                        zIndex: 10,
                        width: '98%', // Use full width for text container
                        maxWidth: '98%',
                        textShadow: '2px 2px 4px rgba(0,0,0,0.7)',
                        lineHeight: isBible ? 1.6 : 1.2,
                    }}
                >
                    {slide.content}
                </div>
            </div>
        </div>
    )
}

export default ScaledSlide
