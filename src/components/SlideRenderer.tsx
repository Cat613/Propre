import ScaledSlide from './ScaledSlide'
import type { Slide, GlobalSlideStyle } from '../types'
interface Props {
  slide: Slide | null
  className?: string
  scale?: number
  globalSlideStyle?: GlobalSlideStyle
}
export default function SlideRenderer({ slide, className = '', scale, globalSlideStyle }: Props) {
  return (
    <div className={`h-full w-full bg-black ${className}`}>
      {slide && <ScaledSlide slide={slide} scale={scale} globalStyleOverride={globalSlideStyle} />}
    </div>
  )
}
