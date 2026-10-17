import { useEffect, useRef, useState } from 'react'
import type { z } from 'zod'
import { ServiceTemplateSchema } from '../../shared/schema'
import type { TemplateAction, TemplateSource } from '../../shared/service-template'
import { TemplateItemSchema } from '../../shared/service-template'
import { usePresentationStore as store } from '../store'
import { flushPersistence } from '../store/persistence'
import { useModalGuard } from '../hooks/useModalGuard'
type Template = z.infer<typeof ServiceTemplateSchema>
type Item = z.infer<typeof TemplateItemSchema>
const names = {
  song: '찬양',
  prayer: '기도',
  scripture: '봉독',
  sermon: '설교',
  offering: '헌금',
  announcement: '광고',
  custom: '기타',
}
export default function ServiceTemplatesDialog({
  initialMode = 'browse',
  initialTitle,
  initialDate,
  onClose,
}: {
  initialMode?: 'browse' | 'save'
  initialTitle?: string
  initialDate?: string
  onClose: () => void
}) {
  const [mode, setMode] = useState<'browse' | 'save' | 'edit' | 'create'>(initialMode),
    [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(''),
    [trash, setTrash] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const templates = store((state) => state.serviceTemplates),
    activeId = store((state) => state.activeSetlistId),
    setlists = store((state) => state.setlists),
    songs = store((state) => state.setlistSongs),
    cuePresentations = store((state) => state.cuePresentations)
  const current = setlists.find((list) => list.id === activeId),
    template = templates.find((entry) => entry.id === selected),
    ref = useRef<HTMLDivElement>(null)
  const [name, setName] = useState(current?.title.slice(0, 100) || ''),
    [description, setDescription] = useState(''),
    [personal, setPersonal] = useState({ leaders: false, operator: false, stage: false }),
    [fixed, setFixed] = useState<string[]>([])
  const [editing, setEditing] = useState<Template | null>(null),
    [itemId, setItemId] = useState<string | null>(null),
    [sources, setSources] = useState<Record<string, TemplateSource>>({})
  const [title, setTitle] = useState(''),
    [date, setDate] = useState(''),
    [start, setStart] = useState(''),
    [slots, setSlots] = useState<Record<string, TemplateSource | null>>({}),
    [slotId, setSlotId] = useState<string | null>(null)
  useModalGuard(true, () => {
    if (!busy) onClose()
  })
  useEffect(() => {
    window.dispatchEvent(new Event('propre-flush-edits'))
    void flushPersistence()
      .then(() => store.getState().refreshWorkspace())
      .catch(() => setError('저장을 완료한 뒤 다시 열어주세요.'))
    ref.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [])
  const execute = async (command: TemplateAction, done?: () => void) => {
    setBusy(true)
    setError('')
    try {
      await store.getState().manageServiceTemplate(command)
      done?.()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : '템플릿 작업을 완료하지 못했습니다.',
      )
    } finally {
      setBusy(false)
    }
  }
  const files = async (operation: 'save' | 'load') => {
    setBusy(true)
    setError('')
    try {
      const result = await store
        .getState()
        .templateFile(operation, template && { id: template.id, revision: template.revision })
      if (!result.success && !result.canceled)
        setError(result.error || '템플릿 파일 작업에 실패했습니다.')
    } catch {
      setError('템플릿 파일 작업에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }
  const beginEdit = () => {
    if (!template) return
    setEditing(structuredClone(template))
    setItemId(template.items[0]?.id || null)
    setSources({})
    setError('')
    setMode('edit')
  }
  const beginCreate = () => {
    if (!template) return
    setTitle(initialTitle || template.name)
    setDate(initialDate || '')
    setStart('')
    setSlots({})
    setSlotId(template.items.find((item) => item.materialMode === 'slot')?.id || null)
    setError('')
    setMode('create')
  }
  const editItem = editing?.items.find((item) => item.id === itemId)
  const patchItem = (updates: Partial<Item>) => {
    if (editing && editItem)
      setEditing({
        ...editing,
        items: editing.items.map((item) =>
          item.id === editItem.id ? { ...item, ...updates } : item,
        ),
      })
  }
  const visible = templates
    .filter(
      (entry) =>
        !!entry.deletedAt === trash &&
        `${entry.name} ${entry.description}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) => (b.lastUsedAt || b.updatedAt).localeCompare(a.lastUsedAt || a.updatedAt))
  const footerBack = () => {
    setMode('browse')
    setError('')
  }
  return (
    <div className="fixed inset-0 z-[88] flex items-center justify-center bg-black/65 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="예배 템플릿"
        data-modal="true"
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-white/10 bg-gray-900 text-gray-200 shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 p-4">
          <div>
            <h3 className="text-sm font-semibold">
              {mode === 'edit'
                ? '템플릿 편집 중'
                : mode === 'create'
                  ? '템플릿으로 새 예배'
                  : mode === 'save'
                    ? '현재 예배를 템플릿으로 저장'
                    : '예배 템플릿'}
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              매번 채울 슬롯과 고정 자료를 구분합니다. 현재 송출은 유지됩니다.
            </p>
          </div>
          <button type="button" className="workbench-button" disabled={busy} onClick={onClose}>
            닫기
          </button>
        </header>
        <div className="min-h-0 space-y-4 overflow-auto p-4 text-xs">
          {error && (
            <p role="alert" className="break-words text-red-300">
              {error}
            </p>
          )}
          {mode === 'browse' && (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="workbench-button"
                  disabled={busy || !current}
                  onClick={() => {
                    setMode('save')
                    setName(current?.title.slice(0, 100) || '')
                    setFixed([])
                    setPersonal({ leaders: false, operator: false, stage: false })
                  }}
                >
                  현재 예배를 템플릿으로 저장
                </button>
                <button
                  type="button"
                  className="workbench-button"
                  disabled={busy}
                  onClick={() => void files('load')}
                >
                  템플릿 파일 불러오기
                </button>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={trash}
                    onChange={(event) => {
                      setTrash(event.target.checked)
                      setSelected(null)
                    }}
                  />
                  템플릿 휴지통
                </label>
              </div>
              <input
                className="workbench-field w-full"
                aria-label="템플릿 검색"
                placeholder="템플릿 이름·설명 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {!visible.length && (
                <p className="py-6 text-center text-gray-500">
                  {query
                    ? '검색 결과가 없습니다. 검색어를 지우면 전체 목록을 볼 수 있습니다.'
                    : trash
                      ? '휴지통이 비어 있습니다.'
                      : '저장한 템플릿이 없습니다. 현재 예배를 템플릿으로 저장해 시작하세요.'}
                </p>
              )}
              <div className="max-h-52 space-y-1 overflow-auto" aria-label="템플릿 목록">
                {visible.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left ${selected === entry.id ? 'border-blue-400/60 bg-blue-400/5' : 'border-white/10 hover:bg-white/5'}`}
                    aria-pressed={selected === entry.id}
                    onClick={() => setSelected(entry.id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-semibold">{entry.name}</span>
                      <span className="mt-1 block break-words text-gray-500">
                        {entry.description || '설명 없음'}
                      </span>
                    </span>
                    <span className="shrink-0 text-gray-500">{entry.items.length}개 순서</span>
                  </button>
                ))}
              </div>
              {template && (
                <div className="space-y-3 rounded-lg border border-white/10 p-3">
                  <h4 className="break-words font-semibold">{template.name}</h4>
                  {template.items.some(
                    (item) => item.leader || item.operatorNote || item.stageNote,
                  ) && (
                    <p className="text-amber-200">
                      담당자 또는 메모가 포함된 템플릿입니다. 파일 공유 전에 확인해주세요.
                    </p>
                  )}
                  <p className="text-gray-500">
                    슬롯 {template.items.filter((item) => item.materialMode === 'slot').length}개 ·
                    고정 자료{' '}
                    {template.items.filter((item) => item.materialMode === 'fixed').length}개 ·{' '}
                    {Math.round(
                      template.items.reduce((sum, item) => sum + (item.durationSeconds || 0), 0) /
                        60,
                    )}
                    분
                    {template.items.some((item) => item.durationSeconds === undefined)
                      ? ' 이상'
                      : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {template.deletedAt ? (
                      <button
                        type="button"
                        className="workbench-button"
                        disabled={busy}
                        onClick={() =>
                          void execute({
                            action: 'restore',
                            requestId: crypto.randomUUID(),
                            id: template.id,
                            expectedRevision: template.revision,
                          })
                        }
                      >
                        템플릿 복원
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="workbench-button workbench-button-primary"
                          disabled={busy}
                          onClick={beginCreate}
                        >
                          이 템플릿으로 만들기
                        </button>
                        <button
                          type="button"
                          className="workbench-button"
                          disabled={busy}
                          onClick={beginEdit}
                        >
                          템플릿 편집
                        </button>
                        <button
                          type="button"
                          className="workbench-button"
                          disabled={busy}
                          onClick={() =>
                            void execute({
                              action: 'duplicate',
                              requestId: crypto.randomUUID(),
                              id: template.id,
                              expectedRevision: template.revision,
                            })
                          }
                        >
                          템플릿 복제
                        </button>
                        <button
                          type="button"
                          className="workbench-button"
                          disabled={busy}
                          onClick={() => void files('save')}
                        >
                          템플릿 파일 저장
                        </button>
                        <button
                          type="button"
                          className="workbench-button"
                          disabled={busy}
                          onClick={() =>
                            void execute({
                              action: 'delete',
                              requestId: crypto.randomUUID(),
                              id: template.id,
                              expectedRevision: template.revision,
                            })
                          }
                        >
                          템플릿 휴지통으로
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
          {mode === 'save' && (
            <>
              <label className="block space-y-1">
                템플릿 이름
                <input
                  className="workbench-field w-full"
                  aria-label="템플릿 이름"
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                설명
                <textarea
                  className="workbench-field w-full"
                  aria-label="템플릿 설명"
                  maxLength={500}
                  rows={2}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <details>
                <summary className="cursor-pointer text-gray-400">
                  담당자·메모 포함 · 기본 제외
                </summary>
                <div className="mt-2 space-y-2">
                  {(
                    [
                      ['leaders', '담당자 포함'],
                      ['operator', '운영 메모 포함'],
                      ['stage', '무대 안내 초안 포함'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={personal[key]}
                        onChange={(event) =>
                          setPersonal({ ...personal, [key]: event.target.checked })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </details>
              <p className="text-gray-500">
                기본은 매번 채우기입니다. 고정 자료는 저장 당시 내용을 독립 사본으로 보관합니다.
              </p>
              <div className="max-h-72 space-y-2 overflow-auto">
                {current?.servicePlan?.items.map((cue) => {
                  const row = current.items.find((row) => row.id === cue.songItemId),
                    canFix =
                      cue.kind === 'song'
                        ? !!songs.find((song) => song.presentation.id === row?.presentationId)
                            ?.presentation.slides.length
                        : cue.binding?.kind === 'presentation'
                          ? !!cuePresentations.find(
                              (entry) =>
                                entry.presentation.id ===
                                (cue.binding as { presentationId: string }).presentationId,
                            )
                          : !!cue.binding
                  return (
                    <label
                      key={cue.id}
                      className="flex items-center justify-between gap-3 rounded border border-white/10 p-2"
                    >
                      <span className="min-w-0 flex-1 break-words">
                        {cue.title} <span className="text-gray-500">· {names[cue.kind]}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <input
                          type="checkbox"
                          aria-label={`${cue.title} 고정 자료 포함`}
                          disabled={!canFix}
                          checked={fixed.includes(cue.id)}
                          onChange={(event) =>
                            setFixed(
                              event.target.checked
                                ? [...fixed, cue.id]
                                : fixed.filter((id) => id !== cue.id),
                            )
                          }
                        />
                        고정 자료 포함
                      </span>
                    </label>
                  )
                })}
              </div>
              <p className="text-amber-200">
                포함: 고정 자료 {fixed.length}개{personal.leaders ? ' · 담당자' : ''}
                {personal.operator ? ' · 운영 메모' : ''}
                {personal.stage ? ' · 무대 초안' : ''} · 예배 날짜/진행 상태는 제외
              </p>
            </>
          )}
          {mode === 'edit' && editing && (
            <>
              <label className="block space-y-1">
                템플릿 이름
                <input
                  className="workbench-field w-full"
                  aria-label="템플릿 이름"
                  value={editing.name}
                  maxLength={100}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                />
              </label>
              <label className="block space-y-1">
                설명
                <textarea
                  className="workbench-field w-full"
                  aria-label="템플릿 설명"
                  value={editing.description}
                  rows={2}
                  maxLength={500}
                  onChange={(event) => setEditing({ ...editing, description: event.target.value })}
                />
              </label>
              <div className="flex flex-wrap gap-1">
                {editing.items.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className="workbench-button"
                    aria-pressed={item.id === itemId}
                    onClick={() => setItemId(item.id)}
                  >
                    {index + 1}. {item.title}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="workbench-button"
                disabled={editing.items.length >= 1000}
                onClick={() => {
                  const item: Item = {
                    id: crypto.randomUUID(),
                    kind: 'prayer',
                    title: '새 순서',
                    enter: { visual: 'keep', audio: 'keep' },
                    materialMode: 'slot',
                    required: false,
                  }
                  setEditing({ ...editing, items: [...editing.items, item] })
                  setItemId(item.id)
                }}
              >
                템플릿 순서 추가
              </button>
              {editItem && (
                <div className="space-y-3 rounded-lg border border-white/10 p-3">
                  <label className="block space-y-1">
                    순서 제목
                    <input
                      className="workbench-field w-full"
                      aria-label="템플릿 순서 제목"
                      maxLength={200}
                      value={editItem.title}
                      onChange={(event) => patchItem({ title: event.target.value })}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="workbench-field"
                      aria-label="템플릿 순서 종류"
                      value={editItem.kind}
                      onChange={(event) => {
                        const kind = event.target.value as Item['kind']
                        patchItem({
                          kind,
                          enter: { ...editItem.enter, visual: kind === 'song' ? 'bound' : 'keep' },
                          materialMode: 'slot',
                          binding: undefined,
                          required: kind === 'song',
                        })
                      }}
                    >
                      {Object.entries(names).map(([key, name]) => (
                        <option key={key} value={key}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="workbench-field w-28"
                      aria-label="템플릿 예상 시간 분"
                      type="number"
                      min={0}
                      max={1440}
                      step={0.5}
                      placeholder="미정"
                      value={
                        editItem.durationSeconds === undefined ? '' : editItem.durationSeconds / 60
                      }
                      onChange={(event) =>
                        patchItem({
                          durationSeconds: event.target.value
                            ? Math.round(Number(event.target.value) * 60)
                            : undefined,
                        })
                      }
                    />
                    <select
                      className="workbench-field"
                      aria-label="템플릿 자료 방식"
                      value={editItem.materialMode}
                      onChange={(event) =>
                        patchItem({
                          materialMode: event.target.value as Item['materialMode'],
                          binding: undefined,
                        })
                      }
                    >
                      <option value="slot">매번 채우기</option>
                      <option value="fixed">고정 자료 포함</option>
                    </select>
                  </div>
                  {editItem.materialMode === 'slot' ? (
                    <>
                      <label className="block space-y-1">
                        슬롯 이름
                        <input
                          className="workbench-field w-full"
                          aria-label="템플릿 슬롯 이름"
                          maxLength={100}
                          value={editItem.slotName || ''}
                          onChange={(event) => patchItem({ slotName: event.target.value })}
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={editItem.required || editItem.kind === 'song'}
                          disabled={editItem.kind === 'song'}
                          onChange={(event) => patchItem({ required: event.target.checked })}
                        />
                        자료 필수 · 나중에 채우기 가능
                      </label>
                    </>
                  ) : (
                    <>
                      <p className="text-gray-500">
                        {editItem.binding && !sources[editItem.id]
                          ? '기존 고정 자료 유지 · 교체할 때 아래에서 선택'
                          : '고정할 자료를 선택해주세요.'}
                      </p>
                      <MaterialPicker
                        label="템플릿 고정 자료"
                        song={editItem.kind === 'song'}
                        value={sources[editItem.id] || null}
                        onChange={(source) => {
                          if (!source) return
                          setSources({ ...sources, [editItem.id]: source })
                          patchItem({
                            binding:
                              source.kind === 'presentation'
                                ? {
                                    kind: 'presentation',
                                    presentationId: source.id,
                                    slideId: source.slideId,
                                  }
                                : {
                                    kind: 'resource',
                                    resourceId: source.id,
                                    page: source.page,
                                    rotation: source.rotation,
                                  },
                          })
                        }}
                      />
                    </>
                  )}
                  <label className="block space-y-1">
                    화면 정책
                    <select
                      className="workbench-field w-full"
                      aria-label="템플릿 화면 정책"
                      disabled={editItem.kind === 'song'}
                      value={editItem.enter.visual}
                      onChange={(event) =>
                        patchItem({
                          enter: {
                            ...editItem.enter,
                            visual: event.target.value as Item['enter']['visual'],
                          },
                        })
                      }
                    >
                      <option value="keep">현재 화면 유지</option>
                      <option value="background-only">배경만 유지</option>
                      <option value="black">검정 화면</option>
                      <option value="bound">연결 자료 송출</option>
                    </select>
                  </label>
                  <details>
                    <summary className="cursor-pointer text-gray-400">담당자·메모 편집</summary>
                    <div className="mt-2 space-y-2">
                      <label className="block space-y-1">
                        담당자
                        <input
                          className="workbench-field w-full"
                          aria-label="템플릿 순서 담당자"
                          maxLength={100}
                          value={editItem.leader || ''}
                          onChange={(event) => patchItem({ leader: event.target.value })}
                        />
                      </label>
                      <label className="block space-y-1">
                        운영 메모
                        <textarea
                          className="workbench-field w-full"
                          aria-label="템플릿 운영 메모"
                          rows={2}
                          maxLength={2000}
                          value={editItem.operatorNote || ''}
                          onChange={(event) => patchItem({ operatorNote: event.target.value })}
                        />
                      </label>
                      <label className="block space-y-1">
                        무대 안내 초안
                        <textarea
                          className="workbench-field w-full"
                          aria-label="템플릿 무대 초안"
                          rows={2}
                          maxLength={2000}
                          value={editItem.stageNote || ''}
                          onChange={(event) => patchItem({ stageNote: event.target.value })}
                        />
                      </label>
                    </div>
                  </details>
                  <div className="flex gap-2">
                    {[-1, 1].map((offset) => (
                      <button
                        type="button"
                        key={offset}
                        className="workbench-button"
                        disabled={
                          editing.items.findIndex((item) => item.id === editItem.id) + offset < 0 ||
                          editing.items.findIndex((item) => item.id === editItem.id) + offset >=
                            editing.items.length
                        }
                        onClick={() => {
                          const items = [...editing.items],
                            index = items.findIndex((item) => item.id === editItem.id)
                          ;[items[index], items[index + offset]] = [
                            items[index + offset],
                            items[index],
                          ]
                          setEditing({ ...editing, items })
                        }}
                      >
                        {offset < 0 ? '순서 위로' : '순서 아래로'}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="workbench-button"
                      onClick={() => {
                        setEditing({
                          ...editing,
                          items: editing.items.filter((item) => item.id !== editItem.id),
                        })
                        setItemId(null)
                      }}
                    >
                      템플릿 순서 제거
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {mode === 'create' && template && (
            <>
              <label className="block space-y-1">
                새 예배 이름
                <input
                  className="workbench-field w-full"
                  aria-label="템플릿 새 예배 이름"
                  maxLength={200}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <div className="flex gap-3">
                <label className="min-w-0 flex-1 space-y-1">
                  예배 날짜 · 선택
                  <input
                    type="date"
                    className="workbench-field w-full"
                    aria-label="템플릿 새 예배 날짜"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </label>
                <label className="min-w-0 flex-1 space-y-1">
                  시작 시각 · 컴퓨터 시간대
                  <input
                    type="datetime-local"
                    className="workbench-field w-full"
                    aria-label="템플릿 새 예배 시작"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </label>
              </div>
              <p className="text-gray-500">
                빈 슬롯은 나중에 채울 수 있습니다. 자료 필수 순서의 진행은 연결 전 차단합니다.
              </p>
              <div className="flex max-h-44 flex-col gap-1 overflow-auto">
                {template.items.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className="workbench-button justify-between text-left"
                    disabled={item.materialMode === 'fixed'}
                    style={item.materialMode === 'fixed' ? { opacity: 1 } : undefined}
                    aria-pressed={slotId === item.id}
                    onClick={() => setSlotId(item.id)}
                  >
                    <span className="min-w-0 truncate">
                      {index + 1}. {item.slotName || item.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-gray-500">
                      {item.materialMode === 'fixed'
                        ? '고정 자료'
                        : slots[item.id]
                          ? '자료 선택함'
                          : '나중에 채우기'}
                    </span>
                  </button>
                ))}
              </div>
              {template.items
                .filter((item) => item.id === slotId && item.materialMode === 'slot')
                .map((item) => (
                  <MaterialPicker
                    key={item.id}
                    label={`${item.title} 슬롯 자료`}
                    song={item.kind === 'song'}
                    value={slots[item.id] || null}
                    onChange={(source) => setSlots({ ...slots, [item.id]: source })}
                  />
                ))}
              <p className="rounded bg-white/5 p-3">
                고정 자료 {template.items.filter((item) => item.materialMode === 'fixed').length}개
                · 슬롯 입력 {Object.values(slots).filter(Boolean).length}개 · 미완성{' '}
                {
                  template.items.filter(
                    (item) =>
                      item.materialMode === 'slot' &&
                      (item.required || item.enter.visual === 'bound' || item.kind === 'song') &&
                      !slots[item.id],
                  ).length
                }
                개
              </p>
            </>
          )}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-white/10 p-4">
          {mode !== 'browse' && (
            <button type="button" className="workbench-button" disabled={busy} onClick={footerBack}>
              목록으로
            </button>
          )}
          {mode === 'save' && (
            <button
              type="button"
              className="workbench-button workbench-button-primary"
              disabled={busy || !current || !name.trim()}
              onClick={() =>
                current &&
                void execute(
                  {
                    action: 'save-from-service',
                    requestId: crypto.randomUUID(),
                    setlistId: current.id,
                    expectedRevision: current.revision,
                    name,
                    description,
                    includeLeaders: personal.leaders,
                    includeOperatorNotes: personal.operator,
                    includeStageNotes: personal.stage,
                    fixedCueIds: fixed,
                  },
                  footerBack,
                )
              }
            >
              템플릿 저장
            </button>
          )}
          {mode === 'edit' && editing && (
            <button
              type="button"
              className="workbench-button workbench-button-primary"
              disabled={busy || !editing.name.trim()}
              onClick={() =>
                void execute(
                  {
                    action: 'update',
                    requestId: crypto.randomUUID(),
                    id: editing.id,
                    expectedRevision: editing.revision,
                    name: editing.name,
                    description: editing.description,
                    items: editing.items,
                    sources: Object.fromEntries(
                      Object.entries(sources).filter(([id]) =>
                        editing.items.some(
                          (item) => item.id === id && item.materialMode === 'fixed',
                        ),
                      ),
                    ),
                  },
                  footerBack,
                )
              }
            >
              템플릿 변경 저장
            </button>
          )}
          {mode === 'create' && template && (
            <button
              type="button"
              className="workbench-button workbench-button-primary"
              disabled={busy || !title.trim()}
              onClick={() => {
                try {
                  void execute(
                    {
                      action: 'instantiate',
                      requestId: crypto.randomUUID(),
                      id: template.id,
                      expectedRevision: template.revision,
                      title,
                      date: date || undefined,
                      plannedStartAt: start ? new Date(start).toISOString() : undefined,
                      expectedActiveId: activeId,
                      expectedActiveRevision: current?.revision ?? null,
                      slots,
                    },
                    onClose,
                  )
                } catch {
                  setError('예배 시작 시각을 확인해주세요.')
                }
              }}
            >
              새 예배 생성
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
function MaterialPicker({
  label,
  song,
  value,
  onChange,
}: {
  label: string
  song: boolean
  value: TemplateSource | null
  onChange: (source: TemplateSource | null) => void
}) {
  const library = store((state) => state.library),
    resources = store((state) => state.outputResources)
  const p = value?.kind === 'presentation' ? library.find((p) => p.id === value.id) : undefined,
    r = value?.kind === 'resource' ? resources.find((r) => r.id === value.id) : undefined
  return (
    <div className="space-y-2 rounded-lg border border-white/10 p-3">
      <label className="block space-y-1">
        {label}
        <select
          className="workbench-field w-full"
          aria-label={label}
          value={value ? `${value.kind === 'presentation' ? 'p' : 'r'}:${value.id}` : ''}
          onChange={(event) => {
            const [kind, id] = event.target.value.split(':')
            if (!id) return onChange(null)
            if (kind === 'p') {
              const p = library.find((p) => p.id === id)!
              onChange({
                kind: 'presentation',
                id,
                revision: p.revision || 0,
                slideId: p.slides[0].id,
              })
            } else {
              const r = resources.find((r) => r.id === id)!
              onChange({
                kind: 'resource',
                id,
                revision: r.revision,
                ...(r.kind === 'pdf' ? { page: 1, rotation: 0 } : {}),
              })
            }
          }}
        >
          <option value="">나중에 채우기</option>
          <optgroup label="찬양·슬라이드">
            {library
              .filter((p) => p.slides.length)
              .map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.title}
                </option>
              ))}
          </optgroup>
          {!song && (
            <optgroup label="웹·PDF">
              {resources
                .filter((r) => !r.deletedAt)
                .map((r) => (
                  <option key={r.id} value={`r:${r.id}`}>
                    {r.name}
                  </option>
                ))}
            </optgroup>
          )}
        </select>
      </label>
      {p && !song && value?.kind === 'presentation' && (
        <label className="block space-y-1">
          시작 슬라이드
          <select
            className="workbench-field w-full"
            aria-label={`${label} 시작 슬라이드`}
            value={value.slideId}
            onChange={(event) => onChange({ ...value, slideId: event.target.value })}
          >
            {p.slides.map((slide, index) => (
              <option key={slide.id} value={slide.id}>
                {index + 1}. {(slide.content || '빈 슬라이드').slice(0, 40)}
              </option>
            ))}
          </select>
        </label>
      )}
      {r?.kind === 'pdf' && value?.kind === 'resource' && (
        <div className="flex gap-2">
          <label className="min-w-0 flex-1 space-y-1">
            PDF 시작 페이지
            <input
              className="workbench-field w-full"
              aria-label={`${label} PDF 페이지`}
              type="number"
              min={1}
              max={r.pageCount}
              value={value.page || 1}
              onChange={(event) => onChange({ ...value, page: Number(event.target.value) })}
            />
          </label>
          <label className="min-w-0 flex-1 space-y-1">
            회전
            <select
              className="workbench-field w-full"
              aria-label={`${label} PDF 회전`}
              value={value.rotation || 0}
              onChange={(event) =>
                onChange({ ...value, rotation: Number(event.target.value) as 0 | 90 | 180 | 270 })
              }
            >
              {[0, 90, 180, 270].map((angle) => (
                <option key={angle} value={angle}>
                  {angle}°
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
