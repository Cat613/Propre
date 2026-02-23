import React, { useState, useEffect } from 'react'
import { usePresentationStore } from '../store'
import type { Slide } from '../types'

interface BulkEditModalProps {
    isOpen: boolean
    onClose: () => void
    initialTextOverride?: string
}

const BulkEditModal: React.FC<BulkEditModalProps> = ({ isOpen, onClose, initialTextOverride }) => {
    const { slides, setSlides, activeSlideId, setActiveSlide } = usePresentationStore()
    const [text, setText] = useState('')

    // Initialize text area when modal opens
    useEffect(() => {
        if (isOpen) {
            if (initialTextOverride) {
                setText(initialTextOverride)
            } else {
                const joinedText = slides.map(s => s.content).join('\n\n')
                setText(joinedText)
            }
        }
    }, [isOpen, slides, initialTextOverride])

    const handleSave = () => {
        // Split by double newline (or more), ignoring whitespace-only blocks if needed,
        // but keeping empty blocks if user specifically leaves exact empty lines.
        // A robust split is by \n\n. We'll trim each block so trailing spaces don't create false slides.
        const blocks = text.split(/\n\s*\n/).map(b => b.trim())

        const newSlides: Slide[] = []

        for (let i = 0; i < blocks.length; i++) {
            const blockContent = blocks[i]

            // Skip completely empty blocks if they occur at the very end
            if (!blockContent && i === blocks.length - 1) continue

            if (i < slides.length) {
                // Overwrite existing slide, preserving everything else (backgrounds, types)
                newSlides.push({
                    ...slides[i],
                    content: blockContent
                })
            } else {
                // Create a completely new text slide
                newSlides.push({
                    id: crypto.randomUUID(),
                    content: blockContent,
                    type: 'text',
                    styles: {},
                    label: 'None',
                    labelColor: 'transparent'
                })
            }
        }

        // If the new slides count is less than existing slides, the remaining are naturally truncated (deleted).

        setSlides(newSlides)

        // If active cursor is now out of bounds (because we deleted slides), clear it
        if (activeSlideId) {
            const stillExists = newSlides.find(s => s.id === activeSlideId)
            if (!stillExists) {
                setActiveSlide(null)
            }
        }

        onClose()
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col border border-gray-700">

                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b border-gray-800">
                    <div>
                        <h2 className="text-lg font-bold text-white">일괄 텍스트 편집 (Bulk Edit)</h2>
                        <p className="text-xs text-gray-400 mt-1">슬라이드 구분은 빈 줄바꿈 (엔터 두 번)으로 인식됩니다.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Editor Body */}
                <div className="flex-1 p-4 bg-gray-800 overflow-hidden">
                    <textarea
                        className="w-full h-full bg-gray-900 text-white p-4 rounded outline-none border border-gray-700 focus:border-blue-500 resize-none font-sans leading-relaxed text-sm shadow-inner"
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder="이곳에 슬라이드 텍스트를 입력하거나 붙여넣으세요. 빈 줄바꿈으로 슬라이드가 나뉩니다."
                    />
                </div>

                {/* Footer Actions */}
                <div className="p-4 border-t border-gray-800 flex justify-end gap-2 bg-gray-900 rounded-b-xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded font-medium text-sm text-gray-300 hover:bg-gray-800 transition-colors"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-6 py-2 rounded font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-lg"
                    >
                        일괄 적용 및 저장
                    </button>
                </div>
            </div>
        </div>
    )
}

export default BulkEditModal
