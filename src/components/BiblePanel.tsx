import { useShallow } from 'zustand/react/shallow'
import { useState, useRef, useEffect } from 'react'
import { BibleService, type BibleVerse } from '../services/BibleService'
import { usePresentationStore } from '../store'
import type { Slide } from '../types'
import { BOOK_MAPPING } from '../utils/bibleParser'

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
    display: `${fullName}(${shortName})`,
  }))

const BiblePanel: React.FC = () => {
  const { setActiveSlide, openPresentation, updateGlobalSlideStyle, addToast } =
    usePresentationStore(
      useShallow((state) => ({
        setActiveSlide: state.setActiveSlide,
        openPresentation: state.openPresentation,
        updateGlobalSlideStyle: state.updateGlobalSlideStyle,
        addToast: state.addToast,
      })),
    )

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
      const books = BIBLE_BOOKS.filter((b) => b.fullName.includes(val) || b.shortName.includes(val))
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

    setIsLoading(true)
    try {
      const resultVerses = await BibleService.searchVerses(query)
      setVerses(resultVerses)

      const newSlides: Slide[] = resultVerses.map((v) => ({
        id: crypto.randomUUID(),
        type: 'bible',
        content: v.content,
        bibleReference: v.reference,
      }))

      const now = new Date().toISOString()
      openPresentation({
        id: crypto.randomUUID(),
        title: query.trim(),
        slides: newSlides,
        createdAt: now,
        updatedAt: now,
      })

      // Make sure default Bible style preset is automatically loaded for a new Bible session
      const { defaultBiblePresetId, globalStylePresets } = usePresentationStore.getState()
      if (defaultBiblePresetId) {
        const preset = globalStylePresets.find((p) => p.id === defaultBiblePresetId)
        if (preset) {
          updateGlobalSlideStyle(preset.style, preset.id)
        }
      }
    } catch (e) {
      addToast(
        `${e instanceof Error ? e.message : '성경 데이터를 불러오지 못했습니다.'} 현재 자료는 유지됩니다.`,
        'error',
      )
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
      <div className="shrink-0 p-3 border-b border-white/5 relative">
        <form onSubmit={handleSearch} className="flex gap-2 relative">
          <input
            ref={inputRef}
            type="text"
            className="workbench-field flex-1 w-0"
            placeholder="예: 요 3:16, 창 1"
            value={query}
            onChange={handleQueryChange}
            onFocus={() => {
              if (!query || !/[\d\s]/.test(query)) {
                setFilteredBooks(
                  query
                    ? BIBLE_BOOKS.filter(
                        (b) => b.fullName.includes(query) || b.shortName.includes(query),
                      )
                    : BIBLE_BOOKS,
                )
                setIsDropdownOpen(true)
              }
            }}
          />
          <button
            type="submit"
            disabled={isLoading}
            className="workbench-button workbench-button-primary"
          >
            검색
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
      <div className="workbench-scroll min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
        {verses.length === 0 ? (
          <div className="text-gray-500 text-xs text-center mt-4">
            {isLoading ? '검색 중...' : '말씀을 검색하세요 (Enter)'}
          </div>
        ) : (
          verses.map((verse, idx) => (
            <div
              key={idx}
              onClick={() => handleVerseClick(idx)}
              className="p-2.5 rounded-lg hover:bg-white/5 cursor-pointer text-gray-300 text-sm group transition-colors"
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
