import { useEffect, useRef, useState } from 'react'
import {
  Archive,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  Copy,
  FileMusic,
  ListMusic,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { usePresentationStore } from '../store'
import { useModalGuard } from '../hooks/useModalGuard'
import { flushPersistence } from '../store/persistence'
import type { Setlist, SetlistCommand } from '../../shared/setlists'

type Editor = { kind: 'create' } | { kind: 'rename' | 'duplicate'; id: string }
type Sort = 'updated' | 'date' | 'title'
const button =
  'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-40 disabled:cursor-not-allowed'
const secondary = `${button} border border-white/10 bg-white/5 text-gray-200 hover:bg-white/10`
const primary = `${button} bg-blue-600 text-white hover:bg-blue-500`
const field =
  'w-full rounded-lg border border-white/10 bg-gray-950/60 px-3 py-2 text-sm text-gray-100 outline-none transition-colors placeholder:text-gray-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/15 disabled:opacity-50'
const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})
const formatDate = (value: string) =>
  dateFormatter.format(new Date(value.length === 10 ? `${value}T12:00:00` : value))

export default function SetlistManager({
  onClose,
  initialAction,
  onTemplates,
}: {
  onClose: () => void
  initialAction?: 'create' | 'rename'
  onTemplates?: (seed: { title: string; date: string }) => void
}) {
  const directEditor = initialAction !== undefined
  const setlists = usePresentationStore((s) => s.setlists)
  const songs = usePresentationStore((s) => s.setlistSongs)
  const playlist = usePresentationStore((s) => s.playlist)
  const activeId = usePresentationStore((s) => s.activeSetlistId)
  const initialSetlist = setlists.find((list) => list.id === activeId && !list.deletedAt)
  const [query, setQuery] = useState('')
  const [trash, setTrash] = useState(false)
  const [sort, setSort] = useState<Sort>('updated')
  const [selectedId, setSelectedId] = useState<string | null>(activeId)
  const [editor, setEditor] = useState<Editor | null>(
    initialAction === 'create'
      ? { kind: 'create' }
      : initialAction === 'rename' && initialSetlist
        ? { kind: 'rename', id: initialSetlist.id }
        : null,
  )
  const [title, setTitle] = useState(initialAction === 'rename' ? initialSetlist?.title || '' : '')
  const [date, setDate] = useState(initialAction === 'rename' ? initialSetlist?.date || '' : '')
  const [fromCurrent, setFromCurrent] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const editorTriggerRef = useRef<HTMLElement | null>(null)
  const songById = new Map(songs.map((song) => [song.presentation.id, song.presentation]))
  const archived = setlists.filter((list) => !list.deletedAt)
  const trashed = setlists.filter((list) => list.deletedAt)
  const items = (trash ? trashed : archived)
    .filter((list) =>
      [
        list.title,
        list.date || '',
        ...list.items.map((item) => songById.get(item.presentationId)?.title || ''),
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => {
      if (sort === 'title')
        return a.title.localeCompare(b.title, 'ko') || b.updatedAt.localeCompare(a.updatedAt)
      if (sort === 'date')
        return (b.date || '').localeCompare(a.date || '') || b.updatedAt.localeCompare(a.updatedAt)
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  const selected = items.find((list) => list.id === selectedId) || items[0]
  const deleting = setlists.find((list) => list.id === deleteId)
  const current = archived.find((list) => list.id === activeId)
  const selectedSlides =
    selected?.items.reduce(
      (sum, item) => sum + (songById.get(item.presentationId)?.slides.length || 0),
      0,
    ) || 0

  useModalGuard(true, () => {
    if (busy) return
    if (deleteId) setDeleteId(null)
    else if (editor && !directEditor) setEditor(null)
    else onClose()
  })
  useEffect(() => {
    if (editor) titleRef.current?.focus()
    else if (editorTriggerRef.current) {
      const trigger = editorTriggerRef.current
      ;(trigger.isConnected ? trigger : searchRef.current)?.focus()
      editorTriggerRef.current = null
    }
  }, [editor])

  const begin = (kind: Editor['kind'], list?: Setlist) => {
    editorTriggerRef.current = document.activeElement as HTMLElement | null
    setError('')
    setDeleteId(null)
    if (kind === 'create') {
      setEditor({ kind })
      setTitle('')
      setDate('')
      setFromCurrent(false)
    } else if (list) {
      setSelectedId(list.id)
      setEditor({ kind, id: list.id })
      setTitle(kind === 'duplicate' ? `${list.title} 복사`.slice(0, 200) : list.title)
      setDate(list.date || '')
    }
  }
  const run = async (command: () => SetlistCommand, close = false) => {
    if (busy) return false
    setBusy(true)
    setError('')
    try {
      window.dispatchEvent(new Event('propre-flush-edits'))
      await flushPersistence()
      await usePresentationStore.getState().refreshWorkspace()
      await usePresentationStore.getState().manageSetlist(command())
      if (close) onClose()
      return true
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : '콘티를 저장하지 못했습니다. 다시 시도해주세요.',
      )
      return false
    } finally {
      setBusy(false)
    }
  }
  const submit = async () => {
    if (!editor || !title.trim()) return
    const saved = await run(
      () => {
        const s = usePresentationStore.getState()
        if (editor.kind !== 'create') {
          const list = s.setlists.find((x) => x.id === editor.id)
          if (!list) throw new Error('콘티를 찾지 못했습니다. 보관함을 다시 열어주세요.')
          return {
            operation: editor.kind === 'duplicate' ? 'duplicate' : 'rename',
            id: list.id,
            expectedRevision: list.revision,
            title: title.trim(),
            date: date || undefined,
          }
        }
        const active = s.setlists.find((x) => x.id === s.activeSetlistId)
        return {
          operation: 'create',
          title: title.trim(),
          date: date || undefined,
          fromCurrent,
          expectedActiveId: s.activeSetlistId,
          expectedRevision: active?.revision ?? null,
        }
      },
      editor.kind !== 'rename' || directEditor,
    )
    if (saved && editor.kind === 'rename' && !directEditor) {
      setSelectedId(editor.id)
      setQuery('')
      setEditor(null)
    }
  }
  const operate = async (id: string, operation: 'open' | 'delete' | 'restore') => {
    const saved = await run(() => {
      const s = usePresentationStore.getState()
      const list = s.setlists.find((x) => x.id === id)
      if (!list) throw new Error('콘티를 찾지 못했습니다. 보관함을 다시 열어주세요.')
      return operation === 'open'
        ? { operation, id, expectedRevision: list.revision, expectedActiveId: s.activeSetlistId }
        : { operation, id, expectedRevision: list.revision }
    }, operation === 'open')
    if (saved && operation !== 'open') {
      setDeleteId(null)
      if (operation === 'restore') {
        setTrash(false)
        setQuery('')
        setSelectedId(id)
      }
      usePresentationStore
        .getState()
        .addToast(
          operation === 'restore'
            ? '콘티를 보관함으로 복원했습니다.'
            : '콘티를 휴지통으로 옮겼습니다.',
          'success',
        )
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="setlist-manager-title"
        data-modal="true"
        className={`flex w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-gray-900 text-gray-100 shadow-2xl ${directEditor ? 'max-h-[84vh] max-w-lg' : 'h-[min(84vh,760px)] max-w-5xl'}`}
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/10 text-blue-400">
              <Archive size={22} strokeWidth={1.7} />
            </div>
            <div>
              <h2 id="setlist-manager-title" className="text-xl font-semibold tracking-tight">
                {initialAction === 'create'
                  ? '새 콘티'
                  : initialAction === 'rename'
                    ? '콘티 정보 수정'
                    : '콘티 보관함'}
              </h2>
              <p className={`${directEditor ? 'hidden' : 'mt-0.5 text-xs text-gray-400'}`}>
                {directEditor
                  ? initialAction === 'rename'
                    ? '콘티의 이름과 날짜를 수정하세요.'
                    : '다음 예배의 이름과 날짜를 정하세요.'
                  : '지난 예배를 이어서, 다음 예배를 새롭게.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!directEditor && (
              <button
                type="button"
                disabled={busy}
                onClick={() => begin('create')}
                className={primary}
              >
                <Plus size={16} />새 콘티
              </button>
            )}
            <button
              type="button"
              aria-label={
                initialAction === 'create'
                  ? '새 콘티 닫기'
                  : initialAction === 'rename'
                    ? '콘티 정보 수정 닫기'
                    : '콘티 보관함 닫기'
              }
              disabled={busy}
              onClick={onClose}
              className={`${button} p-2 text-gray-400 hover:bg-white/5 hover:text-white`}
            >
              <X size={20} />
            </button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <aside
            aria-label="콘티 목록"
            className={`min-h-0 shrink-0 flex-col border-b border-white/10 bg-gray-950/25 sm:w-[260px] md:w-[340px] sm:border-b-0 sm:border-r ${directEditor ? 'hidden' : editor ? 'hidden md:flex' : 'flex'}`}
          >
            <div className="space-y-3 p-4">
              <div className="flex gap-1 rounded-lg bg-gray-950/60 p-1">
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={!trash}
                  onClick={() => {
                    setTrash(false)
                    setEditor(null)
                    setDeleteId(null)
                    setError('')
                  }}
                  className={`${button} flex-1 py-1.5 text-xs ${!trash ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                >
                  보관한 콘티 <span className="text-gray-400">{archived.length}</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={trash}
                  onClick={() => {
                    setTrash(true)
                    setEditor(null)
                    setDeleteId(null)
                    setError('')
                  }}
                  className={`${button} flex-1 py-1.5 text-xs ${trash ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                >
                  <Trash2 size={13} />
                  휴지통 <span className="text-gray-400">{trashed.length}</span>
                </button>
              </div>
              <div className="relative">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-3 text-gray-500"
                />
                <input
                  ref={searchRef}
                  aria-label="콘티 검색"
                  placeholder="콘티 이름, 날짜, 곡 이름 검색"
                  value={query}
                  disabled={busy}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setDeleteId(null)
                  }}
                  className={`${field} pl-9 pr-9`}
                />
                {query && (
                  <button
                    type="button"
                    aria-label="검색 지우기"
                    disabled={busy}
                    onClick={() => setQuery('')}
                    className="absolute right-2 top-2 rounded p-1 text-gray-400 hover:text-white cursor-pointer"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{items.length}개 콘티</span>
                <select
                  aria-label="콘티 정렬"
                  value={sort}
                  disabled={busy}
                  onChange={(e) => setSort(e.target.value as Sort)}
                  className="cursor-pointer rounded bg-gray-900 px-2 py-1 text-xs text-gray-300 outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                >
                  <option value="updated">최근 수정순</option>
                  <option value="date">예배 날짜순</option>
                  <option value="title">이름순</option>
                </select>
              </div>
            </div>
            <div className="max-h-32 min-h-0 flex-1 setlist-scroll overflow-y-auto px-2 pb-3 sm:max-h-none">
              {!items.length && (
                <div className="px-5 py-8 text-center">
                  <Search size={24} className="mx-auto mb-3 text-gray-600" />
                  <p className="text-sm text-gray-300">
                    {query
                      ? '검색 결과가 없습니다.'
                      : trash
                        ? '휴지통이 비어 있습니다.'
                        : '아직 보관한 콘티가 없습니다.'}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-gray-500">
                    {query
                      ? '다른 이름이나 곡 이름으로 찾아보세요.'
                      : trash
                        ? '옮긴 콘티는 여기에서 복원할 수 있습니다.'
                        : '새 콘티로 예배 순서를 준비해보세요.'}
                  </p>
                </div>
              )}
              {items.map((list) => (
                <button
                  key={list.id}
                  type="button"
                  aria-label={`보관 콘티: ${list.title}`}
                  aria-pressed={selected?.id === list.id && !editor}
                  disabled={busy}
                  onClick={() => {
                    setSelectedId(list.id)
                    setEditor(null)
                    setDeleteId(null)
                    setError('')
                  }}
                  className={`mb-1 w-full cursor-pointer rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed ${selected?.id === list.id && !editor ? 'border-blue-400/30 bg-blue-500/10' : 'border-transparent hover:bg-white/5'}`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 rounded-lg p-2 ${selected?.id === list.id && !editor ? 'bg-blue-400/10 text-blue-400' : 'bg-white/5 text-gray-500'}`}
                    >
                      <FileMusic size={18} strokeWidth={1.6} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{list.title}</span>
                        {activeId === list.id && (
                          <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
                            현재
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        {list.date ? formatDate(list.date) : '날짜 미정'}
                        <span className="mx-2 text-gray-600">·</span>
                        {list.items.length}곡
                      </p>
                      <p className="mt-1.5 truncate text-[11px] text-gray-500">
                        {list.items
                          .slice(0, 3)
                          .map(
                            (item) => songById.get(item.presentationId)?.title || '알 수 없는 곡',
                          )
                          .join(' · ') || '곡을 추가해 순서를 준비하세요'}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {current && (
              <div className="hidden shrink-0 border-t border-white/10 px-4 py-3 sm:block">
                <p className="flex items-center gap-1.5 text-[11px] text-blue-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                  현재 콘티
                </p>
                <p className="mt-1 truncate text-xs text-gray-300">{current.title}</p>
              </div>
            )}
          </aside>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {error && (
              <div
                role="alert"
                className="mx-6 mt-4 rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-300"
              >
                {error}
              </div>
            )}
            {busy && (
              <p role="status" className="flex items-center gap-2 px-6 pt-4 text-xs text-blue-300">
                <LoaderCircle size={14} className="animate-spin" />
                콘티 저장 중…
              </p>
            )}
            {editor ? (
              <form
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={(e) => {
                  e.preventDefault()
                  void submit()
                }}
              >
                <div className="min-h-0 flex-1 setlist-scroll overflow-y-auto px-5 py-4">
                  {!directEditor && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (directEditor) onClose()
                        else setEditor(null)
                        setError('')
                      }}
                      className={`${button} mb-5 -ml-3 text-xs text-gray-400 hover:text-white`}
                    >
                      <ChevronLeft size={14} />
                      보관함으로
                    </button>
                  )}
                  {!directEditor && (
                    <h3 className="mb-4 text-lg font-semibold">
                      {editor.kind === 'create'
                        ? '새 콘티'
                        : editor.kind === 'duplicate'
                          ? '콘티 복제'
                          : '이름·날짜 변경'}
                    </h3>
                  )}
                  <div className="space-y-3">
                    <label className="block text-sm font-medium text-gray-300">
                      콘티 이름
                      <input
                        ref={titleRef}
                        required
                        maxLength={200}
                        value={title}
                        disabled={busy}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="예: 주일 오전예배"
                        className={`${field} mt-2`}
                      />
                    </label>
                    <label className="block text-sm font-medium text-gray-300">
                      예배 날짜 <span className="text-xs font-normal text-gray-500">(선택)</span>
                      <div className="relative mt-2">
                        <input
                          type="date"
                          aria-label="예배 날짜"
                          value={date}
                          disabled={busy}
                          onChange={(e) => setDate(e.target.value)}
                          onClick={(e) => {
                            if (!busy) e.currentTarget.showPicker?.()
                          }}
                          className={`${field} pr-10 [&::-webkit-calendar-picker-indicator]:opacity-0`}
                        />
                        <CalendarDays
                          aria-hidden="true"
                          size={19}
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                      </div>
                    </label>
                    {editor.kind === 'create' && (
                      <fieldset disabled={busy}>
                        <legend className="mb-2 text-sm font-medium text-gray-300">
                          시작 방식
                        </legend>
                        <div className="grid grid-cols-2 gap-2">
                          <label
                            className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${!fromCurrent ? 'border-blue-400/50 bg-blue-500/10' : 'border-white/10 hover:bg-white/5'}`}
                          >
                            <input
                              type="radio"
                              name="setlist-start-mode"
                              aria-label="빈 콘티"
                              checked={!fromCurrent}
                              onChange={() => setFromCurrent(false)}
                              className="accent-blue-500"
                            />
                            빈 콘티
                          </label>
                          <label
                            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${!playlist.length ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-white/5'} ${fromCurrent ? 'border-blue-400/50 bg-blue-500/10' : 'border-white/10'}`}
                          >
                            <input
                              type="radio"
                              name="setlist-start-mode"
                              aria-label="현재 순서 복사"
                              checked={fromCurrent}
                              disabled={!playlist.length}
                              onChange={() => setFromCurrent(true)}
                              className="accent-blue-500"
                            />
                            현재 순서 복사
                          </label>
                          {onTemplates && (
                            <button
                              type="button"
                              className={`${secondary} col-span-2`}
                              onClick={() => onTemplates({ title, date })}
                            >
                              템플릿으로 만들기
                            </button>
                          )}
                        </div>
                        <p className="mt-2 text-xs text-gray-500">
                          {fromCurrent
                            ? `${playlist.length}곡을 독립된 사본으로 복사합니다.`
                            : '곡 없이 새로 시작합니다.'}
                        </p>
                      </fieldset>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 justify-end gap-2 border-t border-white/10 px-5 py-3">
                  <button
                    type="button"
                    disabled={busy}
                    className={secondary}
                    onClick={() => {
                      if (directEditor) onClose()
                      else setEditor(null)
                      setError('')
                    }}
                  >
                    취소
                  </button>
                  <button type="submit" disabled={busy || !title.trim()} className={primary}>
                    {editor.kind === 'create' ? (
                      <Plus size={16} />
                    ) : editor.kind === 'duplicate' ? (
                      <Copy size={16} />
                    ) : (
                      <Check size={16} />
                    )}
                    {editor.kind === 'create'
                      ? '콘티 만들기'
                      : editor.kind === 'duplicate'
                        ? '복제해서 열기'
                        : '변경 저장'}
                  </button>
                </div>
              </form>
            ) : selected ? (
              <>
                <div className="min-h-0 flex-1 setlist-scroll overflow-y-auto p-6 md:p-8">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-medium text-blue-400">
                        {trash
                          ? '휴지통에 보관 중'
                          : activeId === selected.id
                            ? '현재 준비 중인 콘티'
                            : '보관한 예배'}
                      </p>
                      <h3 className="break-words text-2xl font-semibold tracking-tight">
                        {selected.title}
                      </h3>
                    </div>
                    {!trash && (
                      <button
                        type="button"
                        aria-label={`콘티 이름 변경: ${selected.title}`}
                        disabled={busy}
                        onClick={() => begin('rename', selected)}
                        className={`${button} shrink-0 p-2 text-gray-400 hover:bg-white/5 hover:text-white`}
                        title="이름·날짜 변경"
                      >
                        <Pencil size={17} />
                      </button>
                    )}
                  </div>
                  <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-400">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays size={14} />
                      {selected.date ? formatDate(selected.date) : '예배 날짜 미정'}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <ListMusic size={14} />
                      {selected.items.length}곡 · {selectedSlides}슬라이드
                    </span>
                  </div>
                  <div className="mt-7 border-t border-white/10 pt-5">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-xs font-semibold text-gray-400">예배 순서</h4>
                      <span className="text-[11px] text-gray-500">
                        수정 {formatDate(selected.updatedAt)}
                      </span>
                    </div>
                    {selected.items.length ? (
                      <ol className="space-y-1">
                        {selected.items.map((item, index) => {
                          const song = songById.get(item.presentationId)
                          return (
                            <li
                              key={item.id}
                              className="flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-white/[0.03]"
                            >
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/5 text-xs tabular-nums text-gray-500">
                                {String(index + 1).padStart(2, '0')}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm text-gray-200">
                                {song?.title || '알 수 없는 곡'}
                              </span>
                              <span className="shrink-0 text-xs text-gray-500">
                                {song?.slides.length || 0}슬라이드
                              </span>
                            </li>
                          )
                        })}
                      </ol>
                    ) : (
                      <div className="rounded-xl border border-dashed border-white/10 px-5 py-10 text-center">
                        <ListMusic size={26} className="mx-auto mb-3 text-gray-600" />
                        <p className="text-sm text-gray-300">아직 곡이 없는 콘티입니다.</p>
                        <p className="mt-2 text-xs text-gray-500">
                          콘티를 열고 Songs에서 곡을 추가하세요.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                <footer className="shrink-0 border-t border-white/10 px-5 py-3">
                  {deleting ? (
                    <div className="space-y-3 rounded-xl border border-red-400/20 bg-red-400/5 p-4">
                      <p className="text-sm font-medium text-gray-200">
                        ‘{deleting.title}’을 휴지통으로 옮길까요?
                      </p>
                      <p className="text-xs leading-relaxed text-gray-400">
                        {activeId === deleting.id
                          ? '현재 콘티의 순서가 비워집니다. 편집 중인 곡과 송출은 유지됩니다.'
                          : '곡과 순서는 보관되며 휴지통에서 다시 복원할 수 있습니다.'}
                      </p>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          className={secondary}
                          onClick={() => setDeleteId(null)}
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className={`${button} bg-red-500/15 text-red-300 hover:bg-red-500/25`}
                          onClick={() => void operate(deleting.id, 'delete')}
                        >
                          휴지통으로 이동
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="mb-3 text-[11px] leading-relaxed text-gray-500">
                        {trash
                          ? '복원하면 곡과 순서가 보관함으로 돌아옵니다.'
                          : '콘티를 열어도 편집 중인 곡과 송출 화면은 유지됩니다.'}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {trash ? (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`콘티 복원: ${selected.title}`}
                            className={primary}
                            onClick={() => void operate(selected.id, 'restore')}
                          >
                            <RotateCcw size={16} />
                            보관함으로 복원
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={`콘티 열기: ${selected.title}`}
                              className={primary}
                              onClick={() => void operate(selected.id, 'open')}
                            >
                              콘티 열기
                              <ArrowRight size={16} />
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={`콘티 복제: ${selected.title}`}
                              className={secondary}
                              onClick={() => begin('duplicate', selected)}
                            >
                              <Copy size={15} />
                              복제
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={`콘티 휴지통으로 이동: ${selected.title}`}
                              className={`${button} ml-auto p-2 text-gray-500 hover:bg-red-500/10 hover:text-red-300`}
                              title="휴지통으로 이동"
                              onClick={() => setDeleteId(selected.id)}
                            >
                              <Trash2 size={17} />
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </footer>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <div className="mb-5 rounded-2xl border border-white/5 bg-white/[0.03] p-5">
                  <Archive size={36} strokeWidth={1.3} className="text-gray-600" />
                </div>
                <h3 className="text-lg font-medium text-gray-200">
                  {query
                    ? '원하는 콘티를 찾아보세요'
                    : trash
                      ? '보관한 콘티를 안전하게 관리하세요'
                      : '첫 콘티를 준비해보세요'}
                </h3>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-gray-500">
                  {query
                    ? '검색어를 바꾸면 콘티와 포함된 곡을 함께 찾을 수 있습니다.'
                    : trash
                      ? '휴지통에 옮긴 콘티도 곡과 순서가 보존됩니다.'
                      : '현재 순서를 저장하거나, 빈 콘티에서 새로운 예배를 시작할 수 있습니다.'}
                </p>
                {!query && !trash && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => begin('create')}
                    className={`${primary} mt-6`}
                  >
                    <Plus size={16} />새 콘티 만들기
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
