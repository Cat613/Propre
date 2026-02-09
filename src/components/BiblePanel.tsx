import { useState, useEffect } from 'react'
import { BibleService, type BibleBook, type BibleVerse } from '../services/BibleService'
import { usePresentationStore } from '../store'
import type { Slide } from '../types'

const BiblePanel: React.FC = () => {
    const { setActiveSlide } = usePresentationStore()

    const [books, setBooks] = useState<BibleBook[]>([])
    const [selectedBook, setSelectedBook] = useState<string>('')
    const [chapter, setChapter] = useState<number>(1)
    const [verses, setVerses] = useState<BibleVerse[]>([])
    const [isLoading, setIsLoading] = useState(false)

    useEffect(() => {
        const loadBooks = async () => {
            const data = await BibleService.getBooks()
            setBooks(data)
            if (data.length > 0) setSelectedBook(data[0].id)
        }
        loadBooks()
    }, [])

    const handleSearchAndLoad = async () => {
        if (!selectedBook) return
        setIsLoading(true)
        try {
            const data = await BibleService.getVerses(selectedBook, chapter)
            setVerses(data)

            // Convert to slides and load into editor
            const newSlides: Slide[] = data.map(v => ({
                id: crypto.randomUUID(),
                type: 'bible',
                content: v.content,
                bibleReference: v.reference,
                // styles: { fontSize: '3.5rem', fontFamily: 'serif' } // Handled by ScaledSlide defaults now
            }))

            // Replace main grid with bible slides
            // NOTE: This clears current song edit state, but user is in "Bible Mode" workflow
            usePresentationStore.getState().setSlides(newSlides)

        } finally {
            setIsLoading(false)
        }
    }

    const handleVerseClick = (idx: number) => {
        // Check if the current slides in store match what we expect (i.e., user hasn't switched songs yet)
        // Actually, if we just set specific slide ID active, it works if the slide exists in the store.
        const slides = usePresentationStore.getState().slides
        // We assume the order is preserved or we can find by content/reference match if needed.
        // But since we loaded them, index should match unless reordered.
        if (slides[idx]) {
            setActiveSlide(slides[idx].id)
        } else {
            // Fallback: If for some reason grid changed, maybe re-load?
            // Or just ignore.
            console.warn("Slide not found in grid, maybe context switched?")
        }
    }

    return (
        <div className="flex flex-col h-full">
            {/* Search Controls */}
            <div className="p-3 bg-gray-900 border-b border-gray-800 space-y-2">
                <div className="flex gap-2">
                    <select
                        className="flex-1 bg-gray-800 text-sm text-white border border-gray-700 rounded px-2 py-1 focus:border-blue-500 outline-none"
                        value={selectedBook}
                        onChange={(e) => setSelectedBook(e.target.value)}
                    >
                        {books.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                    <input
                        type="number"
                        min="1"
                        className="w-16 bg-gray-800 text-sm text-white border border-gray-700 rounded px-2 py-1 focus:border-blue-500 outline-none"
                        value={chapter}
                        onChange={(e) => setChapter(parseInt(e.target.value))}
                    />
                </div>
                <button
                    onClick={handleSearchAndLoad}
                    disabled={isLoading}
                    className="w-full bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold py-1.5 rounded disabled:opacity-50 transition-colors"
                >
                    {isLoading ? 'Loading...' : 'Search & Load'}
                </button>
            </div>

            {/* Verses List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {verses.length === 0 ? (
                    <div className="text-gray-500 text-xs text-center mt-4">
                        검색하여 말씀을 불러오세요
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
                            <p className="opacity-80 line-clamp-2 text-xs">{verse.content}</p>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

export default BiblePanel
