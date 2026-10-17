import { useEffect, useRef, useState } from 'react'
import type { Setlist } from '../../shared/setlists'
import {
  cuePresentation,
  preflightLabels,
  preflightSummary,
  type PreflightRun,
} from '../../shared/preflight'
import { usePresentationStore as store } from '../store'
import { flushPersistence } from '../store/persistence'
import { slideLayoutRisk } from '../store/preflight-layout'
import { useModalGuard } from '../hooks/useModalGuard'
export default function PreflightDialog({
  list,
  onClose,
  onCue,
}: {
  list: Setlist
  onClose: () => void
  onCue: (id: string) => void
}) {
  useModalGuard(true, onClose)
  const [run, setRun] = useState<PreflightRun | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [measuring, setMeasuring] = useState(0),
    [fontRevision, setFontRevision] = useState(0),
    [acknowledging, setAcknowledging] = useState(false)
  const generation = useRef(0),
    ackPending = useRef(false),
    ref = useRef<HTMLDivElement>(null),
    focus = useRef(document.activeElement as HTMLElement | null)
  const dependency = store((state) =>
    JSON.stringify([
      state.setlists.find((entry) => entry.id === list.id)?.revision,
      state.setlistSongs.map((song) => [song.presentation.id, song.presentation.revision]),
      state.cuePresentations.map((entry) => [entry.presentation.id, entry.presentation.revision]),
      state.cueResources,
      state.screenHealth,
      state.stageCurrentFontSize,
      state.globalSlideStyle,
      state.saveState,
    ]),
  )
  const fonts = `${document.fonts?.status || 'unavailable'}:${document.fonts?.size || 0}:${fontRevision}`
  const saveState = store((state) => state.saveState)
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const done = () => setFontRevision((value) => value + 1)
    document.fonts?.addEventListener('loadingdone', done)
    return () => {
      generation.current++
      focus.current?.focus()
      document.fonts?.removeEventListener('loadingdone', done)
    }
  }, [])
  useEffect(() => {
    let disposed = false
    const refresh = () =>
      window.ipcRenderer
        .preflight({ action: 'get', setlistId: list.id, fonts })
        .then((next) => {
          if (!disposed && !ackPending.current) setRun(next)
        })
        .catch(() => {
          if (!disposed) setError('점검 상태를 불러오지 못했습니다.')
        })
    void refresh()
    const off = window.ipcRenderer.on('preflight-changed', (next: PreflightRun) => {
      if (next.setlistId === list.id) {
        setRun(next)
        if (next.status !== 'running') void refresh()
      }
    })
    const offDisplays = window.ipcRenderer.on('displays-changed', () => {
      void refresh()
    })
    const timer = setInterval(() => {
      void refresh()
    }, 5000)
    return () => {
      disposed = true
      off()
      offDisplays()
      clearInterval(timer)
    }
  }, [list.id, dependency, fonts])
  const start = async () => {
    const current = ++generation.current
    setBusy(true)
    setError('')
    setMeasuring(0)
    try {
      window.dispatchEvent(new Event('propre-flush-edits'))
      await flushPersistence()
      await store.getState().refreshWorkspace()
      const state = store.getState(),
        latest = state.setlists.find((entry) => entry.id === list.id)!
      const presentations = new Map(
        latest.servicePlan!.items.flatMap((cue) => {
          const p = cuePresentation(cue, latest.items, state.setlistSongs, state.cuePresentations)
          return p ? [[p.id, p] as const] : []
        }),
      )
      const layouts: {
        presentationId: string
        revision: number
        warning: boolean
        unmeasured: boolean
      }[] = []
      let count = 0
      for (const p of presentations.values()) {
        let warning = false,
          unmeasured = false
        for (const slide of p.slides) {
          if (current !== generation.current) return
          if (++count > 10000) {
            unmeasured = true
            break
          }
          const check = slideLayoutRisk(p, slide)
          warning ||= check.warning
          unmeasured ||= check.unmeasured
          if (count % 20 === 0) {
            setMeasuring(count)
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
          }
        }
        layouts.push({ presentationId: p.id, revision: p.revision || 0, warning, unmeasured })
      }
      if (current !== generation.current) return
      const next = await window.ipcRenderer.preflight({
        action: 'start',
        setlistId: list.id,
        revision: latest.revision,
        fonts,
        layouts,
      })
      if (current === generation.current) setRun(next)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : '점검하지 못했습니다.',
      )
    } finally {
      if (current === generation.current) setBusy(false)
    }
  }
  const cancel = async () => {
    generation.current++
    setBusy(false)
    try {
      if (run?.status === 'running')
        setRun(await window.ipcRenderer.preflight({ action: 'cancel', runId: run.id }))
    } catch {
      setError('점검 취소 상태를 확인하지 못했습니다. 다시 검사해주세요.')
    }
  }
  const summary = run
    ? preflightSummary({
        ...run,
        stale: run.stale || acknowledging || busy || saveState !== 'saved',
      })
    : null
  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/65 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
        if (event.key === 'Tab') {
          const fields = [
            ...(ref.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), summary',
            ) || []),
          ].filter((element) => element.getClientRects().length)
          if (event.shiftKey && document.activeElement === fields[0]) {
            event.preventDefault()
            fields.at(-1)?.focus()
          } else if (!event.shiftKey && document.activeElement === fields.at(-1)) {
            event.preventDefault()
            fields[0]?.focus()
          }
        }
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="예배 사전 점검"
        data-modal="true"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-white/10 bg-gray-900 text-gray-200 shadow-2xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-white/10 p-4">
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-sm font-semibold">{list.title} · 사전 점검</h3>
            <p className="mt-1 text-xs text-gray-500">
              현재 송출을 유지하며 검사합니다. 실제 화면·소리는 직접 확인해주세요.
            </p>
          </div>
          <button type="button" className="workbench-button" onClick={onClose}>
            닫기
          </button>
        </header>
        <div className="min-h-0 space-y-3 overflow-auto p-4">
          {error && (
            <p role="alert" className="text-xs text-red-300">
              {error}
            </p>
          )}
          {run?.error && (
            <p role="alert" className="text-xs text-red-300">
              {run.error}
            </p>
          )}
          {run?.stale && (
            <p role="status" className="text-xs text-amber-200">
              재검사 필요 · 이전 내용 기준
            </p>
          )}
          {saveState !== 'saved' && (
            <p className="text-xs text-amber-200">
              저장 확인 필요 · 준비 완료를 판단하지 않습니다.
            </p>
          )}
          {busy && (
            <p className="text-xs text-gray-400" role="status">
              본문 측정 중 · {measuring}개 확인
            </p>
          )}
          {run?.status === 'running' && (
            <p className="text-xs text-gray-400" role="status">
              자료 검사 중 · {run.processed}/{run.total}
            </p>
          )}
          {run?.status === 'cancelled' && (
            <p className="text-xs text-gray-400">
              점검을 취소했습니다. 부분 결과로 준비 완료를 판단하지 않습니다.
            </p>
          )}
          {summary && (
            <p className="rounded-lg bg-white/5 p-3 text-xs" role="status">
              {summary.ready
                ? '준비 확인 완료 · 현장 체크 포함'
                : `확인 필요 ${summary.blocking}개 · 권장 ${summary.warning}개 · 수동 확인 ${summary.manual}개`}
            </p>
          )}
          {!run && !busy && (
            <p className="py-5 text-center text-xs text-gray-500">
              파일·슬라이드·출력 창을 검사하고 현장 확인을 기록하세요.
            </p>
          )}
          {run?.results
            .filter((result) => result.status !== 'pass')
            .map((result) => (
              <div
                key={result.checkId}
                className="flex items-start gap-3 rounded-lg border border-white/10 p-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words">
                    {result.severity === 'blocking'
                      ? '확인 필요'
                      : result.severity === 'warning'
                        ? '권장'
                        : '직접 확인'}{' '}
                    · {result.title ? `${result.title} · ` : ''}
                    {preflightLabels[result.code] || result.code}
                  </p>
                  {result.cueId && (
                    <p className="mt-1 break-words text-gray-500">
                      {list.servicePlan?.items.find((cue) => cue.id === result.cueId)?.title ||
                        '이전 순서'}
                    </p>
                  )}
                  {result.checkedAt && (
                    <p className="mt-1 text-gray-500">
                      확인 {new Date(result.checkedAt).toLocaleTimeString('ko-KR')}
                    </p>
                  )}
                </div>
                {result.cueId && (
                  <button
                    type="button"
                    className="workbench-button shrink-0"
                    onClick={() => onCue(result.cueId!)}
                  >
                    수정하기
                  </button>
                )}
                {['manual', 'warning'].includes(result.severity) && (
                  <label className="flex shrink-0 items-center gap-1 text-[10px]">
                    <input
                      type="checkbox"
                      aria-label={`${preflightLabels[result.code]} 직접 확인함`}
                      disabled={acknowledging || run.status !== 'completed' || run.stale}
                      checked={result.status === 'acknowledged'}
                      onChange={async (event) => {
                        setAcknowledging(true)
                        ackPending.current = true
                        const checked = event.target.checked
                        setRun({
                          ...run,
                          results: run.results.map((entry) =>
                            entry.checkId === result.checkId
                              ? {
                                  ...entry,
                                  status: checked
                                    ? 'acknowledged'
                                    : entry.severity === 'manual'
                                      ? 'unchecked'
                                      : 'fail',
                                }
                              : entry,
                          ),
                        })
                        try {
                          setRun(
                            await window.ipcRenderer.preflight({
                              action: 'ack',
                              runId: run.id,
                              checkId: result.checkId,
                              fingerprint: run.fingerprint,
                              fonts,
                              acknowledged: checked,
                            }),
                          )
                        } catch {
                          setRun(run)
                          setError('점검 내용이 바뀌었거나 저장하지 못했습니다. 다시 검사해주세요.')
                        } finally {
                          ackPending.current = false
                          setAcknowledging(false)
                        }
                      }}
                    />
                    직접 확인함
                  </label>
                )}
              </div>
            ))}
          {!!run?.results.some((result) => result.status === 'pass') && (
            <details>
              <summary className="cursor-pointer text-xs text-gray-500">정상 항목 보기</summary>
              <ul className="mt-2 space-y-1 text-xs text-gray-500">
                {run.results
                  .filter((result) => result.status === 'pass')
                  .map((result) => (
                    <li key={result.checkId}>
                      {result.cueId
                        ? `${list.servicePlan?.items.find((cue) => cue.id === result.cueId)?.title} · `
                        : ''}
                      {preflightLabels[result.code]}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-white/10 p-4">
          {busy || run?.status === 'running' ? (
            <button type="button" className="workbench-button" onClick={() => void cancel()}>
              점검 취소
            </button>
          ) : (
            <button
              type="button"
              className="workbench-button workbench-button-primary"
              disabled={acknowledging}
              onClick={() => void start()}
            >
              {run ? '다시 검사' : '검사 시작'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
