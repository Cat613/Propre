import { useEffect, useRef, useState } from 'react'
import { usePresentationStore as store } from '../store'
import type { OutputResource, PreparedOutput } from '../../shared/output-resources'
export default function OutputResourcesPanel() {
  const resources = store((s) => s.outputResources),
    status = store((s) => s.externalOutput),
    frame = store((s) => s.browserFrame)
  const [selected, setSelected] = useState<string | null>(null),
    [prepared, setPrepared] = useState<PreparedOutput | null>(null),
    [page, setPage] = useState(1),
    [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0)
  const [webForm, setWebForm] = useState(false),
    [name, setName] = useState(''),
    [url, setURL] = useState(''),
    [editing, setEditing] = useState<OutputResource | null>(null)
  const [search, setSearch] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [interactive, setInteractive] = useState(false)
  const [thumbnails, setThumbnails] = useState<{ page: number; url: string }[]>([])
  useEffect(() => {
    setInteractive(false)
  }, [
    status.source.kind,
    status.source.kind === 'web' ? status.source.resourceId : null,
    status.browser?.live,
  ])
  const request = useRef(0)
  const resource = resources.find((r) => r.id === selected && !r.deletedAt)
  const deleted = resources
    .filter((r) => r.deletedAt)
    .sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!))[0]
  const undoButton = useRef<HTMLButtonElement>(null)
  const thumbStart = Math.floor((page - 1) / 6) * 6 + 1
  useEffect(() => {
    let canceled = false
    setThumbnails([])
    if (resource?.kind === 'pdf' && thumbStart >= 1)
      void window.ipcRenderer
        .pdfOutputThumbnails({
          id: resource.id,
          revision: resource.revision,
          start: thumbStart,
          rotation,
        })
        .then((frames) => {
          if (!canceled) setThumbnails(frames)
        })
        .catch(() => {})
    return () => {
      canceled = true
    }
  }, [resource?.id, resource?.revision, resource?.kind, rotation, thumbStart])
  const validPage =
    resource?.kind !== 'pdf' || (Number.isInteger(page) && page >= 1 && page <= resource.pageCount)
  const ready =
    !!prepared &&
    prepared.resourceId === selected &&
    prepared.revision === resource?.revision &&
    prepared.generation === status.generation &&
    (resource?.kind !== 'pdf' ||
      (validPage && prepared.page === page && prepared.rotation === rotation))
  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : '작업을 완료하지 못했습니다.',
      )
    } finally {
      setBusy(false)
    }
  }
  const closePreparation = () => {
    request.current++
    setSelected(null)
    setPrepared(null)
    setError('')
    setInteractive(false)
    if (editing?.id === selected) {
      setEditing(null)
      setWebForm(false)
    }
  }
  const choose = (r: OutputResource) => {
    if (selected === r.id) {
      closePreparation()
      return
    }
    request.current++
    setEditing(null)
    setWebForm(false)
    setSelected(r.id)
    setPrepared(null)
    setError('')
    setInteractive(false)
    if (r.kind === 'pdf') {
      setPage(r.lastPreparedPage)
      setRotation(r.rotation)
    }
  }
  const prepare = async (r: OutputResource, p = page, rot = rotation) => {
    const current = ++request.current
    const next = await window.ipcRenderer.prepareOutputResource({
      resourceId: r.id,
      revision: r.revision,
      ...(r.kind === 'pdf' ? { page: p, rotation: rot } : {}),
    })
    if (current === request.current) {
      setPrepared(next)
      store.setState({ externalOutput: await window.ipcRenderer.getExternalOutput() })
    }
    return next
  }
  const command = (value: Record<string, unknown>) =>
    run(async () => {
      if (value.action === 'mute' && value.value === false) store.getState().pauseAudio()
      const externalOutput = await window.ipcRenderer.browserOutputCommand({
        ...value,
        generation: status.generation,
      })
      store.setState((s) =>
        externalOutput.generation >= s.externalOutput.generation ? { externalOutput } : {},
      )
    })
  const restoreDeleted = () =>
    run(async () => {
      const previousIds = new Set(resources.filter((r) => !r.deletedAt).map((r) => r.id))
      const outputResources = await window.ipcRenderer.manageOutputResource({
        ...(deleted
          ? { action: 'restore', id: deleted.id, revision: deleted.revision }
          : { action: 'recover-deleted' }),
      })
      store.setState({ outputResources })
      const restored = outputResources.find((r) => !r.deletedAt && !previousIds.has(r.id))
      if (restored) choose(restored)
    })
  const liveStep = (delta: number) =>
    run(async () => {
      const source = status.source
      if (source.kind !== 'pdf') return
      const r = resources.find((r) => r.id === source.resourceId)
      if (!r || r.kind !== 'pdf') return
      const p = source.page + delta
      const next = await window.ipcRenderer.prepareOutputResource({
        resourceId: r.id,
        revision: r.revision,
        page: p,
        rotation: source.rotation ?? 0,
      })
      store.setState({
        externalOutput: await window.ipcRenderer.commitOutputResource(next.token, next.generation),
      })
    })
  return (
    <section
      aria-label="웹·PDF 송출 자료"
      onKeyDownCapture={(e) => {
        const target = e.target as HTMLElement
        if (
          !busy &&
          deleted &&
          (e.metaKey || e.ctrlKey) &&
          !e.shiftKey &&
          e.key.toLowerCase() === 'z' &&
          !target.matches('input,textarea') &&
          !target.isContentEditable
        ) {
          e.preventDefault()
          e.stopPropagation()
          void restoreDeleted()
        }
      }}
      className="border-b border-white/10 p-4 space-y-3 text-xs"
    >
      <div className="flex flex-wrap gap-2 items-center">
        <h3 className="workbench-heading mr-auto">웹 · PDF</h3>
        <button
          ref={undoButton}
          className="workbench-button"
          disabled={busy}
          title={
            deleted
              ? `${deleted.name} 복원 (이 영역에서 Ctrl/Cmd+Z)`
              : '최근 저장 복사본에서 이전에 삭제한 자료를 복구합니다.'
          }
          onClick={() => void restoreDeleted()}
        >
          삭제 되돌리기
        </button>
        <button
          className="workbench-button"
          onClick={() => {
            setEditing(null)
            setName('')
            setURL('')
            setWebForm(!webForm)
          }}
        >
          URL 추가
        </button>
        <button
          className="workbench-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await window.ipcRenderer.selectOutputPDFs()
              store.setState({ outputResources: result.resources })
              if (result.errors.length) setError(result.errors.join('\n'))
            })
          }
        >
          PDF 추가
        </button>
      </div>
      {webForm && (
        <form
          aria-label={editing ? `주소 수정: ${editing.name}` : '새 웹 주소'}
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void run(async () => {
              const outputResources = await window.ipcRenderer.manageOutputResource(
                editing
                  ? { action: 'update-web', id: editing.id, revision: editing.revision, name, url }
                  : { action: 'create-web', name, url },
              )
              store.setState({ outputResources })
              setWebForm(false)
              setPrepared(null)
            })
          }}
        >
          <p className="text-gray-400">{editing ? `주소 수정: ${editing.name}` : '새 웹 주소'}</p>
          <input
            aria-label="웹 자료 이름"
            className="workbench-input w-full"
            placeholder="이름 (선택)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
          />
          <input
            aria-label="웹 주소"
            className="workbench-input w-full"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setURL(e.target.value)}
            maxLength={2048}
            required
          />
          <p className="text-gray-500">
            개인 인증 링크는 저장하지 마세요. 로그인은 앱 종료 시 해제됩니다.
          </p>
          <button className="workbench-button" disabled={busy}>
            주소 저장
          </button>
        </form>
      )}
      {resources.length > 0 && (
        <input
          aria-label="웹·PDF 자료 검색"
          className="workbench-input w-full"
          placeholder="자료 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {resources
          .filter((r) => !r.deletedAt && r.name.toLowerCase().includes(search.toLowerCase()))
          .map((r) => (
            <button
              key={r.id}
              className={`workbench-button ${r.id === selected ? 'border-blue-400 text-blue-300' : ''}`}
              aria-pressed={r.id === selected}
              onClick={() => choose(r)}
            >
              {r.kind === 'pdf' ? 'PDF' : '웹'} · {r.name}
              {status.source.kind !== 'slides' && status.source.resourceId === r.id
                ? ' · 송출 중'
                : ''}
            </button>
          ))}
      </div>
      {resource && (
        <div
          className="space-y-2 rounded-lg border border-white/10 p-3"
          data-testid="output-resource-preparation"
        >
          <div className="flex flex-wrap items-center gap-2">
            <strong className="mr-auto">준비: {resource.name}</strong>
            <button className="workbench-button" onClick={closePreparation}>
              준비 패널 닫기
            </button>
            {resource.kind === 'web' && (
              <button
                className="workbench-button"
                onClick={() => {
                  setEditing(resource)
                  setName(resource.name)
                  setURL(resource.url)
                  setWebForm(true)
                }}
              >
                주소 수정
              </button>
            )}
            <button
              className="workbench-button"
              disabled={
                busy ||
                (status.source.kind !== 'slides' && status.source.resourceId === resource.id)
              }
              onClick={() =>
                void run(async () => {
                  const outputResources = await window.ipcRenderer.manageOutputResource({
                    action: 'delete',
                    id: resource.id,
                    revision: resource.revision,
                  })
                  store.setState({ outputResources })
                  closePreparation()
                  requestAnimationFrame(() => undoButton.current?.focus())
                })
              }
            >
              자료 삭제
            </button>
          </div>
          {resource.kind === 'pdf' ? (
            <>
              <div className="grid grid-cols-3 gap-1">
                {thumbnails.map((t) => (
                  <button
                    key={t.page}
                    aria-label={`PDF ${t.page}페이지 준비`}
                    className="rounded border border-white/10 p-1"
                    aria-pressed={page === t.page}
                    disabled={busy}
                    onClick={() => {
                      setPage(t.page)
                      setPrepared(null)
                      void run(async () => {
                        await prepare(resource, t.page)
                      })
                    }}
                  >
                    <img className="h-16 w-full object-contain bg-black" src={t.url} alt="" />
                    <span>{t.page}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="workbench-button"
                  disabled={busy || !validPage || page <= 1}
                  onClick={() => {
                    setPage(page - 1)
                    setPrepared(null)
                    void run(async () => {
                      await prepare(resource, page - 1)
                    })
                  }}
                >
                  준비 이전
                </button>
                <input
                  aria-label="준비 PDF 페이지"
                  type="number"
                  className="workbench-input w-16"
                  min={1}
                  max={resource.pageCount}
                  value={Number.isNaN(page) ? '' : page}
                  aria-invalid={!validPage}
                  onChange={(e) => {
                    request.current++
                    setPage(e.target.value === '' ? NaN : Number(e.target.value))
                    setPrepared(null)
                  }}
                />{' '}
                / {resource.pageCount}
                <button
                  className="workbench-button"
                  disabled={busy || !validPage || page >= resource.pageCount}
                  onClick={() => {
                    setPage(page + 1)
                    setPrepared(null)
                    void run(async () => {
                      await prepare(resource, page + 1)
                    })
                  }}
                >
                  준비 다음
                </button>
                <button
                  className="workbench-button"
                  disabled={busy || !validPage}
                  onClick={() => {
                    const next = ((rotation + 90) % 360) as typeof rotation
                    setRotation(next)
                    setPrepared(null)
                    void run(async () => {
                      await prepare(resource, page, next)
                    })
                  }}
                >
                  회전 {rotation}°
                </button>
              </div>
              {!validPage && (
                <p role="alert" className="text-red-300">
                  1부터 {resource.pageCount}까지의 정수 페이지를 입력해주세요.
                </p>
              )}
              {prepared?.frameURL && (
                <img
                  src={prepared.frameURL}
                  className="h-48 w-full object-contain bg-black"
                  alt={`준비 PDF ${prepared.page}페이지`}
                />
              )}
            </>
          ) : (
            <>
              <p className="break-all text-gray-500">{resource.url}</p>
              {status.browser?.resourceId === resource.id && (
                <>
                  <p className="break-all">
                    {status.browser.loading ? '로딩 중…' : '웹 준비됨'} · {status.browser.url}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(['back', 'forward', 'reload', 'show'] as const).map((action, i) => (
                      <button
                        className="workbench-button"
                        key={action}
                        disabled={busy || status.browser?.live}
                        onClick={() => void command({ action })}
                      >
                        {['뒤로', '앞으로', '새로고침', '브라우저 조작'][i]}
                      </button>
                    ))}
                    <select
                      aria-label="웹 확대"
                      className="workbench-input"
                      value={status.browser.zoom}
                      disabled={status.browser.live || busy}
                      onChange={(e) =>
                        void command({ action: 'zoom', value: Number(e.target.value) })
                      }
                    >
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => (
                        <option key={z} value={z}>
                          {z * 100}%
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              {frame?.resourceId === resource.id && (
                <img
                  src={frame.image}
                  alt="웹 준비 미리보기"
                  className="w-full bg-black object-contain"
                />
              )}
            </>
          )}
          <div className="flex gap-2">
            <button
              className="workbench-button"
              disabled={busy || !validPage}
              onClick={() =>
                void run(async () => {
                  await prepare(resource)
                })
              }
            >
              {busy
                ? '준비·전환 중…'
                : resource.kind === 'web' && status.browser?.resourceId === resource.id
                  ? '준비 확인'
                  : '화면 준비'}
            </button>
            <button
              className="workbench-button border-blue-400 text-blue-300"
              disabled={busy || !ready}
              onClick={() =>
                void run(async () => {
                  if (prepared)
                    store.setState({
                      externalOutput: await window.ipcRenderer.commitOutputResource(
                        prepared.token,
                        prepared.generation,
                      ),
                    })
                })
              }
            >
              준비 화면 송출
            </button>
          </div>
          <p className="text-gray-500">
            준비와 선택은 현재 송출을 바꾸지 않습니다. 웹·PDF는 가사·공지 위에 겹치지 않습니다.
          </p>
        </div>
      )}
      {status.source.kind !== 'slides' && (
        <div className="space-y-2 rounded-lg border border-emerald-500/30 p-3">
          <strong>
            현재 송출: {status.source.name}
            {status.source.kind === 'pdf'
              ? ` · ${status.source.page}/${status.source.pageCount}`
              : ' · 웹'}
          </strong>
          <div className="flex flex-wrap gap-2">
            {status.source.kind === 'pdf' && (
              <>
                <button
                  className="workbench-button"
                  disabled={busy || status.source.page <= 1}
                  onClick={() => void liveStep(-1)}
                >
                  송출 이전
                </button>
                <button
                  className="workbench-button"
                  disabled={busy || status.source.page >= status.source.pageCount}
                  onClick={() => void liveStep(1)}
                >
                  송출 다음
                </button>
              </>
            )}
            <button
              className="workbench-button"
              onClick={() =>
                void run(async () => {
                  await window.ipcRenderer.returnToSlides()
                  setPrepared(null)
                  setInteractive(false)
                })
              }
            >
              슬라이드로 복귀
            </button>
            <button
              className="workbench-button workbench-button-danger"
              onClick={() => {
                request.current++
                store.getState().clearAll()
                setPrepared(null)
                setBusy(false)
                setInteractive(false)
              }}
            >
              전체 중지
            </button>
          </div>
          {status.source.kind === 'web' && (
            <>
              <p className="text-gray-500" aria-live="polite">
                웹 소리 · {status.browser?.muted ? '음소거' : '재생 허용'} · 소리를 켜면 로컬
                오디오는 일시정지됩니다.
              </p>
              <button
                className="workbench-button"
                disabled={busy || !status.browser?.live}
                onClick={() => void command({ action: 'mute', value: !status.browser?.muted })}
              >
                {status.browser?.muted ? '웹 소리 켜기' : '웹 소리 끄기'}
              </button>
              <label className="ml-2">
                <input
                  type="checkbox"
                  checked={interactive}
                  disabled={!status.browser?.live}
                  onChange={(e) => setInteractive(e.target.checked)}
                />{' '}
                실시간 조작 (실제 송출에 적용)
              </label>
              {interactive &&
                status.browser?.live &&
                frame?.resourceId === status.source.resourceId && (
                  <div
                    tabIndex={0}
                    aria-label="웹 송출 조작 화면"
                    onKeyDown={(e) => {
                      if (e.key === 'F2') return
                      e.preventDefault()
                      e.stopPropagation()
                      void command({ action: 'input', type: 'key', key: e.key })
                    }}
                    className="outline outline-blue-400"
                  >
                    <img
                      className="w-full"
                      src={frame.image}
                      alt="웹 송출 조작 미리보기"
                      onClick={(e) => {
                        const b = e.currentTarget.getBoundingClientRect()
                        void command({
                          action: 'input',
                          type: 'click',
                          x: (e.clientX - b.left) / b.width,
                          y: (e.clientY - b.top) / b.height,
                        })
                      }}
                      onWheel={(e) => {
                        e.stopPropagation()
                        const b = e.currentTarget.getBoundingClientRect()
                        void command({
                          action: 'input',
                          type: 'wheel',
                          x: (e.clientX - b.left) / b.width,
                          y: (e.clientY - b.top) / b.height,
                          delta: Math.max(-1000, Math.min(1000, -e.deltaY)),
                        })
                      }}
                    />
                    <p className="text-gray-500">
                      미리보기는 지연될 수 있습니다. 한글 입력·페이지 이동은 송출을 끝내고 준비
                      창에서 진행해주세요.
                    </p>
                  </div>
                )}
            </>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-300 whitespace-pre-wrap">
          {error}
        </p>
      )}
    </section>
  )
}
