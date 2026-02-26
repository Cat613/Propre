import React, { useRef, useEffect, useState } from 'react'
import type { Slide, TextElement } from '../types'

interface ScaledSlideProps {
    slide: Slide
    width?: number
    height?: number
    scale?: number
    overrideStyle?: React.CSSProperties
    globalStyleOverride?: import('../types').GlobalSlideStyle
    disableDimOverlay?: boolean
    isGreenScreen?: boolean
}

const ScaledSlide: React.FC<ScaledSlideProps> = ({ slide, width, height, scale: manualScale, overrideStyle, globalStyleOverride, disableDimOverlay, isGreenScreen }) => {
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

    // Auto-fit text logic (Optimized using Binary Search)
    useEffect(() => {
        // Reset autoFontSize when content or default styles change
        setAutoFontSize(null)
    }, [slide.content, globalStyleOverride, slide.styles?.fontSize])

    useEffect(() => {
        if (!textRef.current || !containerRef.current || slide.type !== 'bible') return

        const el = textRef.current
        const isBible = slide.type === 'bible'
        const padding = isBible ? 120 : 0
        const maxHeight = 1080 - padding

        const checkAndFit = () => {
            // Only run if we overflow
            if (el.scrollHeight <= maxHeight) return

            // Binary search for optimal font size
            let min = 10
            let max = parseFloat(window.getComputedStyle(el).fontSize) || 100
            let best = min

            while (min <= max) {
                const mid = Math.floor((min + max) / 2)
                el.style.fontSize = `${mid}px`

                if (el.scrollHeight <= maxHeight) {
                    best = mid
                    min = mid + 1 // try a larger size
                } else {
                    max = mid - 1 // try a smaller size
                }
            }

            // Clean up inline style and let React state take over
            el.style.fontSize = ''
            setAutoFontSize(best)
        }

        // Run immediately
        checkAndFit()

        // And listen for dynamic resizes (e.g if text wraps differently based on flex containers)
        const observer = new ResizeObserver(() => checkAndFit())
        observer.observe(el)

        return () => observer.disconnect()
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
        backgroundImage: slide.backgroundUrl && !overrideStyle?.backgroundImage ? `url("${slide.backgroundUrl.replace(/\\/g, '/')}")` : undefined,
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
                        autoPlay
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
                        style={{
                            textShadow: isGreenScreen ? '0px 4px 10px rgba(0,0,0,0.8)' : '2px 2px 4px rgba(0,0,0,0.5)',
                            WebkitTextStroke: isGreenScreen ? '2px black' : undefined
                        }}
                    >
                        {slide.bibleReference}
                    </div>
                )}

                {/* Dynamic Elements Render (Phase 3) */}
                {slide.elements && slide.elements.length > 0 ? (
                    slide.elements.map(element => {
                        const style: React.CSSProperties = {
                            position: 'absolute',
                            left: typeof element.x === 'number' && element.x <= 100 ? `${element.x}%` : `${element.x}px`,
                            top: typeof element.y === 'number' && element.y <= 100 ? `${element.y}%` : `${element.y}px`,
                            width: typeof element.width === 'number' && element.width <= 100 ? `${element.width}%` : `${element.width}px`,
                            height: typeof element.height === 'number' && element.height <= 100 ? `${element.height}%` : `${element.height}px`,
                            zIndex: element.zIndex,
                            opacity: element.opacity !== undefined ? element.opacity : 1,
                            transform: element.rotation ? `rotate(${element.rotation}deg)` : 'none',
                        }

                        if (element.type === 'text') {
                            const textEl = element as TextElement
                            const tStyles = textEl.styles || {}
                            const eUseCustom = tStyles.useCustomStyle === true

                            style.fontSize = eUseCustom && tStyles.fontSize ? tStyles.fontSize : `${effectiveGlobalStyle.fontSize}px`
                            style.color = eUseCustom && tStyles.color ? tStyles.color : effectiveGlobalStyle.fontColor

                            const hAlign = eUseCustom && tStyles.textAlign ? tStyles.textAlign : effectiveGlobalStyle.align
                            const vAlign = effectiveGlobalStyle.verticalAlign

                            let justifyContent = 'flex-start'
                            let alignItems = 'flex-start'

                            if (hAlign === 'left') alignItems = 'flex-start'
                            if (hAlign === 'center') alignItems = 'center'
                            if (hAlign === 'right') alignItems = 'flex-end'

                            if (vAlign === 'top') justifyContent = 'flex-start'
                            if (vAlign === 'center') justifyContent = 'center'
                            if (vAlign === 'bottom') justifyContent = 'flex-end'

                            style.display = 'flex'
                            style.flexDirection = 'column'
                            style.justifyContent = justifyContent
                            style.alignItems = alignItems
                            style.textAlign = hAlign

                            style.fontFamily = eUseCustom && tStyles.fontFamily ? tStyles.fontFamily : effectiveGlobalStyle.fontFamily
                            style.fontWeight = tStyles.fontWeight || (isBible ? 'normal' : 'bold')
                            style.whiteSpace = 'pre-wrap'

                            // Use explicit drop shadow or stroke based on new custom toggles, 
                            // fallback to isGreenScreen defaults if standard behavior is desired.
                            const hasShadow = eUseCustom ? tStyles.textShadow : true;
                            const hasStroke = eUseCustom ? tStyles.textOutline : isGreenScreen;

                            if (hasShadow) {
                                style.textShadow = isGreenScreen ? '0px 4px 10px rgba(0,0,0,0.8)' : '2px 2px 4px rgba(0,0,0,0.7)';
                            }

                            if (hasStroke) {
                                style.WebkitTextStroke = isGreenScreen ? '3px black' : '1px rgba(0,0,0,0.5)';
                            }

                            style.lineHeight = isBible ? 1.6 : 1.2
                            if (tStyles.backgroundColor) style.backgroundColor = tStyles.backgroundColor

                            return (
                                <div key={element.id} style={style}>
                                    {textEl.text}
                                </div>
                            )
                        } else if (element.type === 'image' || element.type === 'video') {
                            return (
                                <div key={element.id} style={style}>
                                    <img
                                        src={(element as any).url}
                                        style={{ width: '100%', height: '100%', objectFit: (element as any).objectFit || 'contain' }}
                                        alt="Media Element"
                                    />
                                </div>
                            )
                        } else if (element.type === 'shape') {
                            const shapeEl = element as import('../types').ShapeElement
                            return (
                                <div key={element.id} style={{
                                    ...style,
                                    backgroundColor: shapeEl.backgroundColor || 'transparent',
                                    border: shapeEl.borderWidth ? `${shapeEl.borderWidth}px solid ${shapeEl.borderColor || '#fff'}` : 'none',
                                    borderRadius: shapeEl.shapeType === 'ellipse' ? '50%' : '0'
                                }} />
                            )
                        }

                        return null
                    })
                ) : (
                    /* Content (Legacy Backward Compatibility) */
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
                            textShadow: isGreenScreen ? '0px 4px 10px rgba(0,0,0,0.8)' : '2px 2px 4px rgba(0,0,0,0.7)',
                            WebkitTextStroke: isGreenScreen ? '3px black' : undefined,
                            lineHeight: isBible ? 1.6 : 1.2,
                        }}
                    >
                        {slide.content}
                    </div>
                )}
            </div>
        </div>
    )
}

export default ScaledSlide
