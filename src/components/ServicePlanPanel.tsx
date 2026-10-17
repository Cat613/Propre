import { withOperatorLock } from '../store/preparation'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, Edit3, Plus, Trash2, Undo2, X } from 'lucide-react'
import type { Setlist } from '../../shared/setlists'
import type { CueItem, ServicePlan } from '../../shared/service-plan'
import { CueItemSchema, ServicePlanSchema } from '../../shared/service-plan'
import type { AttachCue, PreparedCue } from '../../shared/service-session'
import { usePresentationStore as store } from '../store'
import { flushPersistence } from '../store/persistence'
import { useModalGuard } from '../hooks/useModalGuard'
import StageMessagePanel from './StageMessagePanel'
import ServiceTimerPanel from './ServiceTimerPanel'
const PreflightDialog = lazy(() => import('./PreflightDialog'))
const names: Record<CueItem['kind'], string> = {
  song: '찬양',
  prayer: '기도',
  scripture: '봉독',
  sermon: '설교',
  offering: '헌금',
  announcement: '광고',
  custom: '기타',
}
const policyNames = {
  keep: '현재 화면 유지',
  'background-only': '배경만 유지',
  black: '검정 화면',
  bound: '연결 자료 송출',
}
const cleanError = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : '저장하지 못했습니다. 다시 시도해주세요.'
export default function ServicePlanPanel({ list }: { list: Setlist }) {
  const plan = list.servicePlan!
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<CueItem | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [prepared, setPrepared] = useState<PreparedCue | null>(null)
  const [undo, setUndo] = useState<{ plan: ServicePlan; rows: Setlist['items'] }[]>([])
  const [preflight, setPreflight] = useState(false)
  const selectionGeneration = useRef(0)
  const pendingFocus = useRef<string | null>(null)
  const modalOpen = store((state) => state.isModalOpen)
  const session = store((s) => s.serviceSession)
  const manualOutput = store((s) => s.serviceManualOutput)
  const cue = plan.items.find((x) => x.id === selected)
  const current =
    session?.setlistId === list.id && session.status !== 'finished' ? session.currentCueId : null
  const nextCue = current
    ? plan.items
        .slice(plan.items.findIndex((item) => item.id === current) + 1)
        .find((item) => !session?.states[item.id])
    : undefined
  const owner = store((s) => s.setlists.find((x) => x.id === session?.setlistId)?.title)
  const selectedIndex = plan.items.findIndex((x) => x.id === selected)
  const minutes = plan.items.reduce((sum, item) => sum + (item.durationSeconds || 0), 0) / 60
  useEffect(() => {
    selectionGeneration.current++
    setPrepared(null)
  }, [list.revision])
  const choose = (id: string, focus = false) => {
    if (focus) pendingFocus.current = `cue-row-${id}`
    selectionGeneration.current++
    setPrepared(null)
    setSelected(id)
    setError('')
  }
  useEffect(() => {
    if (!editing && !preflight && !modalOpen && pendingFocus.current) {
      document.getElementById(pendingFocus.current)?.focus()
      pendingFocus.current = null
    }
  }, [editing, preflight, modalOpen, selected, list.revision])
  const save = async (
    next: ServicePlan,
    source?: AttachCue['source'],
    editedCueId?: string,
    basePlan: ServicePlan = plan,
    restoreSongRows?: Setlist['items'],
  ) => {
    setBusy(true)
    setError('')
    setPrepared(null)
    try {
      await flushPersistence()
      const loaded = await window.ipcRenderer.bootstrap()
      const fresh = loaded.setlists.find((x) => x.id === list.id)
      if (!fresh || JSON.stringify(fresh.servicePlan) !== JSON.stringify(basePlan))
        throw new Error(
          '다른 작업에서 순서가 바뀌었습니다. 입력은 유지했으니 최신 목록을 확인해주세요.',
        )
      const result =
        source && editedCueId
          ? await window.ipcRenderer.attachServiceCue({
              requestId: crypto.randomUUID(),
              setlistId: list.id,
              cueId: editedCueId,
              expectedSetlistRevision: fresh.revision,
              plan: next,
              source,
            })
          : await window.ipcRenderer.saveServicePlan({
              requestId: crypto.randomUUID(),
              setlistId: list.id,
              expectedSetlistRevision: fresh.revision,
              plan: next,
              restoreSongRows,
            })
      store.setState(result)
      await store.getState().refreshWorkspace()
      setUndo((history) => [
        ...history.slice(-19),
        { plan: structuredClone(plan), rows: structuredClone(list.items) },
      ])
      return true
    } catch (failure) {
      setError(cleanError(failure))
      await store
        .getState()
        .refreshWorkspace()
        .catch(() => {})
      return false
    } finally {
      setBusy(false)
    }
  }
  const move = async (offset: number) => {
    if (
      selectedIndex < 0 ||
      selectedIndex + offset < 0 ||
      selectedIndex + offset >= plan.items.length
    )
      return
    const next = structuredClone(plan)
    const [item] = next.items.splice(selectedIndex, 1)
    next.items.splice(selectedIndex + offset, 0, item)
    await save(next)
  }
  const prepare = async () => {
    if (!cue) return
    const generation = ++selectionGeneration.current
    setBusy(true)
    setError('')
    setPrepared(null)
    try {
      await flushPersistence()
      await store.getState().refreshWorkspace()
      const latest = store.getState().setlists.find((x) => x.id === list.id)!
      const result = await window.ipcRenderer.prepareServiceCue({
        setlistId: list.id,
        cueId: cue.id,
        expectedSetlistRevision: latest.revision,
      })
      if (generation === selectionGeneration.current) setPrepared(result)
    } catch (failure) {
      setError(cleanError(failure))
    } finally {
      setBusy(false)
    }
  }
  const progress = async () => {
    if (!prepared) return
    setBusy(true)
    setError('')
    try {
      const value = await withOperatorLock(() =>
        window.ipcRenderer.commitServiceCue(prepared.token),
      )
      store.setState({ serviceSession: value })
      setPrepared(null)
    } catch (failure) {
      setError(cleanError(failure))
      setPrepared(null)
    } finally {
      setBusy(false)
    }
  }
  const finish = async (skip = false) => {
    setBusy(true)
    setError('')
    try {
      store.setState({ serviceSession: await window.ipcRenderer.finishService(skip) })
      setPrepared(null)
    } catch (failure) {
      setError(cleanError(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="예배 전체 순서">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
        <span className="text-[10px] text-gray-500">
          {plan.items.length}개 순서
          {minutes > 0
            ? ` · ${Math.round(minutes * 10) / 10}분${plan.items.some((item) => item.durationSeconds === undefined) ? ' 이상' : ''}`
            : ''}
        </span>
        <button
          type="button"
          className="workbench-button workbench-compact-action"
          onClick={() => setPreflight(true)}
          disabled={busy}
        >
          사전 점검
        </button>
        <button
          type="button"
          className="workbench-button workbench-compact-action"
          disabled={busy}
          onClick={() => setEditing('new')}
          id={`cue-add-${list.id}`}
        >
          <Plus size={12} />
          순서 추가
        </button>
      </div>
      <div className="workbench-scroll min-h-0 flex-1 overflow-y-auto">
        <StageMessagePanel key={cue?.id || 'general'} draft={cue?.stageNote || ''} />
        <ServiceTimerPanel
          plan={plan}
          onStartTime={(value) => save({ ...plan, plannedStartAt: value })}
        />
        {session && session.status !== 'finished' && (
          <div
            className="flex flex-wrap items-center gap-2 border-b border-white/5 px-3 py-2 text-[10px] text-amber-200"
            role="status"
          >
            <span className="min-w-0 flex-1 break-words">
              {owner} ·{' '}
              {session.status === 'interrupted' ? '중단됨 · 다시 준비해 재개' : '예배 진행 중'}
              {session.status === 'running' && manualOutput ? ' · 수동 송출 중' : ''}
            </span>
            {current && nextCue && (
              <button
                type="button"
                className="workbench-button workbench-compact-action"
                disabled={busy}
                onClick={() => choose(nextCue.id, true)}
              >
                다음 순서 준비
              </button>
            )}
            <button
              type="button"
              className="workbench-button workbench-compact-action"
              disabled={busy}
              onClick={() => void finish()}
            >
              예배 마치기
            </button>
          </div>
        )}
        <div className="p-2" role="list" aria-label="전체 순서 목록">
          {!plan.items.length && (
            <div className="p-4 text-center text-xs leading-relaxed text-gray-500">
              기도·말씀·광고를 추가해
              <br />
              예배 전체 순서를 준비하세요.
              <p className="mt-2 text-[10px]">찬양은 Songs의 ＋로 추가할 수 있습니다.</p>
            </div>
          )}
          {plan.items.map((item, index) => (
            <div key={item.id} role="listitem">
              <button
                type="button"
                id={`cue-row-${item.id}`}
                className={`mb-1 flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${selected === item.id ? 'border-blue-400/60 bg-blue-500/10' : 'border-transparent hover:bg-white/5'}`}
                aria-label={`${index + 1}. ${item.title}`}
                aria-pressed={selected === item.id}
                onClick={() => choose(item.id)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') event.stopPropagation()
                  if (
                    event.altKey &&
                    (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
                    selected === item.id
                  ) {
                    event.preventDefault()
                    void move(event.key === 'ArrowUp' ? -1 : 1)
                  } else if (
                    !event.altKey &&
                    (event.key === 'ArrowUp' || event.key === 'ArrowDown')
                  ) {
                    event.preventDefault()
                    const target = plan.items[index + (event.key === 'ArrowUp' ? -1 : 1)]
                    if (target) choose(target.id, true)
                  }
                }}
              >
                <span className="w-4 shrink-0 text-[10px] text-gray-500">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-gray-200">{item.title}</span>
                  <span className="mt-0.5 block text-[10px] text-gray-500">
                    {names[item.kind]}
                    {item.leader ? ` · ${item.leader}` : ''}
                    {item.operatorNote ? ' · 메모' : ''}
                    {item.materialPending ? ' · 자료 선택 필요' : ''}
                  </span>
                </span>
                {item.durationSeconds !== undefined && (
                  <span className="shrink-0 text-[10px] text-gray-500">
                    {Math.round(item.durationSeconds / 6) / 10}분
                  </span>
                )}
                {current === item.id && (
                  <span className="shrink-0 text-[10px] text-emerald-300">진행 중</span>
                )}
                {session?.states[item.id] === 'skipped' && (
                  <span className="text-[10px] text-gray-500">건너뜀</span>
                )}
              </button>
            </div>
          ))}
        </div>
        {error && (
          <p role="alert" className="shrink-0 break-words px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
        {cue && (
          <div
            className="shrink-0 space-y-2 border-t border-white/10 p-3"
            data-testid="cue-details"
          >
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-200">
                {cue.title}
              </span>
              <button
                type="button"
                className="workbench-button p-1.5"
                aria-label="선택한 순서 편집"
                disabled={busy}
                onClick={() => setEditing(cue)}
              >
                <Edit3 size={12} />
              </button>
              <button
                type="button"
                className="workbench-button p-1.5"
                aria-label="순서 위로"
                disabled={busy || selectedIndex === 0}
                onClick={() => void move(-1)}
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                className="workbench-button p-1.5"
                aria-label="순서 아래로"
                disabled={busy || selectedIndex === plan.items.length - 1}
                onClick={() => void move(1)}
              >
                <ArrowDown size={12} />
              </button>
              <button
                type="button"
                className="workbench-button p-1.5"
                aria-label="선택한 순서 제거"
                title="이 순서와 메모를 콘티에서 제거합니다. 되돌릴 수 있습니다."
                disabled={busy || current === cue.id}
                onClick={() => {
                  void save({
                    ...plan,
                    items: plan.items.filter((item) => item.id !== cue.id),
                  }).then((saved) => {
                    if (saved) {
                      const target =
                        plan.items[selectedIndex + 1]?.id ||
                        plan.items[selectedIndex - 1]?.id ||
                        null
                      setSelected(target)
                      if (target)
                        requestAnimationFrame(() =>
                          document.getElementById(`cue-row-${target}`)?.focus(),
                        )
                    }
                  })
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
            <p className="text-[10px] text-gray-500">
              {policyNames[cue.enter.visual]} · 소리 {cue.enter.audio === 'stop' ? '중지' : '유지'}
            </p>
            {cue.operatorNote && (
              <details>
                <summary className="cursor-pointer text-[10px] text-gray-400">운영 메모</summary>
                <p className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-300">
                  {cue.operatorNote}
                </p>
              </details>
            )}
            {current === cue.id && (
              <button
                type="button"
                className="text-[10px] text-gray-500 hover:text-gray-300"
                disabled={busy}
                onClick={() => void finish(true)}
              >
                현재 순서 건너뛰기
              </button>
            )}
          </div>
        )}
        {!!undo.length && (
          <button
            type="button"
            className="workbench-button m-2 shrink-0 justify-center"
            disabled={busy}
            onClick={async () => {
              const prior = undo.at(-1)!
              const remaining = undo.slice(0, -1)
              if (await save(prior.plan, undefined, undefined, plan, prior.rows)) setUndo(remaining)
            }}
          >
            <Undo2 size={12} />
            순서 편집 되돌리기
          </button>
        )}
      </div>
      {cue && (
        <div className="shrink-0 border-t border-white/10 p-2">
          <p className="mb-1 truncate text-[10px] text-gray-400" title={cue.title}>
            선택: {cue.title}
          </p>{' '}
          <div className="flex gap-1.5">
            <button
              type="button"
              className="workbench-button min-w-0 flex-1 justify-center"
              disabled={busy}
              onClick={() => void prepare()}
            >
              {busy ? '처리 중…' : '준비 확인'}
            </button>
            <button
              type="button"
              className="workbench-button workbench-button-primary min-w-0 flex-1 justify-center"
              disabled={
                busy ||
                !prepared ||
                prepared.cueId !== cue.id ||
                prepared.planRevision !== list.revision
              }
              onClick={() => void progress()}
            >
              <ChevronRight size={12} />이 순서 진행
            </button>
          </div>
        </div>
      )}
      {editing && (
        <CueDialog
          key={editing === 'new' ? 'new' : editing.id}
          cue={editing === 'new' ? undefined : editing}
          list={list}
          busy={busy}
          onClose={() => {
            pendingFocus.current = selected ? `cue-row-${selected}` : `cue-add-${list.id}`
            setEditing(null)
          }}
          onSave={async (item, source, basePlan) => {
            const next = structuredClone(basePlan)
            const index = next.items.findIndex((entry) => entry.id === item.id)
            if (index >= 0) next.items[index] = item
            else
              next.items.splice(selectedIndex < 0 ? next.items.length : selectedIndex + 1, 0, item)
            const saved = await save(next, source, item.id, basePlan)
            if (saved) {
              setEditing(null)
              choose(item.id, true)
            }
            return saved
          }}
        />
      )}
      {preflight && (
        <Suspense
          fallback={
            <p role="status" className="p-3 text-xs text-gray-400">
              사전 점검 불러오는 중…
            </p>
          }
        >
          <PreflightDialog
            list={list}
            onClose={() => setPreflight(false)}
            onCue={(id) => {
              setPreflight(false)
              choose(id, true)
              const selectedCue = plan.items.find((item) => item.id === id)
              if (selectedCue) setEditing(selectedCue)
            }}
          />
        </Suspense>
      )}
    </section>
  )
}

function CueDialog({
  cue,
  list,
  busy,
  onClose,
  onSave,
}: {
  cue?: CueItem
  list: Setlist
  busy: boolean
  onClose: () => void
  onSave: (
    cue: CueItem,
    source: AttachCue['source'] | undefined,
    basePlan: ServicePlan,
  ) => Promise<boolean>
}) {
  useModalGuard(true, () => {
    if (!busy) onClose()
  })
  const basePlan = useRef(structuredClone(list.servicePlan!))
  const baseRevision = useRef(list.revision)
  const key = `propre-cue-draft-v1:${list.id}:${cue?.id || 'new'}`
  const initial = (): CueItem => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null')
      if (value && value.baseRevision === list.revision && typeof value.item?.title === 'string') {
        const checked = CueItemSchema.safeParse({
          ...value.item,
          title: value.item.title.trim() || '새 순서',
        })
        if (checked.success) return { ...checked.data, title: value.item.title }
      }
    } catch {
      /* Retain invalid stored drafts for manual recovery. */
    }
    return cue
      ? structuredClone(cue)
      : {
          id: crypto.randomUUID(),
          kind: 'prayer',
          title: '',
          enter: { visual: 'keep', audio: 'keep' },
        }
  }
  const [item, setItem] = useState<CueItem>(initial)
  const [source, setSource] = useState('unchanged')
  const [page, setPage] = useState(1)
  const [slideId, setSlideId] = useState('')
  const [validation, setValidation] = useState('')
  const [conflict, setConflict] = useState(false)
  const library = store((s) => s.library)
  const musicItems = store((s) => s.setlists.find((x) => x.id === s.activeSetlistId)?.music) || []
  const allResources = store((s) => s.outputResources)
  const resources = allResources.filter((resource) => !resource.deletedAt)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [])
  const patch = (updates: Partial<CueItem>) => {
    const next = { ...item, ...updates }
    setItem(next)
    try {
      localStorage.setItem(key, JSON.stringify({ baseRevision: baseRevision.current, item: next }))
    } catch {
      setValidation('입력 복구 기록을 저장하지 못했습니다.')
    }
  }
  const selectedPresentation = library.find((p) => source === `p:${p.id}`)
  const selectedResource = resources.find((r) => source === `r:${r.id}`)
  const ownedPresentations = store((s) => s.cuePresentations)
  const ownedResources = store((s) => s.cueResources)
  const keptPresentation =
    source === 'unchanged' && item.binding?.kind === 'presentation'
      ? ownedPresentations.find(
          (p) => p.presentation.id === (item.binding as { presentationId: string }).presentationId,
        )?.presentation
      : undefined
  const keptResource =
    source === 'unchanged' && item.binding?.kind === 'resource'
      ? ownedResources.find(
          (r) => r.resource.id === (item.binding as { resourceId: string }).resourceId,
        )?.resource
      : undefined
  const shownPresentation = selectedPresentation || keptPresentation
  const shownPDF =
    selectedResource?.kind === 'pdf'
      ? selectedResource
      : keptResource?.kind === 'pdf'
        ? keptResource
        : undefined
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0)
  const submit = async () => {
    try {
      const next = structuredClone(item)
      let attachment: AttachCue['source'] | undefined
      if (source === 'none') {
        delete next.binding
        if (next.enter.visual === 'bound') next.enter.visual = 'keep'
        attachment = { kind: 'none' }
      } else if (selectedPresentation) {
        const id = slideId || selectedPresentation.slides[0]?.id
        if (!id) throw new Error('연결할 슬라이드를 선택해주세요.')
        if (next.kind !== 'song')
          next.binding = {
            kind: 'presentation',
            presentationId: selectedPresentation.id,
            slideId: id,
          }
        attachment = { kind: 'presentation', id: selectedPresentation.id, slideId: id }
      } else if (selectedResource) {
        next.binding = {
          kind: 'resource',
          resourceId: selectedResource.id,
          ...(selectedResource.kind === 'pdf' ? { page, rotation } : {}),
        }
        attachment = {
          kind: 'resource',
          id: selectedResource.id,
          ...(selectedResource.kind === 'pdf' ? { page, rotation } : {}),
        }
      }
      ServicePlanSchema.parse({ version: 1, timezone: list.servicePlan!.timezone, items: [next] })
      if (await onSave(next, attachment, basePlan.current)) localStorage.removeItem(key)
      else {
        setConflict(true)
        setValidation(
          '저장하지 못했습니다. 입력은 유지됩니다. 최신 순서를 확인한 뒤 다시 적용할 수 있습니다.',
        )
      }
    } catch (failure) {
      setValidation(
        failure instanceof Error && failure.name !== 'ZodError'
          ? failure.message
          : '제목·시간·화면 정책을 확인해주세요.',
      )
    }
  }
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          const fields = [
            ...(ref.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary',
            ) || []),
          ].filter((field) => field.getClientRects().length)
          if (event.shiftKey && document.activeElement === fields[0]) {
            event.preventDefault()
            fields.at(-1)?.focus()
          } else if (!event.shiftKey && document.activeElement === fields.at(-1)) {
            event.preventDefault()
            fields[0]?.focus()
          }
        }
        if (event.key === 'Escape' && !busy) {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={cue ? '예배 순서 편집' : '예배 순서 추가'}
        data-modal="true"
        className="flex max-h-[90vh] w-full max-w-md flex-col rounded-xl border border-white/10 bg-gray-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h3 className="text-sm font-semibold text-gray-100">
            {cue ? '예배 순서 편집' : '예배 순서 추가'}
          </h3>
          <button
            type="button"
            className="workbench-button p-1.5"
            aria-label="순서 입력 닫기"
            disabled={busy}
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        <form
          className="min-h-0 overflow-auto space-y-3 p-5"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label className="block space-y-1 text-xs text-gray-400">
            <span>제목</span>
            <input
              className="workbench-field w-full"
              aria-label="순서 제목"
              required
              maxLength={200}
              value={item.title}
              onChange={(event) => patch({ title: event.target.value })}
            />
          </label>
          <div className="flex gap-3">
            <label className="min-w-0 flex-1 space-y-1 text-xs text-gray-400">
              <span>종류</span>
              <select
                className="workbench-field w-full"
                aria-label="순서 종류"
                disabled={cue?.kind === 'song'}
                value={item.kind}
                onChange={(event) => patch({ kind: event.target.value as CueItem['kind'] })}
              >
                {Object.entries(names)
                  .filter(([kind]) => kind !== 'song' || cue?.kind === 'song')
                  .map(([kind, title]) => (
                    <option key={kind} value={kind}>
                      {title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="min-w-0 flex-1 space-y-1 text-xs text-gray-400">
              <span>예상 시간 · 분</span>
              <input
                className="workbench-field w-full"
                aria-label="예상 시간 분"
                type="number"
                min={0}
                max={1440}
                step={0.5}
                placeholder="미정"
                value={item.durationSeconds === undefined ? '' : item.durationSeconds / 60}
                onChange={(event) =>
                  patch({
                    durationSeconds:
                      event.target.value === ''
                        ? undefined
                        : Math.round(Number(event.target.value) * 60),
                  })
                }
              />
            </label>
          </div>
          <details open={!!cue?.operatorNote || !!cue?.binding || !!cue?.materialPending}>
            <summary className="cursor-pointer py-1 text-xs text-gray-400">
              담당자·메모·화면 설정
            </summary>
            <div className="mt-2 space-y-3">
              <label className="block space-y-1 text-xs text-gray-400">
                <span>담당자 · 선택</span>
                <input
                  className="workbench-field w-full"
                  aria-label="순서 담당자"
                  maxLength={100}
                  value={item.leader || ''}
                  onChange={(event) => patch({ leader: event.target.value })}
                />
              </label>
              <label className="block space-y-1 text-xs text-gray-400">
                <span>운영 메모 · 청중에게 표시되지 않음</span>
                <textarea
                  className="workbench-field w-full resize-y"
                  aria-label="운영 메모"
                  rows={3}
                  maxLength={2000}
                  value={item.operatorNote || ''}
                  onChange={(event) => patch({ operatorNote: event.target.value })}
                />
              </label>
              <label className="block space-y-1 text-xs text-gray-400">
                <span>무대 안내 초안 · 진행 시 자동 전송하지 않음</span>
                <textarea
                  className="workbench-field w-full resize-y"
                  aria-label="무대 안내 초안"
                  rows={2}
                  maxLength={2000}
                  value={item.stageNote || ''}
                  onChange={(event) => patch({ stageNote: event.target.value })}
                />
              </label>
              {item.materialPending && item.kind !== 'song' && (
                <label className="flex items-center gap-2 text-xs text-amber-200">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() =>
                      patch({ materialPending: false, enter: { ...item.enter, visual: 'keep' } })
                    }
                  />
                  자료 없이 진행하도록 변경 · 현재 화면 유지
                </label>
              )}
              {(item.kind !== 'song' || item.materialPending) && (
                <label className="block space-y-1 text-xs text-gray-400">
                  <span>송출 자료 · 선택</span>
                  <select
                    className="workbench-field w-full"
                    aria-label="순서 송출 자료"
                    value={source}
                    onChange={(event) => {
                      setSource(event.target.value)
                      setSlideId('')
                      setPage(1)
                    }}
                  >
                    <option value="unchanged">
                      {item.binding ? '현재 연결 유지' : '자료 없음'}
                    </option>
                    <option value="none">자료 연결 해제</option>
                    <optgroup label="찬양·성경 자료">
                      {library
                        .filter((p) => p.slides.length)
                        .map((p) => (
                          <option key={p.id} value={`p:${p.id}`}>
                            {p.title}
                          </option>
                        ))}
                    </optgroup>
                    {item.kind !== 'song' && (
                      <optgroup label="웹·PDF">
                        {resources.map((r) => (
                          <option key={r.id} value={`r:${r.id}`}>
                            {r.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
              )}
              {shownPresentation && item.kind !== 'song' && (
                <label className="block space-y-1 text-xs text-gray-400">
                  <span>시작 슬라이드</span>
                  <select
                    className="workbench-field w-full"
                    aria-label="시작 슬라이드"
                    value={
                      selectedPresentation
                        ? slideId || selectedPresentation.slides[0]?.id
                        : item.binding?.kind === 'presentation'
                          ? item.binding.slideId
                          : ''
                    }
                    onChange={(event) => {
                      if (keptPresentation && item.binding?.kind === 'presentation')
                        patch({ binding: { ...item.binding, slideId: event.target.value } })
                      else setSlideId(event.target.value)
                    }}
                  >
                    {shownPresentation.slides.map((slide, index) => (
                      <option key={slide.id} value={slide.id}>
                        {index + 1}. {(slide.content || '').slice(0, 35) || '빈 슬라이드'}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {shownPDF && (
                <label className="block space-y-1 text-xs text-gray-400">
                  <span>PDF 페이지 · 1~{shownPDF.pageCount}</span>
                  <input
                    className="workbench-field w-full"
                    aria-label="순서 PDF 페이지"
                    type="number"
                    min={1}
                    max={shownPDF.pageCount}
                    step={1}
                    value={
                      keptResource && item.binding?.kind === 'resource' ? item.binding.page : page
                    }
                    onChange={(event) => {
                      if (keptResource && item.binding?.kind === 'resource')
                        patch({ binding: { ...item.binding, page: Number(event.target.value) } })
                      else setPage(Number(event.target.value))
                    }}
                  />
                  <span className="block mt-2">PDF 회전</span>
                  <select
                    className="workbench-field w-full"
                    aria-label="순서 PDF 회전"
                    value={
                      keptResource && item.binding?.kind === 'resource'
                        ? item.binding.rotation || 0
                        : rotation
                    }
                    onChange={(event) => {
                      const value = Number(event.target.value) as 0 | 90 | 180 | 270
                      if (keptResource && item.binding?.kind === 'resource')
                        patch({ binding: { ...item.binding, rotation: value } })
                      else setRotation(value)
                    }}
                  >
                    {[0, 90, 180, 270].map((angle) => (
                      <option key={angle} value={angle}>
                        {angle}°
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block space-y-1 text-xs text-gray-400">
                <span>진행할 때 화면</span>
                <select
                  className="workbench-field w-full"
                  aria-label="진행 화면 정책"
                  disabled={item.kind === 'song'}
                  value={item.enter.visual}
                  onChange={(event) =>
                    patch({
                      enter: {
                        ...item.enter,
                        visual: event.target.value as CueItem['enter']['visual'],
                      },
                    })
                  }
                >
                  {Object.entries(policyNames).map(([value, title]) => (
                    <option
                      key={value}
                      value={value}
                      disabled={
                        value === 'bound' &&
                        !item.binding &&
                        !selectedPresentation &&
                        !selectedResource
                      }
                    >
                      {title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1 text-xs text-gray-400">
                <span>진행할 때 소리</span>
                <select
                  className="workbench-field w-full"
                  aria-label="진행 소리 정책"
                  value={item.enter.audio}
                  onChange={(event) =>
                    patch({
                      enter: { ...item.enter, audio: event.target.value as 'keep' | 'stop' },
                    })
                  }
                >
                  <option value="keep">현재 소리 유지</option>
                  <option value="stop">모든 소리 중지</option>
                </select>
              </label>
            </div>
          </details>
          <label className="block space-y-1 text-xs text-gray-400">
            <span>진행할 때 준비할 음악 · 자동 재생 안 함</span>
            <select
              className="workbench-field w-full"
              aria-label="순서 음악 연결"
              value={item.musicPreparationId || ''}
              onChange={(e) => patch({ musicPreparationId: e.target.value || undefined })}
            >
              <option value="">음악 연결 없음</option>
              {musicItems.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
          <details open={!!cue?.timer}>
            <summary className="cursor-pointer py-1 text-xs text-gray-400">
              타이머 설정 · 선택
            </summary>
            <div className="mt-2 space-y-3 text-xs text-gray-400">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!item.timer}
                  onChange={(event) =>
                    patch({
                      timer: event.target.checked
                        ? {
                            mode: item.durationSeconds ? 'countdown' : 'countup',
                            targetSeconds: item.durationSeconds || undefined,
                            warningSeconds: item.durationSeconds
                              ? Math.min(120, item.durationSeconds)
                              : 0,
                            autoStart: false,
                            showOnStage: false,
                          }
                        : undefined,
                    })
                  }
                />
                별도 타이머 설정 사용
              </label>
              {item.timer && (
                <>
                  <label className="block space-y-1">
                    <span>표시 방식</span>
                    <select
                      className="workbench-field w-full"
                      aria-label="타이머 방식"
                      value={item.timer.mode}
                      onChange={(event) =>
                        patch({
                          timer: {
                            ...item.timer!,
                            mode: event.target.value as 'countdown' | 'countup',
                            targetSeconds:
                              event.target.value === 'countdown'
                                ? item.durationSeconds || 1800
                                : undefined,
                            warningSeconds:
                              event.target.value === 'countdown'
                                ? Math.min(120, item.durationSeconds || 1800)
                                : 0,
                          },
                        })
                      }
                    >
                      <option value="countdown">남은 시간</option>
                      <option value="countup">경과 시간</option>
                    </select>
                  </label>
                  {item.timer.mode === 'countdown' && (
                    <div className="flex gap-3">
                      <label className="min-w-0 flex-1 space-y-1">
                        <span>목표 · 분</span>
                        <input
                          className="workbench-field w-full"
                          aria-label="타이머 목표 분"
                          type="number"
                          min={0.5}
                          max={1440}
                          step={0.5}
                          value={(item.timer.targetSeconds || 0) / 60}
                          onChange={(event) =>
                            patch({
                              timer: {
                                ...item.timer!,
                                targetSeconds: Math.round(Number(event.target.value) * 60),
                              },
                            })
                          }
                        />
                      </label>
                      <label className="min-w-0 flex-1 space-y-1">
                        <span>경고 · 분</span>
                        <input
                          className="workbench-field w-full"
                          aria-label="타이머 경고 분"
                          type="number"
                          min={0}
                          max={(item.timer.targetSeconds || 0) / 60}
                          step={0.5}
                          value={item.timer.warningSeconds / 60}
                          onChange={(event) =>
                            patch({
                              timer: {
                                ...item.timer!,
                                warningSeconds: Math.round(Number(event.target.value) * 60),
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                  )}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={item.timer.autoStart}
                      onChange={(event) =>
                        patch({ timer: { ...item.timer!, autoStart: event.target.checked } })
                      }
                    />
                    이 순서 진행 성공 시 타이머 자동 시작
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={item.timer.showOnStage}
                      onChange={(event) =>
                        patch({ timer: { ...item.timer!, showOnStage: event.target.checked } })
                      }
                    />
                    진행 시 타이머 무대 표시 · 무대 창 필요
                  </label>
                </>
              )}
            </div>
          </details>
          {validation && (
            <p role="alert" className="text-xs text-red-300">
              {validation}
            </p>
          )}
          {conflict && (
            <button
              type="button"
              className="workbench-button w-full justify-center"
              disabled={busy}
              onClick={() => {
                basePlan.current = structuredClone(list.servicePlan!)
                baseRevision.current = list.revision
                setConflict(false)
                setValidation(
                  '최신 순서를 기준으로 현재 입력을 저장합니다. 내용을 확인하고 변경 저장을 눌러주세요.',
                )
              }}
            >
              최신 순서에 입력 적용
            </button>
          )}
          <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
            <button
              type="button"
              className="workbench-button"
              disabled={busy}
              onClick={() => {
                localStorage.removeItem(key)
                onClose()
              }}
            >
              취소
            </button>
            <button
              type="submit"
              className="workbench-button workbench-button-primary"
              disabled={busy || !item.title.trim()}
            >
              {busy ? '저장 중…' : cue ? '변경 저장' : '순서 추가'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
