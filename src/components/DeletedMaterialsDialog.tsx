import { useEffect, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { useModalGuard } from '../hooks/useModalGuard'
import { flushPersistence } from '../store/persistence'
import { usePresentationStore } from '../store'
import type { Bootstrap } from '../../shared/contracts'

export default function DeletedMaterialsDialog({
  kind,
  onClose,
}: {
  kind: 'library' | 'media'
  onClose: () => void
}) {
  const [data, setData] = useState<Bootstrap | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const name = kind === 'library' ? '찬양' : '미디어'
  useModalGuard(true, () => {
    if (!busy) onClose()
  })
  useEffect(() => {
    let canceled = false
    window.dispatchEvent(new Event('propre-flush-edits'))
    void flushPersistence()
      .then(() => window.ipcRenderer.bootstrap())
      .then((data) => {
        if (!canceled) setData(data)
      })
      .catch(() => {
        if (!canceled) setError('목록을 불러오지 못했습니다. 저장 상태를 확인하고 다시 열어주세요.')
      })
      .finally(() => {
        if (!canceled) setBusy(false)
      })
    return () => {
      canceled = true
    }
  }, [])
  const entries =
    (kind === 'library'
      ? data?.deletedLibrary.map((x) => ({
          id: x.presentation.id,
          name: x.presentation.title,
          date: x.deletedAt,
        }))
      : data?.deletedMedia.map((x) => ({ id: x.media.id, name: x.media.name, date: x.deletedAt }))
    )?.sort((a, b) => b.date.localeCompare(a.date)) || []
  const restore = async (id: string) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await flushPersistence()
      await window.ipcRenderer.restoreDeleted(kind, id)
      await usePresentationStore.getState().refreshWorkspace()
      setData(await window.ipcRenderer.bootstrap())
      usePresentationStore
        .getState()
        .addToast(`${name}${kind === 'library' ? '을' : '를'} 복원했습니다.`, 'success')
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : '복원하지 못했습니다. 저장 상태를 확인하고 다시 시도해주세요.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${name} 휴지통`}
        data-modal="true"
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-white/10 bg-gray-900 p-4 text-gray-200 shadow-xl"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{name} 휴지통</h2>
          <button
            className="workbench-button"
            disabled={busy}
            onClick={onClose}
            aria-label="휴지통 닫기"
          >
            <X size={16} />
          </button>
        </div>
        <p className="my-3 text-xs text-gray-500">
          삭제한 {name}
          {kind === 'library' ? '을' : '를'} 복원합니다. 현재 콘티와 송출은 유지됩니다.
        </p>
        {error && (
          <p role="alert" className="mb-2 text-xs text-red-300">
            {error}
          </p>
        )}
        <div className="min-h-0 space-y-1 overflow-y-auto">
          {busy && !data ? (
            <p className="py-4 text-sm">불러오는 중…</p>
          ) : entries.length === 0 ? (
            <p className="py-4 text-sm text-gray-500">
              삭제한 {name}
              {kind === 'library' ? '이' : '가'} 없습니다.
            </p>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-3 rounded-lg border border-white/5 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm" title={entry.name}>
                  {entry.name}
                </span>
                <button
                  className="workbench-button shrink-0"
                  disabled={busy}
                  aria-label={`복원: ${entry.name}`}
                  onClick={() => void restore(entry.id)}
                >
                  <RotateCcw size={13} />
                  복원
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
