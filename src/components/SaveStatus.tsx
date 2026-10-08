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
      className={`text-xs flex items-center gap-2 ${status === 'error' ? 'text-red-400' : 'text-gray-400'}`}
      role="status"
      title={error || '변경 내용을 자동으로 저장합니다.'}
    >
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
        <button className="underline" onClick={() => void flushPersistence().catch(() => {})}>
          재시도
        </button>
      )}
    </div>
  )
}
