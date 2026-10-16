import { useEffect, useState } from 'react'
import { usePresentationStore as store } from '../store'
import { messageLayout, StageMessageText } from '../../shared/stage-message'
export default function StageMessagePanel({ draft }: { draft: string }) {
  const status = store((s) => s.stageMessage)
  const [text, setText] = useState(draft),
    [ttl, setTTL] = useState(20),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const context = document.createElement('canvas').getContext('2d')!
  const layout = messageLayout(
    text.trim(),
    status.stage?.width || 800,
    status.stage?.height || 600,
    (value, size) => {
      context.font = `600 ${size}px system-ui`
      return context.measureText(value).width
    },
  )
  const valid = StageMessageText.safeParse(text).success && layout.fits
  const send = async () => {
    setBusy(true)
    setError('')
    try {
      const next = await window.ipcRenderer.stageMessage({
        action: 'send',
        requestId: crypto.randomUUID(),
        expectedRevision: status.revision,
        text,
        ttl: ttl as 0 | 5 | 10 | 20 | 30 | 60,
      })
      store.setState((previous) =>
        next.revision > previous.stageMessage.revision ||
        (next.revision === previous.stageMessage.revision &&
          previous.stageMessage.delivery === 'none')
          ? { stageMessage: next }
          : {},
      )
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : '무대 안내를 보내지 못했습니다.',
      )
    } finally {
      setBusy(false)
    }
  }
  const clear = async () => {
    if (!status.message) return
    setBusy(true)
    setError('')
    try {
      store.setState({
        stageMessage: await window.ipcRenderer.stageMessage({
          action: 'clear',
          id: status.message.id,
          expectedRevision: status.revision,
        }),
      })
    } catch {
      setError('안내가 바뀌었습니다. 현재 안내를 확인해주세요.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="border-b border-white/5 px-3 py-2 text-[10px]">
      {status.message && (
        <div className="mb-2 rounded bg-amber-300/10 p-2 text-amber-100" role="status">
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span>
              {status.delivery === 'displayed'
                ? '무대 표시 중'
                : status.delivery === 'pending'
                  ? '무대 표시 확인 중'
                  : '무대 표시 확인 필요'}
            </span>
            <button
              type="button"
              className="workbench-button workbench-compact-action"
              disabled={busy}
              onClick={() => void clear()}
            >
              무대 안내 지우기
            </button>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words">{status.message.text}</p>
          <MessageRemaining key={status.message.id} remaining={status.remainingMs} />
        </div>
      )}
      <details open={undefined}>
        <summary className="cursor-pointer py-1 text-gray-400">무대 안내 · 청중 비공개</summary>
        <div className="mt-2 space-y-2">
          <label className="block text-gray-400">
            무대로 보낼 안내
            <textarea
              className="workbench-field mt-1 w-full resize-y text-xs"
              aria-label="무대로 보낼 안내"
              value={text}
              rows={2}
              maxLength={120}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <label className="flex flex-wrap items-center gap-2 text-gray-400">
            유지 시간
            <select
              className="workbench-field min-w-0 flex-1"
              aria-label="무대 안내 유지 시간"
              value={ttl}
              onChange={(event) => setTTL(Number(event.target.value))}
            >
              {[5, 10, 20, 30, 60, 0].map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds ? `${seconds}초` : '직접 지울 때까지'}
                </option>
              ))}
            </select>
          </label>
          <div
            className="rounded border border-amber-200/20 bg-black p-2 text-amber-100"
            aria-label="무대 안내 미리보기"
          >
            <span className="text-amber-300">안내 미리보기</span>
            <p className="mt-1 whitespace-pre-wrap break-words text-xs font-semibold">
              {layout.rows.join('\n') || '보낼 안내를 입력하세요.'}
            </p>
          </div>
          {text && !valid && (
            <p className="text-amber-200">
              120자·두 줄 이내로 줄여주세요. 현재 무대 창 크기를 기준으로 확인합니다.
            </p>
          )}
          {!status.stage && (
            <button
              type="button"
              className="workbench-button w-full justify-center"
              onClick={() => void store.getState().toggleStage()}
            >
              무대 화면 열기
            </button>
          )}
          <button
            type="button"
            className="workbench-button w-full justify-center"
            disabled={busy || !status.stage || !valid}
            onClick={() => void send()}
          >
            {busy
              ? '전송 중…'
              : status.message
                ? '이 안내로 교체해 무대에 보내기'
                : '무대에 보내기'}
          </button>
        </div>
      </details>
      {error && (
        <p role="alert" className="mt-1 break-words text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}
function MessageRemaining({ remaining }: { remaining?: number }) {
  const [seconds, setSeconds] = useState(
    remaining === undefined ? undefined : Math.ceil(remaining / 1000),
  )
  useEffect(() => {
    const timer = setInterval(
      () => setSeconds((value) => (value === undefined ? undefined : Math.max(0, value - 1))),
      1000,
    )
    return () => clearInterval(timer)
  }, [])
  return (
    <p className="mt-1 text-amber-200/70">
      {seconds === undefined
        ? '직접 지우기 필요'
        : seconds > 0
          ? `남은 ${seconds}초 · 자동 지우기`
          : '안내 지우는 중…'}
    </p>
  )
}
