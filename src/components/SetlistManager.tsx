import { useState } from 'react'
import { usePresentationStore } from '../store'
import { useModalGuard } from '../hooks/useModalGuard'
import { flushPersistence } from '../store/persistence'
import type { SetlistCommand } from '../../shared/setlists'

export default function SetlistManager({ onClose }: { onClose: () => void }) {
  const setlists = usePresentationStore((s) => s.setlists)
  const playlist = usePresentationStore((s) => s.playlist)
  const activeId = usePresentationStore((s) => s.activeSetlistId)
  const [query, setQuery] = useState(''),
    [trash, setTrash] = useState(false)
  const [title, setTitle] = useState(''),
    [date, setDate] = useState('')
  const [fromCurrent, setFromCurrent] = useState(playlist.length > 0)
  const [editing, setEditing] = useState<{ id: string; duplicate: boolean } | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useModalGuard(true, () => {
    if (!busy) onClose()
  })
  const run = async (command: () => SetlistCommand, close = false) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      window.dispatchEvent(new Event('propre-flush-edits'))
      await flushPersistence()
      await usePresentationStore.getState().refreshWorkspace()
      await usePresentationStore.getState().manageSetlist(command())
      if (close) onClose()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : '콘티를 저장하지 못했습니다. 다시 시도해주세요.',
      )
    } finally {
      setBusy(false)
    }
  }
  const submit = () =>
    void run(() => {
      const s = usePresentationStore.getState(),
        active = s.setlists.find((x) => x.id === s.activeSetlistId)
      const list = s.setlists.find((x) => x.id === editing?.id)
      if (editing && list)
        return editing.duplicate
          ? {
              operation: 'duplicate',
              id: list.id,
              expectedRevision: list.revision,
              title: title.trim(),
              date: date || undefined,
            }
          : {
              operation: 'rename',
              id: list.id,
              expectedRevision: list.revision,
              title: title.trim(),
              date: date || undefined,
            }
      return {
        operation: 'create',
        title: title.trim(),
        date: date || undefined,
        fromCurrent,
        expectedActiveId: s.activeSetlistId,
        expectedRevision: active?.revision ?? null,
      }
    }, true)
  const operate = (id: string, operation: 'open' | 'delete' | 'restore') =>
    void run(() => {
      const s = usePresentationStore.getState(),
        list = s.setlists.find((x) => x.id === id)!
      return operation === 'open'
        ? { operation, id, expectedRevision: list.revision, expectedActiveId: s.activeSetlistId }
        : { operation, id, expectedRevision: list.revision }
    }, operation === 'open')
  const items = setlists
    .filter(
      (x) =>
        !!x.deletedAt === trash &&
        `${x.title} ${x.date || ''}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const button = 'px-3 py-2 rounded bg-gray-700 text-sm hover:bg-gray-600 disabled:opacity-40'
  return (
    <div className="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="setlist-manager-title"
        data-modal="true"
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col text-gray-100 shadow-2xl"
      >
        <div className="flex justify-between items-center p-5 border-b border-gray-700">
          <h2 id="setlist-manager-title" className="text-lg font-semibold">
            콘티 보관함
          </h2>
          <button
            type="button"
            aria-label="콘티 보관함 닫기"
            disabled={busy}
            onClick={onClose}
            className={button}
          >
            닫기
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-5">
          <p className="text-sm text-gray-400">
            콘티마다 가사·반복 구성·스타일을 별도로 보존합니다. 콘티를 열어도 현재 편집 곡과 송출
            화면은 유지됩니다.
          </p>
          <form
            className="space-y-3 p-4 rounded-lg bg-gray-800"
            onSubmit={(e) => {
              e.preventDefault()
              if (title.trim()) submit()
            }}
          >
            <h3 className="font-semibold">
              {editing ? (editing.duplicate ? '콘티 복제' : '콘티 이름·날짜 변경') : '새 콘티'}
            </h3>
            <div className="flex gap-3 flex-wrap">
              <label className="flex-1 min-w-48 text-sm">
                콘티 이름
                <input
                  required
                  maxLength={200}
                  value={title}
                  disabled={busy}
                  onChange={(e) => setTitle(e.target.value)}
                  className="block mt-1 w-full bg-gray-950 border border-gray-600 rounded p-2"
                />
              </label>
              <label className="text-sm">
                예배 날짜
                <input
                  type="date"
                  value={date}
                  disabled={busy}
                  onChange={(e) => setDate(e.target.value)}
                  className="block mt-1 bg-gray-950 border border-gray-600 rounded p-2"
                />
              </label>
            </div>
            {!editing && (
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={fromCurrent}
                  disabled={busy || !playlist.length}
                  onChange={(e) => setFromCurrent(e.target.checked)}
                />
                현재 순서로 만들기
              </label>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || !title.trim()}
                className={`${button} bg-blue-600 hover:bg-blue-500`}
              >
                {editing ? (editing.duplicate ? '복제해서 열기' : '변경 저장') : '콘티 만들기'}
              </button>
              {editing && (
                <button
                  type="button"
                  disabled={busy}
                  className={button}
                  onClick={() => {
                    setEditing(null)
                    setTitle('')
                    setDate('')
                  }}
                >
                  편집 취소
                </button>
              )}
            </div>
          </form>
          <div className="flex gap-2 items-center flex-wrap">
            <button
              type="button"
              disabled={busy}
              aria-pressed={!trash}
              className={button}
              onClick={() => setTrash(false)}
            >
              보관한 콘티
            </button>
            <button
              type="button"
              disabled={busy}
              aria-pressed={trash}
              className={button}
              onClick={() => setTrash(true)}
            >
              휴지통
            </button>
            <input
              aria-label="콘티 검색"
              placeholder="이름 또는 날짜로 검색"
              value={query}
              disabled={busy}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 min-w-40 bg-gray-950 border border-gray-600 rounded p-2 text-sm"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          {busy && (
            <p role="status" className="text-sm text-gray-400">
              콘티 저장 중…
            </p>
          )}
          {!items.length && (
            <p className="py-4 text-sm text-gray-400">
              {query
                ? '검색 결과가 없습니다.'
                : trash
                  ? '휴지통이 비어 있습니다.'
                  : '보관한 콘티가 없습니다. 위에서 새 콘티를 만드세요.'}
            </p>
          )}
          <div className="space-y-2">
            {items.map((list) => (
              <article
                key={list.id}
                className="border border-gray-700 rounded-lg p-3"
                aria-label={`보관 콘티: ${list.title}`}
              >
                <div className="flex justify-between items-center gap-2">
                  <h3 className="font-medium break-words">
                    {list.title}
                    {activeId === list.id && (
                      <span className="ml-2 text-xs text-blue-300">현재 콘티</span>
                    )}
                  </h3>
                  <span className="text-xs text-gray-400 shrink-0">{list.items.length}곡</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {list.date || '날짜 없음'} · 수정 {new Date(list.updatedAt).toLocaleDateString()}
                  {list.lastOpenedAt
                    ? ` · 최근 열기 ${new Date(list.lastOpenedAt).toLocaleDateString()}`
                    : ''}
                </p>
                <div className="flex gap-2 mt-3 flex-wrap">
                  {trash ? (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`콘티 복원: ${list.title}`}
                      className={button}
                      onClick={() => operate(list.id, 'restore')}
                    >
                      복원
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`콘티 열기: ${list.title}`}
                        className={button}
                        onClick={() => operate(list.id, 'open')}
                      >
                        열기
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`콘티 복제: ${list.title}`}
                        className={button}
                        onClick={() => {
                          setEditing({ id: list.id, duplicate: true })
                          setTitle(`${list.title} 복사`.slice(0, 200))
                          setDate(list.date || '')
                        }}
                      >
                        복제
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`콘티 이름 변경: ${list.title}`}
                        className={button}
                        onClick={() => {
                          setEditing({ id: list.id, duplicate: false })
                          setTitle(list.title)
                          setDate(list.date || '')
                        }}
                      >
                        이름·날짜
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`콘티 휴지통으로 이동: ${list.title}`}
                        className={`${button} text-red-300`}
                        onClick={() => operate(list.id, 'delete')}
                      >
                        휴지통으로
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
