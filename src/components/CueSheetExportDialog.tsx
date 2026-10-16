import { useEffect, useRef, useState } from 'react'
import {
  CuesheetOptionsSchema,
  cuesheetPreset,
  type CuesheetJob,
  type CuesheetOptions,
} from '../../shared/cuesheet'
import { usePresentationStore as store } from '../store'
import { flushPersistence } from '../store/persistence'
import { useModalGuard } from '../hooks/useModalGuard'
import CuesheetPdfPreview from './CuesheetPdfPreview'
export default function CueSheetExportDialog({
  setlistId,
  onClose,
}: {
  setlistId: string
  onClose: () => void
}) {
  const list = store((state) => state.setlists.find((list) => list.id === setlistId)),
    [options, setOptions] = useState(() => cuesheetPreset('public')),
    [job, setJob] = useState<CuesheetJob | null>(null),
    [generating, setGenerating] = useState(false),
    [busy, setBusy] = useState(false),
    [page, setPage] = useState(1),
    [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const generation = useRef(0),
    pending = useRef<string | null>(null),
    root = useRef<HTMLDivElement>(null)
  useModalGuard(true, () => {
    if (!busy) onClose()
  })
  const create = async () => {
    const current = ++generation.current,
      old = pending.current,
      requestId = crypto.randomUUID()
    pending.current = requestId
    setGenerating(true)
    setReady(false)
    setJob(null)
    setPage(1)
    setError('')
    setNotice('')
    if (old) void window.ipcRenderer.closeCuesheet(old).catch(() => {})
    try {
      window.dispatchEvent(new Event('propre-flush-edits'))
      await flushPersistence()
      await store.getState().refreshWorkspace()
      if (current !== generation.current) return
      const latest = store
        .getState()
        .setlists.find((list) => list.id === setlistId && !list.deletedAt)
      if (!latest) throw new Error('출력할 예배를 다시 열어주세요.')
      const next = await window.ipcRenderer.previewCuesheet({
        requestId,
        setlistId,
        revision: latest.revision,
        options: CuesheetOptionsSchema.parse(options),
      })
      if (current === generation.current) setJob(next)
      else void window.ipcRenderer.closeCuesheet(next.id).catch(() => {})
    } catch (failure) {
      if (current === generation.current)
        setError(
          failure instanceof Error
            ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
            : 'PDF를 만들지 못했습니다.',
        )
    } finally {
      if (current === generation.current) setGenerating(false)
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => void create(), 200)
    return () => clearTimeout(timer)
  }, [JSON.stringify(options), setlistId])
  useEffect(
    () => () => {
      generation.current++
      if (pending.current) void window.ipcRenderer.closeCuesheet(pending.current).catch(() => {})
    },
    [],
  )
  useEffect(() => {
    root.current?.querySelector<HTMLSelectElement>('select')?.focus()
  }, [])
  useEffect(() => {
    if (!job) return
    let disposed = false
    const timer = setInterval(() => {
      void window.ipcRenderer
        .getCuesheetStatus(job.id)
        .then((next) => {
          if (!disposed) setJob(next)
        })
        .catch(() => {
          if (!disposed) setError('미리보기가 만료되었습니다. 다시 만들어주세요.')
        })
    }, 3000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [job?.id])
  const cancel = () => {
    generation.current++
    setGenerating(false)
    const id = pending.current
    pending.current = null
    if (id) void window.ipcRenderer.closeCuesheet(id).catch(() => {})
    setNotice('미리보기를 취소했습니다. 다시 만들 수 있습니다.')
  }
  const output = async (action: 'save' | 'print') => {
    if (!job) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result =
        action === 'save'
          ? await window.ipcRenderer.saveCuesheet(job.id)
          : await window.ipcRenderer.printCuesheet(job.id)
      if (result.success) {
        setNotice(
          action === 'save'
            ? 'PDF 저장 완료'
            : 'OS에 인쇄 요청을 전달했습니다. 실제 용지 출력은 프린터에서 확인해주세요.',
        )
        if (action === 'save') setJob({ ...job, saved: true })
      } else if (!result.canceled) setError(result.error || '출력 작업을 완료하지 못했습니다.')
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : '출력 작업을 완료하지 못했습니다.',
      )
    } finally {
      setBusy(false)
    }
  }
  const stale = !!job && (job.stale || list?.revision !== job.revision)
  const fields = {
    leader: '담당자',
    operatorNote: '운영 메모',
    stageNote: '무대 안내 초안',
    policies: '화면·소리 정책',
    materials: '자료 이름',
    sections: '곡 구간 순서',
    hosts: '웹 호스트명',
    times: '계획 시각',
  } as const
  return (
    <div className="fixed inset-0 z-[88] flex items-center justify-center bg-black/65 p-3">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label="큐시트 인쇄·PDF"
        data-modal="true"
        className="flex h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/10 bg-gray-900 text-gray-200 shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h3 className="break-words text-sm font-semibold">
              {job?.title || list?.title} · 큐시트 인쇄·PDF
            </h3>
            <p className="mt-1 text-[11px] text-gray-500">
              저장된 예배 기준 · 현재 송출 유지 · 실제 PDF 페이지 미리보기
            </p>
          </div>
          <button type="button" className="workbench-button" disabled={busy} onClick={onClose}>
            닫기
          </button>
        </header>
        <div className="flex shrink-0 flex-wrap gap-2 border-b border-white/10 px-4 py-3 text-xs">
          <select
            className="workbench-field"
            aria-label="큐시트 출력 프리셋"
            disabled={busy}
            value={options.preset}
            onChange={(event) =>
              setOptions({
                ...cuesheetPreset(event.target.value as CuesheetOptions['preset']),
                orientation: options.orientation,
                size: options.size,
              })
            }
          >
            <option value="public">공용 · 메모 제외</option>
            <option value="team">찬양팀 · 구간 포함</option>
            <option value="operator">운영자용 · 담당자/운영 메모 포함</option>
          </select>
          <select
            className="workbench-field"
            aria-label="큐시트 용지 방향"
            disabled={busy}
            value={options.orientation}
            onChange={(event) =>
              setOptions({
                ...options,
                orientation: event.target.value as CuesheetOptions['orientation'],
              })
            }
          >
            <option value="portrait">A4 세로</option>
            <option value="landscape">A4 가로</option>
          </select>
          <select
            className="workbench-field"
            aria-label="큐시트 글자 크기"
            disabled={busy}
            value={options.size}
            onChange={(event) =>
              setOptions({ ...options, size: event.target.value as CuesheetOptions['size'] })
            }
          >
            <option value="normal">보통 글자 · 11pt</option>
            <option value="large">큰 글자 · 13pt</option>
          </select>
          <details>
            <summary className="workbench-button cursor-pointer">포함 정보</summary>
            <div className="mt-2 flex max-w-3xl flex-wrap gap-x-4 gap-y-2 rounded border border-white/10 p-3">
              {Object.entries(fields).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={options[key as keyof typeof fields]}
                    onChange={(event) => setOptions({ ...options, [key]: event.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </details>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-black/25 p-4">
          {(options.leader || options.operatorNote || options.stageNote || options.hosts) && (
            <p className="mb-3 rounded border border-amber-200/20 bg-amber-200/5 p-2 text-xs text-amber-200">
              포함 정보:{' '}
              {(['leader', 'operatorNote', 'stageNote', 'hosts'] as const)
                .filter((key) => options[key])
                .map((key) => fields[key])
                .join(' · ')}
            </p>
          )}
          {stale && (
            <p role="status" className="mb-3 text-xs text-amber-200">
              예배 내용이 바뀌었습니다 · 이전 내용 기준 미리보기입니다.
            </p>
          )}
          {error && (
            <p role="alert" className="mb-3 break-words text-xs text-red-300">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="mb-3 text-xs text-gray-300">
              {notice}
            </p>
          )}
          {generating && (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-xs text-gray-400">
              <p role="status">PDF 페이지 만드는 중…</p>
              <button type="button" className="workbench-button" onClick={cancel}>
                미리보기 취소
              </button>
            </div>
          )}
          {!generating && job && (
            <CuesheetPdfPreview key={job.id} url={job.url} page={page} onReady={setReady} />
          )}
          {!generating && !job && (
            <p className="py-6 text-center text-xs text-gray-500">
              출력 옵션을 확인하고 다시 만들어주세요.
            </p>
          )}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="workbench-button"
              disabled={busy || !job || page <= 1}
              onClick={() => {
                setReady(false)
                setPage(page - 1)
              }}
            >
              이전 페이지
            </button>
            <span>{job ? `${page} / ${job.pages}` : '페이지 준비 중'}</span>
            <button
              type="button"
              className="workbench-button"
              disabled={busy || !job || page >= job.pages}
              onClick={() => {
                setReady(false)
                setPage(page + 1)
              }}
            >
              다음 페이지
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="workbench-button"
              disabled={busy || generating}
              onClick={() => void create()}
            >
              {stale ? '최신 내용으로 다시 만들기' : '다시 만들기'}
            </button>
            {job?.saved && (
              <button
                type="button"
                className="workbench-button"
                disabled={busy}
                onClick={() =>
                  void window.ipcRenderer
                    .revealCuesheet(job.id)
                    .catch(() => setError('저장한 파일을 찾지 못했습니다.'))
                }
              >
                파일 위치 보기
              </button>
            )}
            <button
              type="button"
              className="workbench-button"
              disabled={busy || generating || !job || !ready || !!error}
              onClick={() => void output('print')}
            >
              인쇄
            </button>
            <button
              type="button"
              className="workbench-button workbench-button-primary"
              disabled={busy || generating || !job || !ready || !!error}
              onClick={() => void output('save')}
            >
              {stale ? '이전 내용 PDF 저장' : 'PDF 저장'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
