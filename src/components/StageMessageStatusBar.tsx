import { useState } from 'react'
import { usePresentationStore as store } from '../store'
export default function StageMessageStatusBar() {
  const status = store((s) => s.stageMessage)
  const [error, setError] = useState('')
  if (!status.message) return null
  const clear = async () => {
    try {
      const next = await window.ipcRenderer.stageMessage({
        action: 'clear',
        id: status.message!.id,
        expectedRevision: status.revision,
      })
      store.setState((previous) =>
        next.revision >= previous.stageMessage.revision ? { stageMessage: next } : {},
      )
      setError('')
    } catch {
      setError('현재 안내를 확인하고 다시 지워주세요.')
    }
  }
  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-amber-300/20 bg-amber-300/5 px-4 py-1.5 text-[11px] text-amber-100"
      aria-label="현재 무대 안내"
    >
      <span className="shrink-0">
        {status.delivery === 'displayed'
          ? '무대 표시 중'
          : status.delivery === 'pending'
            ? '무대 표시 확인 중'
            : '무대 표시 확인 필요'}
      </span>
      <span className="min-w-0 flex-1 truncate" title={status.message.text}>
        {error || status.message.text}
      </span>
      <button
        type="button"
        className="workbench-button workbench-compact-action"
        onClick={() => void clear()}
        aria-label="현재 무대 안내 지우기"
      >
        지우기
      </button>
    </div>
  )
}
