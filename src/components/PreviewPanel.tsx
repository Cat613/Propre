import { useEffect, useRef, useState } from 'react'
import ScaledSlide from './ScaledSlide'
import { usePresentationStore } from '../store'

const PreviewPanel: React.FC = () => {
    const { slides, activeSlideId, activeBackground } = usePresentationStore()
    const activeSlide = slides.find((s) => s.id === activeSlideId)

    // Combine logic for Preview:
    // Preview should show what's on output.
    // Output relies on OutputDisplay logic which layers background and text.
    // We need to simulate that layering here.

    return (
        <div className="p-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                미리보기 (Output)
            </h2>
            <div className="aspect-video bg-black rounded-lg overflow-hidden border border-gray-700 shadow-xl relative">
                {/* Layer 1: Background */}
                <div className="absolute inset-0 z-0">
                    {activeBackground.type === 'image' && activeBackground.url && (
                        <img
                            src={activeBackground.url}
                            alt="Background"
                            className="w-full h-full object-cover"
                        />
                    )}
                    {activeBackground.type === 'video' && activeBackground.url && (
                        <video
                            src={activeBackground.url}
                            className="w-full h-full object-cover"
                            muted // Preview always muted
                            autoPlay
                            loop
                        />
                    )}
                </div>

                {/* Layer 2: Slide Content */}
                {activeSlide ? (
                    <div className="absolute inset-0 z-10">
                        <ScaledSlide
                            slide={activeSlide}
                            overrideStyle={{ backgroundColor: 'transparent', backgroundImage: 'none' }}
                        />
                    </div>
                ) : (
                    <div className="absolute inset-0 z-10 flex items-center justify-center">
                        {/* If no slide but background exists, just show background. If neither, show logo or blank */}
                        {!activeBackground.type || activeBackground.type === 'none' ? (
                            <div className="text-gray-600 font-bold text-xl opacity-20 select-none">
                                OUTPUT IS CLEAR
                            </div>
                        ) : null}
                    </div>
                )}
            </div>

            <div className="mt-4 px-2 py-2 bg-gray-800 rounded-lg">
                <h3 className="text-xs font-semibold text-gray-400 mb-1">현재 상태</h3>
                <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                        <span className="text-gray-500">슬라이드:</span>
                        <span className={activeSlideId ? "text-green-400" : "text-gray-500"}>
                            {activeSlideId ? "Active" : "Cleared"}
                        </span>
                    </div>
                    <div className="flex justify-between text-xs">
                        <span className="text-gray-500">배경:</span>
                        <span className={activeBackground.type !== 'none' ? "text-blue-400" : "text-gray-500"}>
                            {activeBackground.type !== 'none' ? activeBackground.type.toUpperCase() : "None"}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default PreviewPanel
