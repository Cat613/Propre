import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { BookOpen, X } from 'lucide-react'
import { useModalGuard } from '../hooks/useModalGuard'
import { BibleService, type BibleVerse } from '../services/BibleService'
import { usePresentationStore } from '../store'
import { BOOK_MAPPING } from '../utils/bibleParser'

const books = Object.entries(BOOK_MAPPING).filter(
  ([name, short]) => name !== short && !/\d$/.test(name),
)

const BibleInsertModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { slides, currentPresentationId, currentPresentationTitle } = usePresentationStore(
    useShallow((state) => ({
      slides: state.slides,
      currentPresentationId: state.currentPresentationId,
      currentPresentationTitle: state.currentPresentationTitle,
    })),
  )
  const [targetPresentationId] = useState(currentPresentationId)
  const [position, setPosition] = useState(() => {
    const selected = new Set(usePresentationStore.getState().selectedSlideIds)
    const last = slides.filter((slide) => selected.has(slide.id)).at(-1)
    return last ? `after:${last.id}` : 'end'
  })
  const [query, setQuery] = useState('')
  const [verses, setVerses] = useState<BibleVerse[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  useModalGuard(true, onClose)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )

  const changeQuery = (value: string) => {
    request.current++
    setQuery(value)
    setVerses([])
    setSelected([])
    setError(null)
    setIsLoading(false)
  }

  const search = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!query.trim()) return
    const token = ++request.current
    setIsLoading(true)
    setError(null)
    setVerses([])
    setSelected([])
    try {
      const result = await BibleService.searchVerses(query)
      if (token !== request.current) return
      setVerses(result)
      setSelected(result.map((verse) => verse.reference))
    } catch (cause) {
      if (token !== request.current) return
      setError(cause instanceof Error ? cause.message : '성경 자료를 불러오지 못했습니다.')
    } finally {
      if (token === request.current) setIsLoading(false)
    }
  }

  const addVerses = () => {
    const state = usePresentationStore.getState()
    if (state.currentPresentationId !== targetPresentationId) {
      setError('편집 중인 자료가 바뀌었습니다. 닫은 뒤 추가할 자료에서 다시 열어주세요.')
      return
    }
    const chosen = verses.filter((verse) => selected.includes(verse.reference))
    if (!chosen.length || isLoading) return
    const inserted = state.insertSlides(
      chosen.map((verse) => ({
        id: crypto.randomUUID(),
        type: 'bible',
        content: verse.content,
        bibleReference: verse.reference,
        label: '말씀',
        labelColor: '#CA8A04',
      })),
      position === 'end' ? undefined : position === 'start' ? null : position.slice(6),
    )
    if (!inserted) {
      setError('추가 위치의 슬라이드가 삭제되었습니다. 추가 위치를 다시 선택해주세요.')
      return
    }
    state.addToast(`성경 구절 ${chosen.length}개를 추가했습니다.`, 'success')
    onClose()
  }

  const targetChanged = currentPresentationId !== targetPresentationId

  return (
    <div className="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bible-insert-title"
        aria-describedby="bible-insert-description"
        data-modal="true"
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col text-gray-100"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 id="bible-insert-title" className="flex items-center gap-2 text-lg font-bold">
            <BookOpen className="w-5 h-5 text-yellow-400" aria-hidden="true" />
            성경 구절 추가
          </h2>
          <button
            onClick={onClose}
            aria-label="성경 구절 추가 닫기"
            className="p-2 rounded hover:bg-gray-800 text-gray-400 hover:text-white"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p id="bible-insert-description" className="text-sm text-gray-400 break-words">
            ‘{currentPresentationTitle || '새 프레젠테이션'}’에 말씀 슬라이드를 추가합니다. 구절마다
            한 장씩 만들며, 추가 후 슬라이드를 클릭하면 송출됩니다.
          </p>
          <form onSubmit={search} className="space-y-2">
            <label htmlFor="bible-insert-query" className="block text-sm font-medium">
              성경 위치 <span className="text-xs text-gray-500">개역개정</span>
            </label>
            <div className="flex gap-2">
              <input
                id="bible-insert-query"
                list="bible-insert-books"
                value={query}
                onChange={(event) => changeQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
                }}
                placeholder="예: 요 3:16, 시편 23:1-6, 창 1"
                className="min-w-0 flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              <datalist id="bible-insert-books">
                {books.map(([name]) => (
                  <option key={name} value={`${name} `} />
                ))}
              </datalist>
              <button
                type="submit"
                disabled={isLoading || !query.trim() || targetChanged}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-4 py-2 rounded text-sm font-semibold"
              >
                {isLoading ? '검색 중…' : '검색'}
              </button>
            </div>
          </form>
          <label className="block text-sm font-medium">
            추가 위치
            <select
              value={position}
              onChange={(event) => {
                setPosition(event.target.value)
                setError(null)
              }}
              className="block mt-2 w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm"
            >
              <option value="start">맨 앞</option>
              {slides.map((slide, index) => (
                <option key={slide.id} value={`after:${slide.id}`}>
                  {index + 1}번 슬라이드 뒤 ·{' '}
                  {slide.bibleReference || slide.content?.slice(0, 30) || '빈 슬라이드'}
                </option>
              ))}
              <option value="end">맨 뒤</option>
            </select>
          </label>
          {(error || targetChanged) && (
            <p role="alert" className="text-sm text-red-300">
              {targetChanged
                ? '편집 중인 자료가 바뀌었습니다. 닫은 뒤 추가할 자료에서 다시 열어주세요.'
                : error}
            </p>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4" aria-busy={isLoading}>
          {verses.length ? (
            <>
              <div className="flex justify-between items-center py-2 text-sm border-b border-gray-700 mb-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.length === verses.length}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked ? verses.map((verse) => verse.reference) : [],
                      )
                    }
                  />
                  전체 선택
                </label>
                <span role="status" className="text-gray-400">
                  {verses.length}개 중 {selected.length}개 선택
                </span>
              </div>
              <div className="space-y-2">
                {verses.map((verse) => (
                  <label
                    key={verse.reference}
                    className="flex items-start gap-3 p-3 bg-gray-800/70 hover:bg-gray-800 border border-gray-700 rounded-lg cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      aria-label={verse.reference}
                      className="mt-1"
                      checked={selected.includes(verse.reference)}
                      onChange={(event) =>
                        setSelected((previous) =>
                          event.target.checked
                            ? [...previous, verse.reference]
                            : previous.filter((reference) => reference !== verse.reference),
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-yellow-400 mb-1">
                        {verse.reference}
                      </span>
                      <span className="block text-sm leading-relaxed whitespace-pre-line">
                        {verse.content}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p role="status" className="text-sm text-gray-500 text-center py-6">
              {isLoading
                ? '성경 구절을 불러오는 중…'
                : '성경 위치를 검색하고 추가할 구절을 선택하세요.'}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-700">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded hover:bg-gray-800">
            취소
          </button>
          <button
            onClick={addVerses}
            disabled={!selected.length || isLoading || targetChanged}
            className="px-4 py-2 text-sm font-semibold rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40"
          >
            {selected.length ? `${selected.length}개 구절 추가` : '구절 추가'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default BibleInsertModal
