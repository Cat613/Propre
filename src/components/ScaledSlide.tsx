import React, { useRef, useEffect, useState } from 'react'
import type { Slide } from '../types'

interface ScaledSlideProps {
    slide: Slide
    width?: number
    height?: number
    scale?: number
    overrideStyle?: React.CSSProperties
    globalStyleOverride?: import('../types').GlobalSlideStyle
    disableDimOverlay?: boolean
}

const ScaledSlide: React.FC<ScaledSlideProps> = ({ slide, width, height, scale: manualScale, overrideStyle, globalStyleOverride, disableDimOverlay }) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const textRef = useRef<HTMLDivElement>(null)
    const [scale, setScale] = useState(1)
    const [autoFontSize, setAutoFontSize] = useState<number | null>(null)

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

    // Auto-fit text logic
    useEffect(() => {
        // Reset autoFontSize when content or default styles change
        setAutoFontSize(null)
    }, [slide.content, globalStyleOverride, slide.styles?.fontSize])

    useEffect(() => {
        if (!textRef.current || !containerRef.current) return

        const checkOverflow = () => {
            const textEl = textRef.current
            if (!textEl) return

            // Check if text element's scrollHeight exceeds its clientHeight
            // Since our textEl has no fixed height but its parent (the 1920x1080 slide) does,
            // we should measure against the available height. 
            // In our layout, the text container is allowed to grow, so we check if it exceeds 1080 (minus padding).
            const isBible = slide.type === 'bible'
            const padding = isBible ? 120 : 0 // 60px padding top and bottom
            const maxHeight = 1080 - padding

            if (textEl.scrollHeight > maxHeight) {
                // It overflows, we need to shrink font
                const currentFontSizeStr = window.getComputedStyle(textEl).fontSize
                const currentSize = parseFloat(currentFontSizeStr)

                if (currentSize > 10) { // arbitrary minimum size
                    setAutoFontSize(currentSize * 0.9) // Reduce by 10%
                }
            }
        }

        // Run overflow check
        checkOverflow()
    }, [slide.content, scale, autoFontSize, slide.type])

    // Default styles from slide
    const slideStyles = slide.styles || {}
    const isBible = slide.type === 'bible'

    // Determine effective styles (Priority: Slide Local > Global Default)
    const effectiveGlobalStyle = globalStyleOverride || {
        fontSize: 60,
        fontColor: '#ffffff',
        fontFamily: 'sans-serif',
        align: 'center',
        verticalAlign: 'center'
    } as import('../types').GlobalSlideStyle

    // Check if the slide opts in to custom local styles
    const useCustomStyle = slideStyles.useCustomStyle === true

    const backgroundStyle = overrideStyle?.backgroundColor ? {} : {
        backgroundColor: slideStyles.backgroundColor || '#000000',
        backgroundImage: slide.backgroundUrl && !overrideStyle?.backgroundImage ? `url(${slide.backgroundUrl})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
    }

    // Default formatting uses global unless custom style applies
    const defaultFontSize = (useCustomStyle && slideStyles.fontSize) ? slideStyles.fontSize : `${effectiveGlobalStyle.fontSize}px`
    const finalFontSize = autoFontSize ? `${autoFontSize}px` : defaultFontSize

    const color = (useCustomStyle && slideStyles.color) ? slideStyles.color : effectiveGlobalStyle.fontColor
    const textAlign = (useCustomStyle && slideStyles.textAlign) ? slideStyles.textAlign : effectiveGlobalStyle.align

    // Prepare Flex Alignment based on global config or custom slide
    let justifyContent = 'center'
    let alignItems = 'center'

    const hAlign = useCustomStyle && slideStyles.textAlign ? slideStyles.textAlign : effectiveGlobalStyle.align
    const vAlign = effectiveGlobalStyle.verticalAlign

    if (hAlign === 'left') alignItems = 'flex-start'
    if (hAlign === 'center') alignItems = 'center'
    if (hAlign === 'right') alignItems = 'flex-end'

    if (vAlign === 'top') justifyContent = 'flex-start'
    if (vAlign === 'center') justifyContent = 'center'
    if (vAlign === 'bottom') justifyContent = 'flex-end'

    return (
        <div
            className="flex items-center justify-center w-full h-full overflow-hidden relative"
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

                {/* Background Dimmer Layer */}
                {!disableDimOverlay && (() => {
                    const dimValue = (useCustomStyle && slideStyles.backgroundDim !== undefined)
                        ? slideStyles.backgroundDim
                        : effectiveGlobalStyle.backgroundDim || 0;

                    if (dimValue > 0) {
                        return (
                            <div
                                className="absolute inset-0 w-full h-full z-0 pointer-events-none"
                                style={{ backgroundColor: `rgba(0, 0, 0, ${dimValue})` }}
                            />
                        );
                    }
                    return null;
                })()}

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
                    ref={textRef}
                    style={{
                        fontSize: finalFontSize,
                        color: color,
                        fontWeight: slideStyles.fontWeight || (isBible ? 'normal' : 'bold'),
                        textAlign: textAlign,
                        fontFamily: useCustomStyle && slideStyles.fontFamily ? slideStyles.fontFamily : effectiveGlobalStyle.fontFamily,
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
