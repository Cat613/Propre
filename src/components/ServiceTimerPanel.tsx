import { useState } from 'react'
import { usePresentationStore as store } from '../store'
import { useServiceTimer } from '../hooks/useServiceTimer'
import {
  timerDisplay,
  serviceTiming,
  formatTimer,
  formatDuration,
  type TimerAction,
} from '../../shared/service-timer'
import type { ServicePlan } from '../../shared/service-plan'
export default function ServiceTimerPanel({
  plan,
  onStartTime,
}: {
  plan: ServicePlan
  onStartTime: (value: string | undefined) => Promise<boolean>
}) {
  const sampled = store((state) => state.serviceTimer),
    session = store((state) => state.serviceSession),
    stage = store((state) => state.isStageEnabled),
    lists = store((state) => state.setlists)
  const timer = useServiceTimer(sampled),
    [pendingStage, setPendingStage] = useState<boolean | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [start, setStart] = useState(() => {
    if (!plan.plannedStartAt) return ''
    const date = new Date(plan.plannedStartAt)
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  })
  const command = async (action: TimerAction['action'], show = false) => {
    if (!sampled) return
    setBusy(true)
    setError('')
    try {
      const base = { requestId: crypto.randomUUID(), expectedRevision: sampled.revision }
      const next = await window.ipcRenderer.serviceTimer(
        action === 'stage' ? { ...base, action, show } : { ...base, action },
      )
      store.setState((previous) =>
        !previous.serviceTimer || !next || next.revision >= previous.serviceTimer.revision
          ? { serviceTimer: next }
          : {},
      )
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : '타이머를 변경하지 못했습니다.',
      )
    } finally {
      setBusy(false)
      setPendingStage(null)
    }
  }
  const owner = lists.find((list) => list.id === session?.setlistId),
    cue = owner?.servicePlan?.items.find((cue) => cue.id === timer?.cueId)
  const display = timer && timerDisplay(timer),
    timing =
      timer &&
      session &&
      owner?.servicePlan &&
      serviceTiming(owner.servicePlan, session, timer, Date.now())
  return (
    <details
      className="border-b border-white/5 px-3 py-2 text-[10px] text-gray-400"
      aria-label="예배 진행 타이머"
    >
      <summary className="cursor-pointer py-1">
        {timer && timer.state !== 'finished'
          ? `${cue?.title || '현재 순서'} · ${formatTimer(timer.cueElapsedMs)} 경과`
          : '진행 타이머'}
      </summary>
      <div className="mt-2 space-y-2">
        {!timer || timer.state === 'finished' ? (
          <p>순서를 진행한 뒤 타이머를 시작하세요.</p>
        ) : (
          <>
            <div
              className={`rounded-lg border p-2 ${display?.overtime ? 'border-red-300/40 text-red-200' : display?.warning ? 'border-amber-300/40 text-amber-200' : 'border-white/10 text-gray-200'}`}
            >
              <p className="font-mono text-lg" aria-label="현재 타이머">
                {display?.text} {display?.label}
                {timer.state === 'paused' ? ' · 일시정지' : ''}
              </p>
              {timer.reason && (
                <p>
                  {timer.reason === 'sleep'
                    ? '절전으로 일시정지 · 직접 재개해주세요.'
                    : timer.reason === 'emergency'
                      ? '전체 중지로 일시정지 · 무대 표시는 꺼졌습니다.'
                      : '앱 재시작으로 일시정지 · 직접 재개해주세요.'}
                </p>
              )}
              {timer.mode === 'countdown' && (
                <p className="mt-1">
                  계획{' '}
                  {cue?.durationSeconds === undefined
                    ? '미정'
                    : formatDuration(cue.durationSeconds)}{' '}
                  · 타이머 {formatDuration(timer.targetSeconds || 0)}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className="workbench-button workbench-compact-action"
                disabled={busy}
                onClick={() =>
                  void command(
                    timer.state === 'running'
                      ? 'pause'
                      : timer.state === 'idle'
                        ? 'start'
                        : 'resume',
                  )
                }
              >
                {timer.state === 'running'
                  ? '타이머 일시정지'
                  : timer.state === 'idle'
                    ? '타이머 시작'
                    : '타이머 재개'}
              </button>
              <button
                type="button"
                className="workbench-button workbench-compact-action"
                disabled={busy}
                onClick={() => void command('reset')}
              >
                타이머 초기화
              </button>
              {timer.mode === 'countdown' && (
                <button
                  type="button"
                  className="workbench-button workbench-compact-action"
                  disabled={busy}
                  onClick={() => void command('extend')}
                >
                  타이머 +1분
                </button>
              )}
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={pendingStage ?? timer.showOnStage}
                disabled={busy || (!stage && !timer.showOnStage)}
                onChange={(event) => {
                  setPendingStage(event.target.checked)
                  void command('stage', event.target.checked)
                }}
              />
              타이머 무대 표시
            </label>
            {!stage && <p>무대 표시를 켜려면 무대 화면을 열어주세요.</p>}
            <button
              type="button"
              className="text-blue-300"
              disabled={busy}
              onClick={() => void command('apply-plan')}
            >
              현재 순서 설정을 타이머에도 반영
            </button>
            {timing && (
              <div className="space-y-1">
                <p>전체 경과 {formatTimer(timing.totalElapsedMs)}</p>
                <p>
                  {timing.delayMs === undefined
                    ? '일부 시간 미정 · 지연 계산 불가'
                    : `계획 대비 ${formatTimer(timing.delayMs)} ${timing.delayMs >= 0 ? '지연' : '빠름'}`}
                </p>
                <p>
                  {timing.expectedEndAt
                    ? `예상 종료 ${new Date(timing.expectedEndAt).toLocaleTimeString('ko-KR', { timeZone: owner?.servicePlan?.timezone, hour: '2-digit', minute: '2-digit', hour12: false })}`
                    : `종료 시각 미정 · 알려진 남은 합 ${Math.ceil(timing.knownRemainingMs / 60000)}분`}
                </p>
              </div>
            )}
          </>
        )}
        <label className="block">
          계획 시작 시각 · 이 컴퓨터 시간대
          <input
            type="datetime-local"
            aria-label="계획 시작 시각"
            className="workbench-field mt-1 w-full"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="workbench-button w-full justify-center"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError('')
            try {
              if (!(await onStartTime(start ? new Date(start).toISOString() : undefined)))
                setError('계획 시작 시각을 저장하지 못했습니다.')
            } catch {
              setError('시각을 확인해주세요.')
            } finally {
              setBusy(false)
            }
          }}
        >
          계획 시각 저장
        </button>
        {error && (
          <p role="alert" className="break-words text-red-300">
            {error}
          </p>
        )}
      </div>
    </details>
  )
}
