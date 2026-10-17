import './SongPreparationPanel.css'
import {
  Sparkles,
  UploadCloud,
  FileText,
  Plus,
  History,
  ListMusic,
  Check,
  ArrowRight,
  X,
  SlidersHorizontal,
  CircleCheck,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useModalGuard } from '../hooks/useModalGuard'
import { usePresentationStore as store } from '../store'
import { withOperatorLock } from '../store/preparation'
import { flushPersistence } from '../store/persistence'
import {
  compileSong,
  DraftSetSchema,
  titleKey,
  type ConnectionProfile,
  type SongJob,
  type DraftSet,
  type SongDraft,
  type ApplyReceipt,
} from '../../shared/song-preparation'
import AIProfilesPanel from './AIProfilesPanel'
import SongSourcePreview from './SongSourcePreview'
import ScaledSlide from './ScaledSlide'
const names: Record<SongJob['status'], string> = {
  queued: '분석 대기',
  analyzing: 'AI가 가사와 송폼을 읽고 있습니다',
  needs_review: '가사와 송폼 확인 필요',
  ready: '적용 준비 완료',
  committing: '저장 결과 확인 중',
  completed: '콘티 준비 완료',
  failed: '분석 중 문제 발생',
  canceled: '취소됨',
  interrupted: '중단된 작업 복구',
}
export default function SongPreparationPanel({ onClose }: { onClose: () => void }) {
  const modal = useRef<HTMLDivElement>(null)
  const sourceDetails = useRef<HTMLDetailsElement>(null)
  const operation = useRef(false)
  const connectionsButton = useRef<HTMLButtonElement>(null)
  const [profiles, setProfiles] = useState<(ConnectionProfile & { configured: boolean })[]>([]),
    [profileId, setProfileId] = useState('')
  const [jobs, setJobs] = useState<SongJob[]>([]),
    [job, setJob] = useState<SongJob | null>(null),
    [draft, setDraft] = useState<DraftSet | null>(null)
  const [mode, setMode] = useState<'append' | 'replace'>('append'),
    [automatic, setAutomatic] = useState(false),
    [instruction, setInstruction] = useState('')
  const [view, setView] = useState<'prepare' | 'work' | 'history'>('prepare')
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [selectedPart, setSelectedPart] = useState(0)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [connectionsBusy, setConnectionsBusy] = useState(false)
  const [restoreConfirm, setRestoreConfirm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [analysisSources, setAnalysisSources] = useState<string[]>([])
  const [connections, setConnections] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [receipt, setReceipt] = useState<ApplyReceipt | null>(null)
  const [sourceIndex, setSourceIndex] = useState(0),
    [sourcePage, setSourcePage] = useState(1),
    [previewIndex, setPreviewIndex] = useState(0),
    [songIndex, setSongIndex] = useState(0)
  const library = store((s) => s.library),
    active = store((s) => s.setlists.find((l) => l.id === s.activeSetlistId))
  const selectedProfile = profiles.find((profile) => profile.id === profileId)
  const profileChanged =
    !!job &&
    !!selectedProfile &&
    (job.profile.id !== selectedProfile.id ||
      job.profile.provider !== selectedProfile.provider ||
      job.profile.model !== selectedProfile.model)
  const dirty = !!job && !!draft && JSON.stringify(draft) !== JSON.stringify(job.draft)
  const currentReceipt = receipt?.jobId === job?.id ? receipt : null
  const locked = busy || connectionsBusy
  const processing = !!job && ['analyzing', 'committing'].includes(job.status)
  const closeConnections = () => {
    if (connectionsBusy) return
    setConnections(false)
    connectionsButton.current?.focus()
  }
  const close = () => {
    if (locked || operation.current) return
    void run(async () => {
      await savePending()
      onClose()
    })
  }
  useModalGuard(true, () => (connections ? closeConnections() : close()))
  useModalGuard(connections, closeConnections)
  const loadProfiles = async (preferDefault = false) => {
    const p = await window.ipcRenderer.listAIProfiles()
    setProfiles(p.profiles)
    setProfileId((current) =>
      preferDefault
        ? p.defaultId ||
          (p.profiles.some((profile) => profile.id === current) ? current : p.profiles[0]?.id || '')
        : p.profiles.some((profile) => profile.id === current)
          ? current
          : p.defaultId || p.profiles[0]?.id || '',
    )
  }
  useEffect(() => {
    void Promise.all([
      loadProfiles(),
      window.ipcRenderer.listSongJobs().then((list) => {
        setJobs(list)
        setJob(list[0] || null)
        if (list.length) setView('work')
      }),
    ]).catch(() => setError('준비 작업을 불러오지 못했습니다.'))
    return window.ipcRenderer.on('song-job-changed', (next: SongJob) => {
      setJobs((list) => [next, ...list.filter((j) => j.id !== next.id)])
      setJob((current) => (current?.id === next.id ? next : current))
    })
  }, [])
  useEffect(() => {
    setDraft(job?.draft ? structuredClone(job.draft) : null)
    setPreviewIndex(0)
    setRestoreConfirm(false)
  }, [job?.id, job?.draftRevision])
  useEffect(() => {
    let disposed = false
    setReceipt(null)
    if (job)
      void window.ipcRenderer
        .songReceipt(job.id)
        .then((next) => {
          if (!disposed) setReceipt(next)
        })
        .catch(() => {
          if (!disposed) setError('적용 기록을 불러오지 못했습니다. 작업을 다시 선택해주세요.')
        })
    return () => {
      disposed = true
    }
  }, [job?.id, job?.status])
  useEffect(() => {
    setAnalysisSources(job?.sources.map((source) => source.id) || [])
    setDeleteConfirm(false)
  }, [job?.id])
  const run = async (action: () => Promise<unknown>) => {
    if (operation.current || connectionsBusy) return
    operation.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : '작업을 완료하지 못했습니다.',
      )
    } finally {
      operation.current = false
      setBusy(false)
    }
  }
  const selectFiles = async (files?: File[]) =>
    run(async () => {
      await savePending()
      await flushPersistence()
      const options = { profileId, instruction, mode, automatic }
      const next = files
        ? await window.ipcRenderer.dropSongFiles(files, options)
        : await window.ipcRenderer.selectSongFiles(options)
      if (next) {
        setJob(next)
        setView('work')
        setAnalysisOpen(false)
        setSongIndex(0)
        setSourceIndex(0)
        setSourcePage(1)
        setReceipt(null)
      }
    })
  const editSong = (id: string, patch: Partial<SongDraft>) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            songs: current.songs.map((s) =>
              s.id === id ? { ...s, ...patch, confirmed: patch.confirmed ?? false } : s,
            ),
          }
        : null,
    )
  const validation = useMemo(() => (draft ? DraftSetSchema.safeParse(draft) : null), [draft])
  const problems =
    validation && !validation.success
      ? [
          ...new Set(
            validation.error.issues.map((issue) => {
              const path = issue.path
              const index = path[0] === 'songs' && typeof path[1] === 'number' ? path[1] : null
              const location =
                index === null
                  ? '콘티 순서'
                  : `${Array.from(draft?.songs[index]?.title || `${index + 1}번 곡`)
                      .slice(0, 40)
                      .join('')}${(draft?.songs[index]?.title.length || 0) > 40 ? '…' : ''}`
              const field = path.includes('repeat')
                ? '반복 횟수는 1~20회로 입력해주세요.'
                : path.includes('title')
                  ? '곡 제목은 1~500자로 입력해주세요.'
                  : path.includes('label')
                    ? '파트 이름은 1~50자로 입력해주세요.'
                    : path.includes('sequence')
                      ? '송폼 순서와 반복을 확인해주세요.'
                      : path.includes('pages')
                        ? '가사 길이와 슬라이드 수를 확인해주세요.'
                        : issue.code === 'custom'
                          ? issue.message
                          : '가사와 송폼 입력을 확인해주세요.'
              return `${location}: ${field}`
            }),
          ),
        ]
      : []
  const save = async () => {
    if (!job || !draft) return job
    if (problems.length) throw new Error(problems.join('\n'))
    if (!dirty && job.status !== 'canceled') return job
    const updated = await window.ipcRenderer.editSongJob(job.id, {
      expectedDraftRevision: job.draftRevision,
      draft,
    })
    setJob(updated)
    return updated
  }
  const savePending = async () => {
    if (!dirty || !job || processing || job.status === 'completed') return job
    return save()
  }
  const chooseJob = (next: SongJob) =>
    void run(async () => {
      const saved = await savePending()
      setError('')
      setJob(saved?.id === next.id ? saved : next)
      setView('work')
      setAnalysisOpen(false)
      setSongIndex(0)
      setSourceIndex(0)
      setSourcePage(1)
    })
  const song = draft?.songs[Math.min(songIndex, (draft?.songs.length || 1) - 1)]
  const preview = useMemo(() => {
    try {
      return song && job ? compileSong(song, job.style) : null
    } catch {
      return null
    }
  }, [song, job?.style])
  useEffect(() => {
    setSelectedPart(0)
  }, [song?.id, job?.id])
  const confirmedCount = draft?.songs.filter((song) => song.confirmed).length || 0
  const readonly = locked || processing || job?.status === 'completed'
  const source = job?.sources[Math.min(sourceIndex, job.sources.length - 1)]
  const openPrepare = () =>
    void run(async () => {
      await savePending()
      setView('prepare')
    })
  const pageTitle =
    view === 'prepare'
      ? '오늘의 찬양을 준비해요'
      : view === 'history'
        ? '이어서 준비하기'
        : currentReceipt
          ? '준비 완료'
          : draft
            ? '가사와 송폼을 확인해요'
            : '파일을 분석할 준비가 됐어요'
  const showAnalysis = !draft || analysisOpen || processing || !!job?.error || !!error
  return (
    <div
      ref={modal}
      data-modal="true"
      data-song-preparation="true"
      role="dialog"
      aria-modal="true"
      aria-label="AI로 찬양 준비"
      className="studio-backdrop"
    >
      <div
        className="song-preparation-shell"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault()
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return
          event.preventDefault()
          if (!locked && !processing && selectedProfile?.configured)
            void selectFiles(Array.from(event.dataTransfer.files))
        }}
      >
        <header className="studio-header">
          <div className="studio-brand">
            <span>
              <Sparkles size={20} />
            </span>
            <div>
              <h2>AI로 찬양 준비</h2>
              <p>악보에서 콘티까지, 한 번에 준비하세요.</p>
            </div>
          </div>
          <button
            type="button"
            className="studio-close"
            aria-label="AI 준비 창 닫기"
            disabled={locked}
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        <div className="studio-layout">
          <aside className="studio-sidebar">
            <div className="studio-eyebrow">찬양 준비</div>
            <nav aria-label="찬양 준비 화면">
              <button
                type="button"
                aria-current={view === 'prepare' ? 'page' : undefined}
                disabled={locked}
                onClick={openPrepare}
              >
                <Plus size={17} />
                <span>새 찬양 준비</span>
              </button>
              <button
                type="button"
                aria-current={view === 'work' ? 'page' : undefined}
                disabled={locked || !job}
                onClick={() => setView('work')}
              >
                <ListMusic size={17} />
                <span>현재 준비 작업</span>
                {draft && <small>{draft.songs.length}</small>}
              </button>
              <button
                type="button"
                aria-current={view === 'history' ? 'page' : undefined}
                disabled={locked}
                onClick={() => setView('history')}
              >
                <History size={17} />
                <span>작업 기록</span>
              </button>
            </nav>
            <div className="studio-sidebar-section">
              <div className="studio-eyebrow">AI 연결</div>
              <div className="song-preparation-connection">
                <label className="text-sm">
                  사용할 AI
                  <select
                    aria-label="사용할 AI"
                    data-autofocus="true"
                    disabled={locked || processing}
                    className="block w-full bg-gray-800 p-2"
                    value={profileId}
                    onChange={(e) => setProfileId(e.target.value)}
                  >
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.configured ? '' : ' · 키 필요'}
                      </option>
                    ))}
                  </select>
                  {selectedProfile && (
                    <span className="studio-model" title={selectedProfile.model}>
                      {selectedProfile.model}
                    </span>
                  )}
                </label>
                <div className="flex items-end">
                  <button
                    ref={connectionsButton}
                    type="button"
                    aria-expanded={connections}
                    disabled={locked || processing}
                    aria-controls="song-ai-connections"
                    className="bg-gray-800 rounded p-2 text-sm"
                    onClick={() => (connections ? closeConnections() : setConnections(true))}
                  >
                    {connections ? 'AI 연결 추가 닫기' : 'AI 연결 추가'}
                  </button>
                </div>
                {profileId && !selectedProfile?.configured && (
                  <p role="status" className="song-preparation-key-warning text-xs text-amber-300">
                    선택한 AI에 API 키가 없습니다. 연결을 열어 키를 등록해주세요.
                  </p>
                )}
              </div>
            </div>
            <div className="studio-sidebar-section studio-recent">
              <label>
                최근 준비 작업
                <select
                  aria-label="최근 준비 작업"
                  value={job?.id || ''}
                  disabled={locked}
                  onChange={(event) => {
                    const next = jobs.find((item) => item.id === event.target.value)
                    if (next) chooseJob(next)
                  }}
                >
                  <option value="" disabled>
                    작업 선택
                  </option>
                  {jobs.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.sources[0]?.name} · {names[item.status]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="studio-setlist">
              <span>현재 콘티</span>
              <strong>{active?.title || '새 콘티'}</strong>
              <small>{active?.items.length || 0}곡 · 준비한 순서로 이어갑니다</small>
            </div>
          </aside>
          <main className={`studio-main studio-view-${view}`}>
            <div className="studio-page-heading">
              <div>
                <div className="studio-eyebrow">
                  {view === 'prepare'
                    ? '1단계 · 파일 선택'
                    : view === 'history'
                      ? '작업 보관함'
                      : currentReceipt
                        ? '준비 완료'
                        : draft
                          ? '3단계 · 곡 검토'
                          : '2단계 · AI 분석'}
                </div>
                <h1>{pageTitle}</h1>
              </div>
              {view === 'work' && job && (
                <button
                  type="button"
                  disabled={locked}
                  className="studio-text-button"
                  onClick={openPrepare}
                >
                  다른 파일로 새로 준비 <ArrowRight size={15} />
                </button>
              )}
            </div>
            {error && (view !== 'work' || !job) && (
              <p role="alert" className="song-preparation-error">
                {error}
              </p>
            )}
            {view === 'prepare' && (
              <section className="studio-prepare" aria-label="새 찬양 준비">
                <div className="studio-upload">
                  <div className="studio-file-illustration">
                    <FileText size={46} strokeWidth={1.3} />
                    <span>
                      <Plus size={16} />
                    </span>
                  </div>
                  <h3>악보를 놓아주세요</h3>
                  <p>PDF나 이미지에서 가사와 송폼을 정리합니다.</p>
                  <button
                    type="button"
                    disabled={locked || processing || !selectedProfile?.configured}
                    className="studio-primary"
                    onClick={() => void selectFiles()}
                  >
                    <UploadCloud size={17} />
                    PDF·이미지 파일 선택
                  </button>
                  <span className="studio-file-types">PDF · PNG · JPG · WEBP</span>
                  <small>최대 20개 · 전체 40MB · 50페이지 · 파일당 20MB</small>
                </div>
                <div className="studio-preferences">
                  <div className="studio-eyebrow">준비 메모</div>
                  <h3>원하는 흐름이 있나요?</h3>
                  <label className="text-sm block">
                    송폼과 추가 지시 <span className="song-preparation-muted">선택 사항</span>
                    <textarea
                      aria-label="송폼과 추가 지시"
                      className="block w-full bg-gray-800 p-2 mt-1"
                      rows={2}
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      placeholder="예: 첫 곡은 A B A B×2 C B TAG, 한 슬라이드에 두 줄"
                    />
                  </label>
                  <details className="song-preparation-details">
                    <summary tabIndex={0}>
                      적용 설정{' '}
                      <span>
                        {mode === 'append' ? '기존 콘티에 추가' : '콘티 새로 구성'} ·{' '}
                        {automatic ? '명확한 결과 자동 적용' : '확인 후 적용'}
                      </span>
                    </summary>
                    <div className="song-preparation-options">
                      <label className="text-sm">
                        플레이리스트 설정
                        <select
                          aria-label="플레이리스트 설정"
                          className="block w-full bg-gray-800 p-2"
                          value={mode}
                          onChange={(e) => setMode(e.target.value as 'append' | 'replace')}
                        >
                          <option value="append">기존 콘티 끝에 추가</option>
                          <option value="replace">기존 콘티 순서를 새로 구성</option>
                        </select>
                      </label>
                      <label className="text-sm">
                        적용 방식
                        <select
                          aria-label="AI 적용 방식"
                          className="block w-full bg-gray-800 p-2"
                          value={automatic ? 'automatic' : 'review'}
                          onChange={(e) => setAutomatic(e.target.value === 'automatic')}
                        >
                          <option value="review">확인 후 적용</option>
                          <option value="automatic">명확한 결과는 자동 적용</option>
                        </select>
                      </label>
                    </div>
                    <p className="song-preparation-muted">
                      새 작업에 적용되는 설정입니다. 가사·순서가 불명확하면 자동 적용도 확인을
                      기다립니다. 새 곡은 찬양 목록에 저장하며 기존 원곡 갱신은 검토 화면에서
                      선택합니다.
                    </p>
                  </details>
                  <p className="song-preparation-muted">
                    선택한 파일과 지시·준비 중인 곡 내용이 선택한 AI에 전송됩니다.
                  </p>
                </div>
              </section>
            )}
            {view === 'history' && (
              <section className="studio-history" aria-label="준비 작업 기록">
                <p className="studio-muted">
                  이전에 올린 파일과 검토 내용을 이어서 준비할 수 있어요.
                </p>
                {!jobs.length && (
                  <div className="studio-history-empty">
                    <History size={32} />
                    <h3>아직 준비한 작업이 없어요</h3>
                    <button type="button" className="studio-primary" onClick={openPrepare}>
                      첫 찬양 준비하기 <ArrowRight size={16} />
                    </button>
                  </div>
                )}
                {jobs.map((item) => (
                  <button
                    type="button"
                    disabled={locked}
                    className="studio-history-item"
                    key={item.id}
                    onClick={() => chooseJob(item)}
                  >
                    <span className="studio-history-icon">
                      <FileText size={22} />
                    </span>
                    <span>
                      <strong>{item.sources[0]?.name || '찬양 준비'}</strong>
                      <small>
                        {new Date(item.createdAt).toLocaleString()} · {item.sources.length}개 파일
                      </small>
                    </span>
                    <span className="studio-history-state">{names[item.status]}</span>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </section>
            )}
            {view === 'work' && job && (
              <>
                <div className="studio-work-summary" data-processing={processing}>
                  {' '}
                  <p role="status" className="font-bold text-sm">
                    {names[job.status]}
                  </p>
                  <span>
                    {job.sources.length}개 파일 · {job.profile.name}
                  </span>
                  {draft && !currentReceipt && (
                    <button
                      type="button"
                      className="studio-text-button"
                      aria-expanded={analysisOpen}
                      onClick={() => setAnalysisOpen(!analysisOpen)}
                    >
                      <SlidersHorizontal size={14} />
                      분석 및 작업 관리
                    </button>
                  )}
                </div>
                {!currentReceipt && showAnalysis && (
                  <div className="studio-analysis">
                    <section
                      className="song-preparation-card song-preparation-job"
                      aria-label="현재 준비 작업"
                    >
                      <p className="text-xs text-gray-400">
                        {job.sources.map((s) => `${s.name} (${s.pages}페이지)`).join(' · ')}
                      </p>
                      {(error || job?.error) && (
                        <p role="alert" className="song-preparation-error">
                          {!error && job?.error && profileChanged && (
                            <span className="block font-bold">
                              이전 분석 오류 · {job.profile.name} · {job.profile.model}
                            </span>
                          )}
                          {error || job?.error}
                        </p>
                      )}
                      {!processing && job.status !== 'completed' && (
                        <fieldset className="song-preparation-source-choices space-y-1">
                          <legend className="text-xs">
                            {job.draft ? '다시 분석할 파일 · 이전 초안 보존' : '분석할 파일'}
                          </legend>
                          {job.sources.map((source) => (
                            <label className="text-xs flex gap-2" key={source.id}>
                              <input
                                type="checkbox"
                                aria-label={`분석 파일: ${source.name}`}
                                disabled={locked}
                                checked={analysisSources.includes(source.id)}
                                onChange={(e) =>
                                  setAnalysisSources((current) =>
                                    e.target.checked
                                      ? [...current, source.id]
                                      : current.filter((id) => id !== source.id),
                                  )
                                }
                              />
                              {source.name}
                            </label>
                          ))}
                        </fieldset>
                      )}
                      {!processing && job.status !== 'completed' && selectedProfile && (
                        <p className="text-xs text-blue-200" role="note">
                          이번 분석에 사용할 AI: {selectedProfile.name} · {selectedProfile.model}
                          {profileChanged && ' · 실행하면 선택한 AI로 파일을 다시 전송합니다.'}
                        </p>
                      )}
                      <div className="flex gap-3">
                        {!processing && job.status !== 'completed' && (
                          <button
                            type="button"
                            disabled={
                              locked || !selectedProfile?.configured || analysisSources.length === 0
                            }
                            className="bg-blue-600 px-3 py-2 rounded text-sm"
                            onClick={() =>
                              void run(async () => {
                                const saved = (await savePending()) || job
                                const target = profileChanged
                                  ? await window.ipcRenderer.switchSongAI(job.id, profileId)
                                  : saved
                                if (profileChanged) setJob(target)
                                setJob(
                                  await window.ipcRenderer.analyzeSongJob(
                                    target.id,
                                    analysisSources,
                                  ),
                                )
                              })
                            }
                          >
                            {profileChanged
                              ? '선택한 AI로 파일을 다시 전송해 분석'
                              : job.draft
                                ? '같은 AI로 다시 분석'
                                : '분석 시작'}
                          </button>
                        )}
                        {job.status === 'analyzing' && (
                          <button
                            type="button"
                            onClick={() =>
                              void run(async () => {
                                setJob(await window.ipcRenderer.cancelSongJob(job.id))
                              })
                            }
                            disabled={locked}
                            className="text-sm"
                          >
                            분석 취소
                          </button>
                        )}
                      </div>
                      <details className="song-preparation-details">
                        <summary tabIndex={0}>작업 정보 및 보관</summary>
                        <div className="song-preparation-job-details">
                          <p className="text-xs">
                            {job.profile.name} · {job.profile.model} ·{' '}
                            {job.mode === 'append'
                              ? '기존 콘티 끝에 추가'
                              : '기존 콘티 순서를 새로 구성'}{' '}
                            · {job.automatic ? '명확한 결과 자동 적용' : '확인 후 적용'}
                          </p>
                          <label className="text-xs flex gap-2">
                            <input
                              aria-label="원본과 작업본 계속 보관"
                              type="checkbox"
                              checked={job.keepSources}
                              disabled={locked}
                              onChange={(e) => {
                                const keep = e.target.checked
                                setJob({ ...job, keepSources: keep })
                                void run(async () => {
                                  try {
                                    setJob(await window.ipcRenderer.retainSongSources(job.id, keep))
                                  } catch (error) {
                                    setJob(job)
                                    throw error
                                  }
                                })
                              }}
                            />
                            원본과 작업본 계속 보관 (기본 7일 후 정리)
                          </label>
                          {!processing && (
                            <button
                              type="button"
                              disabled={locked}
                              className="text-sm text-gray-400"
                              onClick={() => setDeleteConfirm(true)}
                            >
                              원본·작업본 삭제
                            </button>
                          )}
                          {deleteConfirm && (
                            <div
                              className="song-preparation-delete"
                              role="group"
                              aria-label="준비 작업 삭제 확인"
                            >
                              <p>
                                원본 파일과 검토 초안을 삭제합니다. 이미 저장한 찬양·콘티와 적용
                                기록은 유지됩니다.
                              </p>
                              <div className="flex gap-3">
                                <button
                                  type="button"
                                  disabled={locked}
                                  onClick={() => setDeleteConfirm(false)}
                                >
                                  삭제 취소
                                </button>
                                <button
                                  type="button"
                                  disabled={locked}
                                  className="text-red-300"
                                  onClick={() =>
                                    void run(async () => {
                                      await window.ipcRenderer.removeSongJob(job.id)
                                      setJobs((list) => list.filter((item) => item.id !== job.id))
                                      setJob(null)
                                      setView('prepare')
                                      setDraft(null)
                                      setReceipt(null)
                                    })
                                  }
                                >
                                  원본·작업본 삭제 확인
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </details>
                    </section>
                  </div>
                )}
                {currentReceipt ? (
                  <>
                    <div className="studio-completion">
                      <CircleCheck size={54} strokeWidth={1.3} />
                      <h3>콘티 준비를 마쳤어요</h3>
                      <p className="text-sm font-bold">
                        저장 완료 · 새 찬양 {currentReceipt.added}곡 · 원곡 갱신{' '}
                        {currentReceipt.updated}곡 · 콘티 {currentReceipt.finalItems.length}개 순서
                      </p>
                      <div className="flex gap-3">
                        <button type="button" className="text-sm text-blue-200" onClick={close}>
                          준비한 콘티 보기
                        </button>
                        {job && (
                          <button
                            type="button"
                            disabled={locked || !!currentReceipt.undoneAt}
                            className="text-xs text-gray-300 disabled:opacity-40"
                            onClick={() =>
                              void run(async () => {
                                await withOperatorLock(
                                  () => store.getState().songJobOperation('undo', job.id),
                                  modal.current || undefined,
                                )
                                setReceipt(await window.ipcRenderer.songReceipt(job.id))
                              })
                            }
                          >
                            {currentReceipt.undoneAt
                              ? '순서를 되돌렸습니다'
                              : '이번 순서 적용 되돌리기'}
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">
                        되돌리기는 콘티 순서만 복원합니다. 찬양 목록에 저장하거나 갱신한 곡은
                        유지됩니다.
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={locked}
                      className="studio-text-button studio-next-preparation"
                      onClick={openPrepare}
                    >
                      <Plus size={16} />
                      다음 찬양 준비하기
                    </button>
                  </>
                ) : draft && song ? (
                  <>
                    <nav className="studio-song-list" aria-label="검토할 곡 목록">
                      {draft.songs.map((item, index) => (
                        <button
                          type="button"
                          disabled={locked}
                          key={item.id}
                          aria-current={song.id === item.id ? 'true' : undefined}
                          onClick={() => {
                            setSongIndex(index)
                            setPreviewIndex(0)
                          }}
                        >
                          <span>{String(index + 1).padStart(2, '0')}</span>
                          <strong>{item.title}</strong>
                          {item.confirmed ? <Check size={15} /> : <small>확인 필요</small>}
                        </button>
                      ))}
                    </nav>
                    <div className="song-preparation-review studio-review">
                      <section className="studio-editor" aria-label="가사와 송폼 편집">
                        <div className="studio-pane-heading">
                          <h3>가사 · 송폼</h3>
                          <span>{song.form.parts.length}개 파트</span>
                        </div>

                        <label className="block text-xs">
                          곡 제목
                          <input
                            aria-label="곡 제목"
                            disabled={readonly}
                            className="bg-gray-800 p-2 w-full block"
                            value={song.title}
                            onChange={(e) => editSong(song.id, { title: e.target.value })}
                          />
                        </label>
                        {song.issues.length > 0 && (
                          <ul className="text-xs text-amber-200 list-disc pl-5">
                            {song.issues.map((issue, i) => (
                              <li key={i}>{issue}</li>
                            ))}
                          </ul>
                        )}
                        <div className="studio-part-tabs" role="tablist" aria-label="가사 파트">
                          {song.form.parts.map((part, index) => (
                            <button
                              type="button"
                              key={part.id}
                              role="tab"
                              id={`song-part-${part.id}`}
                              aria-controls={`song-part-panel-${part.id}`}
                              tabIndex={selectedPart === index ? 0 : -1}
                              onKeyDown={(event) => {
                                const next =
                                  event.key === 'ArrowRight'
                                    ? (index + 1) % song.form.parts.length
                                    : event.key === 'ArrowLeft'
                                      ? (index - 1 + song.form.parts.length) %
                                        song.form.parts.length
                                      : event.key === 'Home'
                                        ? 0
                                        : event.key === 'End'
                                          ? song.form.parts.length - 1
                                          : null
                                if (next === null) return
                                event.preventDefault()
                                setSelectedPart(next)
                                event.currentTarget.parentElement
                                  ?.querySelectorAll('button')
                                  [next]?.focus()
                              }}
                              aria-selected={selectedPart === index}
                              onClick={() => setSelectedPart(index)}
                            >
                              {part.label}
                              <span>{part.pages.length}장</span>
                            </button>
                          ))}
                        </div>
                        {song.form.parts.map((part, partIndex) =>
                          selectedPart === partIndex ? (
                            <div
                              key={part.id}
                              id={`song-part-panel-${part.id}`}
                              role="tabpanel"
                              aria-labelledby={`song-part-${part.id}`}
                              className="border border-gray-700 rounded p-2 space-y-2"
                            >
                              <label className="text-xs block">
                                파트 이름
                                <input
                                  aria-label={`파트 ${partIndex + 1} 이름`}
                                  disabled={readonly}
                                  className="bg-gray-800 p-1 ml-2 w-24"
                                  value={part.label}
                                  onChange={(e) =>
                                    editSong(song.id, {
                                      form: {
                                        ...song.form,
                                        parts: song.form.parts.map((p) =>
                                          p.id === part.id ? { ...p, label: e.target.value } : p,
                                        ),
                                      },
                                    })
                                  }
                                />
                              </label>
                              <label className="text-xs block">
                                가사 · 빈 줄로 슬라이드 구분
                                <textarea
                                  aria-label={`파트 ${partIndex + 1} 가사`}
                                  disabled={readonly}
                                  className="block w-full bg-gray-800 p-2"
                                  rows={4}
                                  value={part.pages.join('\n\n')}
                                  onChange={(e) =>
                                    editSong(song.id, {
                                      form: {
                                        ...song.form,
                                        parts: song.form.parts.map((p) =>
                                          p.id === part.id
                                            ? {
                                                ...p,
                                                pages: e.target.value
                                                  .replace(/\r/g, '')
                                                  .split('\n\n'),
                                              }
                                            : p,
                                        ),
                                      },
                                    })
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                className="text-xs text-blue-300"
                                onClick={() => {
                                  setSourceIndex(
                                    job.sources.findIndex((s) => s.id === part.sourceId),
                                  )
                                  setSourcePage(part.sourcePage)
                                  if (sourceDetails.current) {
                                    sourceDetails.current.open = true
                                    sourceDetails.current.scrollIntoView({
                                      block: 'start',
                                      behavior: 'smooth',
                                    })
                                  }
                                }}
                              >
                                근거: {job.sources.find((s) => s.id === part.sourceId)?.name} ·{' '}
                                {part.sourcePage}페이지
                              </button>
                            </div>
                          ) : null,
                        )}
                        <fieldset disabled={readonly} className="space-y-1">
                          <legend className="text-sm font-bold">송폼 순서와 반복</legend>
                          {song.form.sequence.map((step, index) => (
                            <div className="flex gap-2 text-xs items-center" key={index}>
                              <span>{index + 1}</span>
                              <select
                                aria-label={`순서 ${index + 1} 파트`}
                                value={step.partId}
                                className="bg-gray-800 p-2"
                                onChange={(e) =>
                                  editSong(song.id, {
                                    form: {
                                      ...song.form,
                                      sequence: song.form.sequence.map((s, i) =>
                                        i === index ? { ...s, partId: e.target.value } : s,
                                      ),
                                    },
                                  })
                                }
                              >
                                {song.form.parts.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.label}
                                  </option>
                                ))}
                              </select>
                              <label>
                                반복{' '}
                                <input
                                  aria-label={`순서 ${index + 1} 반복`}
                                  aria-invalid={
                                    !Number.isInteger(step.repeat) ||
                                    step.repeat < 1 ||
                                    step.repeat > 20
                                  }
                                  type="number"
                                  min={1}
                                  max={20}
                                  className="bg-gray-800 p-2 w-14"
                                  value={step.repeat}
                                  onChange={(e) =>
                                    editSong(song.id, {
                                      form: {
                                        ...song.form,
                                        sequence: song.form.sequence.map((s, i) =>
                                          i === index
                                            ? { ...s, repeat: Number(e.target.value) }
                                            : s,
                                        ),
                                      },
                                    })
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                aria-label={`순서 ${index + 1} 위로`}
                                disabled={index === 0}
                                onClick={() => {
                                  const sequence = [...song.form.sequence]
                                  ;[sequence[index - 1], sequence[index]] = [
                                    sequence[index],
                                    sequence[index - 1],
                                  ]
                                  editSong(song.id, { form: { ...song.form, sequence } })
                                }}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={`순서 ${index + 1} 삭제`}
                                disabled={song.form.sequence.length <= 1}
                                onClick={() =>
                                  editSong(song.id, {
                                    form: {
                                      ...song.form,
                                      sequence: song.form.sequence.filter((_, i) => i !== index),
                                    },
                                  })
                                }
                              >
                                삭제
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="text-blue-300 text-xs p-1"
                            disabled={song.form.sequence.length >= 100}
                            onClick={() =>
                              editSong(song.id, {
                                form: {
                                  ...song.form,
                                  sequence: [
                                    ...song.form.sequence,
                                    { partId: song.form.parts[0].id, repeat: 1 },
                                  ],
                                },
                              })
                            }
                          >
                            송폼 순서 추가
                          </button>
                        </fieldset>
                        <details className="studio-linkage">
                          <summary tabIndex={0}>찬양 목록 원곡 연결</summary>{' '}
                          <label className="block text-xs">
                            찬양 목록 원곡 연결
                            <select
                              aria-label="찬양 목록 원곡 연결"
                              disabled={readonly}
                              value={song.originalId || ''}
                              className="bg-gray-800 p-2 block w-full"
                              onChange={(e) => {
                                const p = library.find((p) => p.id === e.target.value)
                                editSong(song.id, {
                                  originalId: p?.id || null,
                                  originalRevision: p?.revision ?? (p ? 0 : null),
                                  updateOriginal: false,
                                })
                              }}
                            >
                              <option value="">새 곡으로 찬양 목록에도 저장</option>
                              {library
                                .filter(
                                  (p) =>
                                    p.id === song.originalId ||
                                    titleKey(p.title) === titleKey(song.title),
                                )
                                .map((p) => (
                                  <option value={p.id} key={p.id}>
                                    {p.title} · {p.slides.length}슬라이드
                                  </option>
                                ))}
                            </select>
                          </label>
                          {song.originalId && (
                            <label className="flex gap-2 text-xs">
                              <input
                                aria-label="기존 원곡도 이번 구성으로 갱신"
                                disabled={readonly}
                                type="checkbox"
                                checked={song.updateOriginal}
                                onChange={(e) =>
                                  editSong(song.id, { updateOriginal: e.target.checked })
                                }
                              />
                              기존 원곡도 이번 구성으로 갱신
                            </label>
                          )}
                        </details>
                      </section>
                      <section className="studio-reference" aria-label="미리보기와 원본">
                        <div className="studio-pane-heading">
                          <h3>화면 확인</h3>
                          <span>현재 송출에는 영향을 주지 않아요</span>
                        </div>
                        {source && (
                          <details
                            ref={sourceDetails}
                            onToggle={(event) => setSourceOpen(event.currentTarget.open)}
                          >
                            <summary tabIndex={0} className="text-sm cursor-pointer">
                              원본 확인
                            </summary>
                            <div className="song-preparation-source-controls flex gap-2 py-2">
                              <select
                                aria-label="원본 파일"
                                className="bg-gray-800 p-2 text-xs"
                                value={sourceIndex}
                                onChange={(e) => {
                                  setSourceIndex(Number(e.target.value))
                                  setSourcePage(1)
                                }}
                              >
                                {job.sources.map((f, i) => (
                                  <option value={i} key={f.id}>
                                    {f.name}
                                  </option>
                                ))}
                              </select>
                              <label className="text-xs">
                                페이지{' '}
                                <input
                                  aria-label="원본 페이지"
                                  type="number"
                                  className="bg-gray-800 p-2 w-16"
                                  min={1}
                                  max={source.pages}
                                  value={sourcePage}
                                  onChange={(e) =>
                                    setSourcePage(
                                      Math.max(1, Math.min(source.pages, Number(e.target.value))),
                                    )
                                  }
                                />
                              </label>
                            </div>
                            {sourceOpen && (
                              <SongSourcePreview
                                key={`${job.id}:${source.id}`}
                                jobId={job.id}
                                sourceId={source.id}
                                page={sourcePage}
                              />
                            )}
                          </details>
                        )}

                        <p className="text-sm font-bold">
                          슬라이드 미리보기 · {preview?.slides.length || 0}장
                        </p>
                        {preview?.slides.length ? (
                          <>
                            <div className="aspect-video relative">
                              <ScaledSlide
                                slide={
                                  preview.slides[Math.min(previewIndex, preview.slides.length - 1)]
                                }
                                globalStyleOverride={job.style}
                              />
                            </div>
                            <div className="flex items-center gap-2 text-xs">
                              <button
                                type="button"
                                onClick={() => setPreviewIndex(Math.max(0, previewIndex - 1))}
                              >
                                이전
                              </button>
                              <span>
                                {Math.min(previewIndex + 1, preview.slides.length)}/
                                {preview.slides.length} ·{' '}
                                {
                                  preview.slides[Math.min(previewIndex, preview.slides.length - 1)]
                                    .label
                                }
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setPreviewIndex(
                                    Math.min(preview.slides.length - 1, previewIndex + 1),
                                  )
                                }
                              >
                                다음
                              </button>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-amber-200">
                            송폼을 유효하게 수정한 뒤 미리보기를 확인하세요.
                          </p>
                        )}
                        <fieldset disabled={readonly} className="space-y-2">
                          <legend className="text-sm font-bold">콘티 곡 순서</legend>
                          {draft.order.map((id, index) => (
                            <div key={index} className="flex items-center gap-2 text-xs">
                              <span>{index + 1}</span>
                              <select
                                aria-label={`콘티 ${index + 1} 곡`}
                                className="bg-gray-800 p-2"
                                value={id}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    order: draft.order.map((x, i) =>
                                      i === index ? e.target.value : x,
                                    ),
                                  })
                                }
                              >
                                {draft.songs.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.title}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                aria-label={`콘티 ${index + 1} 위로`}
                                disabled={index === 0}
                                onClick={() => {
                                  const order = [...draft.order]
                                  ;[order[index - 1], order[index]] = [
                                    order[index],
                                    order[index - 1],
                                  ]
                                  setDraft({ ...draft, order })
                                }}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                disabled={draft.order.length === 1}
                                aria-label={`콘티 ${index + 1} 제외`}
                                onClick={() => {
                                  const order = draft.order.filter((_, i) => i !== index),
                                    used = new Set(order)
                                  setDraft({
                                    ...draft,
                                    order,
                                    songs: draft.songs.filter((s) => used.has(s.id)),
                                  })
                                  setSongIndex(0)
                                }}
                              >
                                제외
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="text-xs text-blue-300"
                            disabled={draft.order.length >= 1000}
                            onClick={() => setDraft({ ...draft, order: [...draft.order, song.id] })}
                          >
                            선택한 곡을 한 번 더 추가
                          </button>
                        </fieldset>
                      </section>
                    </div>
                    <footer className="studio-review-footer">
                      <label className="flex gap-2 text-sm text-blue-200">
                        <input
                          aria-label="이 곡의 가사와 송폼 확인 완료"
                          disabled={readonly || problems.length > 0}
                          type="checkbox"
                          checked={song.confirmed}
                          onChange={(e) => editSong(song.id, { confirmed: e.target.checked })}
                        />
                        이 곡의 가사·송폼·원곡 연결 확인 완료
                      </label>
                      <div className="song-preparation-review-progress" aria-live="polite">
                        <strong>
                          {confirmedCount}/{draft.songs.length}곡 확인 완료
                        </strong>
                        <span>
                          {dirty
                            ? '수정 내용 있음 · 작업을 바꾸거나 닫으면 저장합니다.'
                            : '검토 내용이 저장되어 있습니다.'}
                        </span>
                      </div>
                      {problems.length > 0 && (
                        <div className="song-preparation-validation" aria-live="polite">
                          <strong>저장 전에 확인해주세요</strong>
                          <ul>
                            {problems.slice(0, 5).map((problem) => (
                              <li key={problem}>{problem}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {dirty && !processing && (
                        <div className="text-xs">
                          {!restoreConfirm ? (
                            <button
                              type="button"
                              disabled={locked}
                              className="text-gray-400 underline"
                              onClick={() => setRestoreConfirm(true)}
                            >
                              수정 취소
                            </button>
                          ) : (
                            <div
                              className="song-preparation-delete"
                              role="group"
                              aria-label="초안 수정 취소 확인"
                            >
                              <p>
                                저장하지 않은 수정을 버리고 마지막으로 저장한 초안으로 돌아갑니다.
                              </p>
                              <div className="flex gap-3">
                                <button
                                  type="button"
                                  disabled={locked}
                                  onClick={() => setRestoreConfirm(false)}
                                >
                                  계속 수정
                                </button>
                                <button
                                  type="button"
                                  disabled={locked}
                                  onClick={() => {
                                    setDraft(job.draft ? structuredClone(job.draft) : null)
                                    setRestoreConfirm(false)
                                    setError('')
                                  }}
                                >
                                  저장된 초안 복원
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {!processing && job.status !== 'completed' && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={locked}
                            className="bg-gray-800 rounded p-2 text-sm"
                            onClick={() => void run(save)}
                          >
                            {busy ? '저장 중…' : '검토 내용 저장'}
                          </button>
                          <button
                            type="button"
                            disabled={
                              locked ||
                              !draft.songs.every((s) => s.confirmed) ||
                              !preview ||
                              problems.length > 0
                            }
                            className="bg-blue-600 rounded p-2 text-sm disabled:opacity-40"
                            onClick={() =>
                              void run(async () => {
                                const saved = await save()
                                if (!saved) return
                                await withOperatorLock(
                                  () =>
                                    store
                                      .getState()
                                      .songJobOperation('apply', saved.id, saved.draftRevision),
                                  modal.current || undefined,
                                )
                                setJob(
                                  (await window.ipcRenderer.listSongJobs()).find(
                                    (j) => j.id === saved.id,
                                  )!,
                                )
                                setReceipt(await window.ipcRenderer.songReceipt(saved.id))
                              })
                            }
                          >
                            {job.status === 'failed'
                              ? '준비된 곡만 플레이리스트에 적용'
                              : '플레이리스트에 적용'}
                          </button>
                          <button
                            type="button"
                            disabled={locked}
                            className="text-xs text-blue-300"
                            onClick={() =>
                              void run(async () => {
                                await savePending()
                                await withOperatorLock(
                                  () => store.getState().songJobOperation('rebase', job.id),
                                  modal.current || undefined,
                                )
                                setJob(
                                  (await window.ipcRenderer.listSongJobs()).find(
                                    (j) => j.id === job.id,
                                  )!,
                                )
                              })
                            }
                          >
                            최신 콘티에 맞춰 다시 확인
                          </button>
                        </div>
                      )}
                    </footer>
                  </>
                ) : (
                  <div className="studio-analysis-guide">
                    <FileText size={27} />
                    <div>
                      <strong>분석이 끝나면 곡별 검토 화면이 열립니다.</strong>
                      <p>가사, 반복 순서, 슬라이드를 확인한 뒤 콘티에 적용하세요.</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </main>
        </div>
        {connections && (
          <div className="studio-connections-layer">
            <div
              className="studio-connections-sheet"
              role="dialog"
              data-modal="true"
              aria-modal="true"
              aria-label="AI 연결 설정 패널"
            >
              <div id="song-ai-connections">
                <AIProfilesPanel
                  onClose={closeConnections}
                  onBusyChange={setConnectionsBusy}
                  onChanged={() => loadProfiles(true)}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
