import type { Slide, GlobalSlideStyle } from '../types'

interface SlideRendererProps {
    slide: Slide | null
    className?: string
    scale?: number // Scale factor for preview (e.g., 0.2 for small preview)
    globalSlideStyle?: GlobalSlideStyle
}

const SlideRenderer: React.FC<SlideRendererProps> = ({ slide, className = '', scale, globalSlideStyle }) => {
    if (!slide) {
        return (
            <div className={`w-full h-full bg-black ${className}`} />
        )
    }

    // Text shadow for better readability over backgrounds
    const textShadowStyle = {
        textShadow: '2px 2px 4px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.9), 0 0 40px rgba(0,0,0,0.7)',
    }

    // For scaled preview, we render at "virtual" full size then scale down
    const innerStyle = scale ? {
        width: `${100 / scale}%`,
        height: `${100 / scale}%`,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
    } : {}

    const content = (
        <>
            {/* Background Layer (Layer 1) */}
            {slide.backgroundUrl && (
                <>
                    {slide.type === 'image' && (
                        <img
                            src={slide.backgroundUrl}
                            alt="Slide background"
                            className="absolute inset-0 w-full h-full object-cover"
                        />
                    )}
                    {slide.type === 'video' && (
                        <video
                            src={slide.backgroundUrl}
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="absolute inset-0 w-full h-full object-cover"
                        />
                    )}
                </>
            )}

            {/* Fallback background color */}
            {!slide.backgroundUrl && (
                <div
                    className="absolute inset-0"
                    style={{ backgroundColor: slide.styles?.backgroundColor || '#000000' }}
                />
            )}

            {/* Background Dimmer Layer */}
            {(() => {
                const useCustomStyle = slide.styles?.useCustomStyle === true;
                const dimValue = (useCustomStyle && slide.styles?.backgroundDim !== undefined)
                    ? slide.styles.backgroundDim
                    : globalSlideStyle?.backgroundDim || 0;

                if (dimValue > 0) {
                    return (
                        <div
                            className="absolute inset-0 z-0 pointer-events-none"
                            style={{ backgroundColor: `rgba(0, 0, 0, ${dimValue})` }}
                        />
                    );
                }
                return null;
            })()}

            {/* Text Layer (Layer 2) */}
            {slide.content && (
                <div className="relative z-10 w-full h-full flex items-center justify-center p-8">
                    <p
                        className="text-center whitespace-pre-wrap leading-tight"
                        style={{
                            fontSize: slide.styles?.fontSize || '4rem',
                            color: slide.styles?.color || '#ffffff',
                            fontWeight: slide.styles?.fontWeight || 'bold',
                            textAlign: slide.styles?.textAlign || 'center',
                            fontFamily: slide.styles?.fontFamily || 'inherit',
                            ...textShadowStyle,
                        }}
                    >
                        {slide.content}
                    </p>
                </div>
            )}
        </>
    )

    // If scale is provided, wrap in a scaled container
    if (scale) {
        return (
            <div className={`relative w-full h-full overflow-hidden ${className}`}>
                <div className="relative w-full h-full" style={innerStyle}>
                    {content}
                </div>
            </div>
        )
    }

    return (
        <div className={`relative w-full h-full overflow-hidden ${className}`}>
            {content}
        </div>
    )
}

export default SlideRenderer
