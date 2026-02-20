import { useState } from 'react'
import { BibleService, type BibleVerse } from '../services/BibleService'
import { usePresentationStore } from '../store'
import type { Slide } from '../types'
import { parseBibleQuery } from '../utils/bibleParser'

const BiblePanel: React.FC = () => {
    const { setActiveSlide, bibleStyle, updateBibleStyle, setSlides } = usePresentationStore()

    const [query, setQuery] = useState('')
    const [verses, setVerses] = useState<BibleVerse[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)

    const handleSearch = async (e?: React.FormEvent) => {
        e?.preventDefault()
        if (!query.trim()) return

        const parsed = parseBibleQuery(query)

        if (!parsed.bookId || !parsed.chapter) {
            alert("올바른 형식이 아닙니다 (예: 창 1, 요 3:16)")
            return
        }

        setIsLoading(true)
        try {
            const data = await BibleService.getVerses(parsed.bookId, parsed.chapter)

            // Filter by verse range if specified in query
            let resultVerses = data
            if (parsed.verseStart !== null && parsed.verseEnd !== null) {
                resultVerses = data.filter(v => {
                    // Clean reference: "창 1:1" -> split : -> 1
                    const [_, vNum] = v.reference.split(':')
                    const verseNum = parseInt(vNum)
                    return verseNum >= parsed.verseStart! && verseNum <= parsed.verseEnd!
                })
            }

            setVerses(resultVerses)

            const newSlides: Slide[] = resultVerses.map(v => ({
                id: crypto.randomUUID(),
                type: 'bible',
                content: v.content,
                bibleReference: v.reference,
            }))

            setSlides(newSlides)

        } catch (e) {
            console.error(e)
            alert("성경 데이터를 불러오는데 실패했습니다.")
        } finally {
            setIsLoading(false)
        }
    }

    const handleVerseClick = (idx: number) => {
        const slides = usePresentationStore.getState().slides
        if (slides[idx]) {
            setActiveSlide(slides[idx].id)
        }
    }

    return (
        <div className="flex flex-col h-full">
            {/* Style Settings Toggle */}
            <div className="bg-gray-900 border-b border-gray-800 px-3 py-1">
                <button
                    onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                    className="text-[10px] text-gray-500 hover:text-gray-300 flex items-center gap-1 w-full justify-center"
                >
                    {isSettingsOpen ? 'Hide Styles ▲' : 'Show Bible Styles ▼'}
                </button>
            </div>

            {/* Style Panel */}
            {isSettingsOpen && (
                <div className="p-3 bg-gray-800 border-b border-gray-700 space-y-3">
                    {/* Font Size */}
                    <div className="space-y-1">
                        <label className="text-[10px] text-gray-400">Font Size: {bibleStyle.fontSize}px</label>
                        <input
                            type="range" min="30" max="150"
                            value={bibleStyle.fontSize}
                            onChange={(e) => updateBibleStyle({ fontSize: parseInt(e.target.value) })}
                            className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                        />
                    </div>

                    {/* Alignment */}
                    <div className="flex justify-between items-center text-gray-300 text-xs">
                        <span>H-Align:</span>
                        <div className="flex bg-gray-700 rounded overflow-hidden">
                            {(['left', 'center', 'right'] as const).map(align => (
                                <button
                                    key={align}
                                    onClick={() => updateBibleStyle({ align })}
                                    className={`px-2 py-1 ${bibleStyle.align === align ? 'bg-blue-600 text-white' : 'hover:bg-gray-600'}`}
                                >
                                    {align[0].toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex justify-between items-center text-gray-300 text-xs">
                        <span>V-Align:</span>
                        <div className="flex bg-gray-700 rounded overflow-hidden">
                            {(['top', 'center', 'bottom'] as const).map(align => (
                                <button
                                    key={align}
                                    onClick={() => updateBibleStyle({ verticalAlign: align })}
                                    className={`px-2 py-1 ${bibleStyle.verticalAlign === align ? 'bg-blue-600 text-white' : 'hover:bg-gray-600'}`}
                                >
                                    {align[0].toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Colors */}
                    <div className="flex gap-2">
                        <div className="flex-1 space-y-1">
                            <label className="text-[10px] text-gray-400 block">Text</label>
                            <input
                                type="color"
                                value={bibleStyle.fontColor}
                                onChange={(e) => updateBibleStyle({ fontColor: e.target.value })}
                                className="w-full h-6 rounded cursor-pointer"
                            />
                        </div>
                        <div className="flex-1 space-y-1">
                            <label className="text-[10px] text-gray-400 block">Bg</label>
                            <input
                                type="color"
                                value={bibleStyle.bgColor}
                                onChange={(e) => updateBibleStyle({ bgColor: e.target.value })}
                                className="w-full h-6 rounded cursor-pointer"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Search Input */}
            <div className="p-3 bg-gray-900 border-b border-gray-800">
                <form onSubmit={handleSearch} className="flex gap-2">
                    <input
                        type="text"
                        className="flex-1 bg-gray-800 text-white border border-gray-700 rounded px-3 py-2 focus:border-blue-500 outline-none text-sm placeholder-gray-500"
                        placeholder="예: 요 3:16, 창 1"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="bg-blue-700 hover:bg-blue-600 text-white font-bold px-4 py-2 rounded text-sm disabled:opacity-50"
                    >
                        Go
                    </button>
                </form>
            </div>

            {/* Verses List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {verses.length === 0 ? (
                    <div className="text-gray-500 text-xs text-center mt-4">
                        {isLoading ? '검색 중...' : '말씀을 검색하세요 (Enter)'}
                    </div>
                ) : (
                    verses.map((verse, idx) => (
                        <div
                            key={idx}
                            onClick={() => handleVerseClick(idx)}
                            className="p-2 rounded hover:bg-gray-700 cursor-pointer text-gray-300 text-sm group transition-colors"
                        >
                            <div className="flex gap-2 mb-1">
                                <span className="font-bold text-yellow-500 text-xs">{verse.reference}</span>
                            </div>
                            <p className="opacity-80 line-clamp-2 text-xs font-serif">{verse.content}</p>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

export default BiblePanel
