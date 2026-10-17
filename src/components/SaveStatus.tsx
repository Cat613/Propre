import { usePresentationStore } from '../store'
import { flushPersistence } from '../store/persistence'
export default function SaveStatus() {
  const status = usePresentationStore((s) => s.saveState),
    error = usePresentationStore((s) => s.saveError),
    lastSavedAt = usePresentationStore((s) => s.lastSavedAt)
  const labels = {
    saved: '자동 저장됨',
    pending: '저장 대기 중',
    saving: '저장 중…',
    error: '자동 저장 실패',
  }
  return (
    <div
      className={`text-[11px] flex shrink-0 items-center gap-2 ${status === 'error' ? 'text-red-400' : 'text-gray-400'}`}
      role="status"
      title={error || '변경 내용을 자동으로 저장합니다.'}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${status === 'error' ? 'bg-red-400' : status === 'saved' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`}
      />
      <span>{labels[status]}</span>
      {status === 'saved' && lastSavedAt && (
        <time
          dateTime={lastSavedAt}
          aria-label="마지막 저장 시각"
          title={new Date(lastSavedAt).toLocaleString('ko-KR')}
        >
          {new Date(lastSavedAt).toLocaleTimeString('ko-KR', { hour12: false })}
        </time>
      )}
      {status === 'error' && (
        <button
          className="rounded px-1.5 py-1 bg-red-400/10 text-red-300"
          onClick={() => void flushPersistence().catch(() => {})}
        >
          재시도
        </button>
      )}
    </div>
  )
}
