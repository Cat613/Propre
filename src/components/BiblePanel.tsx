import { useState, useRef, useEffect } from 'react'
import { BibleService, type BibleVerse } from '../services/BibleService'
import { usePresentationStore } from '../store'
import type { Slide } from '../types'
import { parseBibleQuery, BOOK_MAPPING } from '../utils/bibleParser'

interface BibleBookOption {
    fullName: string
    shortName: string
    display: string
}

// Extract a list of standard book names for autocomplete
const BIBLE_BOOKS: BibleBookOption[] = Object.entries(BOOK_MAPPING)
    .filter(([key, value]) => key !== value)
    .map(([fullName, shortName]) => ({
        fullName,
        shortName,
        display: `${fullName}(${shortName})`
    }))

const BiblePanel: React.FC = () => {
    const { setActiveSlide, setSlides } = usePresentationStore()

    const [query, setQuery] = useState('')
    const [verses, setVerses] = useState<BibleVerse[]>([])
    const [isLoading, setIsLoading] = useState(false)

    // Autocomplete state
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)
    const [filteredBooks, setFilteredBooks] = useState<BibleBookOption[]>([])
    const inputRef = useRef<HTMLInputElement>(null)
    const dropdownRef = useRef<HTMLUListElement>(null)

    // Handle clicking outside the dropdown to close it
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(e.target as Node) &&
                inputRef.current &&
                !inputRef.current.contains(e.target as Node)
            ) {
                setIsDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value
        setQuery(val)

        // Only show autocomplete if no numbers/spaces exist yet (meaning they are typing the book name)
        if (val && !/[\d\s]/.test(val)) {
            // Find books that contain the typed characters
            // Try prefix match first, then includes match
            const books = BIBLE_BOOKS.filter(b => b.fullName.includes(val) || b.shortName.includes(val))
            setFilteredBooks(books)
            setIsDropdownOpen(books.length > 0)
        } else if (!val) {
            // If empty, show full list
            setFilteredBooks(BIBLE_BOOKS)
            setIsDropdownOpen(true)
        } else {
            setIsDropdownOpen(false)
        }
    }

    const selectBook = (book: BibleBookOption) => {
        setQuery(`${book.fullName} `) // Append space automatically
        setIsDropdownOpen(false)
        inputRef.current?.focus()
    }

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
            {/* Search Input Area */}
            <div className="p-3 bg-gray-900 border-b border-gray-800 relative">
                <form onSubmit={handleSearch} className="flex gap-2 relative">
                    <input
                        ref={inputRef}
                        type="text"
                        className="flex-1 bg-gray-800 text-white border border-gray-700 rounded px-3 py-2 focus:border-blue-500 outline-none text-sm placeholder-gray-500"
                        placeholder="예: 요 3:16, 창 1"
                        value={query}
                        onChange={handleQueryChange}
                        onFocus={() => {
                            if (!query || !/[\d\s]/.test(query)) {
                                setFilteredBooks(query ? BIBLE_BOOKS.filter(b => b.fullName.includes(query) || b.shortName.includes(query)) : BIBLE_BOOKS)
                                setIsDropdownOpen(true)
                            }
                        }}
                    />
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="bg-blue-700 hover:bg-blue-600 text-white font-bold px-4 py-2 rounded text-sm disabled:opacity-50"
                    >
                        Go
                    </button>

                    {/* Autocomplete Dropdown */}
                    {isDropdownOpen && filteredBooks.length > 0 && (
                        <ul
                            ref={dropdownRef}
                            className="absolute top-full left-0 right-14 mt-1 bg-gray-800 border border-gray-700 rounded shadow-2xl z-50 max-h-48 overflow-y-auto"
                        >
                            {filteredBooks.map((book) => (
                                <li
                                    key={book.fullName}
                                    onClick={() => selectBook(book)}
                                    className="px-3 py-2 text-sm text-gray-200 hover:bg-blue-600 hover:text-white cursor-pointer transition-colors"
                                >
                                    {book.display}
                                </li>
                            ))}
                        </ul>
                    )}
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
