import { usePresentationStore } from '../store'
import ScaledSlide from './ScaledSlide'

const PreviewPanel: React.FC = () => {
    const { activeSlideId, slides, globalSlideStyle, activeBackground } = usePresentationStore()

    const activeSlide = slides.find((s) => s.id === activeSlideId)

    return (
        <div className="h-full flex flex-col bg-gray-900 border-l border-gray-800">
            <div className="p-3 bg-gray-900 border-b border-gray-800">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    미리보기 (OUTPUT)
                </h2>
            </div>

            <div className="flex-1 p-4 flex items-center justify-center bg-gray-900 overflow-hidden">
                <div className="aspect-video w-full bg-black rounded-lg overflow-hidden shadow-2xl relative border border-gray-800">
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
                            if (!activeSlide) return null;
                            const useCustomStyle = activeSlide.styles?.useCustomStyle === true;
                            const dimValue = (useCustomStyle && activeSlide.styles?.backgroundDim !== undefined)
                                ? activeSlide.styles.backgroundDim
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
                                <span className={activeBackground.url ? "opacity-0" : ""}>송출 대기 중</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="p-4 bg-gray-800/50 border-t border-gray-800">
                <div className="space-y-2">
                    <div className="flex justify-between items-center text-xs text-gray-400">
                        <span className="font-bold text-gray-300">현재 상태</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-500">슬라이드:</span>
                        <span className={activeSlide ? 'text-green-400 font-bold' : 'text-gray-600'}>
                            {activeSlide ? 'Active' : 'Inactive'}
                        </span>
                    </div>
                    {/* Add more status detailed info if needed */}
                </div>
            </div>
        </div>
    )
}

export default PreviewPanel
