import { useEffect, useRef, useState } from 'react'
import { useModalGuard } from '../hooks/useModalGuard'
import { usePresentationStore as store } from '../store'
import { withOperatorLock } from '../store/preparation'
import { flushPersistence } from '../store/persistence'
import {
  compileSong,
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
  const connectionsButton = useRef<HTMLButtonElement>(null)
  const [profiles, setProfiles] = useState<(ConnectionProfile & { configured: boolean })[]>([]),
    [profileId, setProfileId] = useState('')
  const [jobs, setJobs] = useState<SongJob[]>([]),
    [job, setJob] = useState<SongJob | null>(null),
    [draft, setDraft] = useState<DraftSet | null>(null)
  const [mode, setMode] = useState<'append' | 'replace'>('append'),
    [automatic, setAutomatic] = useState(false),
    [instruction, setInstruction] = useState('')
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
  const processing = !!job && ['analyzing', 'committing'].includes(job.status)
  const closeConnections = () => {
    setConnections(false)
    connectionsButton.current?.focus()
  }
  const close = () => {
    if (busy) return
    if (
      job &&
      draft &&
      !processing &&
      !['completed', 'canceled'].includes(job.status) &&
      JSON.stringify(draft) !== JSON.stringify(job.draft)
    ) {
      setBusy(true)
      void window.ipcRenderer
        .editSongJob(job.id, { expectedDraftRevision: job.draftRevision, draft })
        .then(onClose)
        .catch(() =>
          setError('수정한 내용을 저장하지 못했습니다. 송폼과 저장 상태를 확인해주세요.'),
        )
        .finally(() => setBusy(false))
    } else onClose()
  }
  useModalGuard(true, () => (connections ? closeConnections() : close()))
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
    if (job)
      void window.ipcRenderer
        .songReceipt(job.id)
        .then(setReceipt)
        .catch(() => {})
  }, [job?.id, job?.draftRevision, job?.status])
  useEffect(() => {
    setAnalysisSources(job?.sources.map((source) => source.id) || [])
  }, [job?.id])
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return
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
      setBusy(false)
    }
  }
  const selectFiles = async (files?: File[]) =>
    run(async () => {
      await flushPersistence()
      const options = { profileId, instruction, mode, automatic }
      const next = files
        ? await window.ipcRenderer.dropSongFiles(files, options)
        : await window.ipcRenderer.selectSongFiles(options)
      if (next) {
        setJob(next)
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
  const save = async () => {
    if (!job || !draft) return
    const updated = await window.ipcRenderer.editSongJob(job.id, {
      expectedDraftRevision: job.draftRevision,
      draft,
    })
    setJob(updated)
    return updated
  }
  const song = draft?.songs[Math.min(songIndex, (draft?.songs.length || 1) - 1)]
  let preview: ReturnType<typeof compileSong> | null = null
  try {
    if (song && job) preview = compileSong(song, job.style)
  } catch {
    /* A partially edited form is validated when saved. */
  }
  const readonly = processing || job?.status === 'completed' || job?.status === 'canceled'
  const source = job?.sources[Math.min(sourceIndex, job.sources.length - 1)]
  return (
    <div
      ref={modal}
      data-modal="true"
      data-song-preparation="true"
      role="dialog"
      aria-modal="true"
      aria-label="AI로 찬양 준비"
      className="fixed inset-0 z-[70] bg-black/80 p-4 flex items-center justify-center"
    >
      <div
        className="w-full max-w-6xl max-h-[94vh] overflow-auto bg-gray-900 text-gray-200 border border-gray-700 rounded-xl p-5 space-y-4"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          void selectFiles(Array.from(e.dataTransfer.files))
        }}
      >
        <div className="sticky -top-5 z-10 -mx-5 -mt-5 flex justify-between items-center border-b border-gray-700 bg-gray-900 p-5">
          <div>
            <h2 className="text-lg font-bold">AI로 찬양 준비</h2>
            <p className="text-xs text-gray-400">
              현재 콘티: {active?.title || '없음 · 적용 시 새 콘티 생성'} ·{' '}
              {active?.items.length || 0}곡
            </p>
          </div>
          <button
            type="button"
            aria-label="AI 준비 창 닫기"
            disabled={busy}
            onClick={close}
            className="p-2"
          >
            닫기
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            사용할 AI
            <select
              aria-label="사용할 AI"
              disabled={busy || processing}
              className="block w-full bg-gray-800 p-2"
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ·{' '}
                  {p.provider === 'gemini'
                    ? 'Gemini'
                    : p.provider === 'openai'
                      ? 'OpenAI'
                      : 'Claude'}{' '}
                  · {p.model}
                  {p.configured ? '' : ' · 키 필요'}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              ref={connectionsButton}
              type="button"
              aria-expanded={connections}
              aria-controls="song-ai-connections"
              className="bg-gray-800 rounded p-2 text-sm"
              onClick={() => (connections ? closeConnections() : setConnections(true))}
            >
              {connections ? 'AI 연결 추가 닫기' : 'AI 연결 추가'}
            </button>
          </div>
          <p className="col-span-2 -mt-2 text-xs text-gray-400">
            등록된 연결만 선택할 수 있습니다. Gemini · OpenAI · Claude API를 연결할 수 있어요.
          </p>
          {profileId && !selectedProfile?.configured && (
            <p role="status" className="col-span-2 -mt-2 text-xs text-amber-300">
              선택한 AI에 API 키가 없습니다. 연결을 열어 키를 등록해주세요.
            </p>
          )}
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
        {connections && (
          <div id="song-ai-connections">
            <AIProfilesPanel onClose={closeConnections} onChanged={() => void loadProfiles(true)} />
          </div>
        )}
        <label className="text-sm block">
          송폼과 추가 지시
          <textarea
            aria-label="송폼과 추가 지시"
            className="block w-full bg-gray-800 p-2 mt-1"
            rows={2}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="예: 첫 곡은 A B A B×2 C B TAG, 한 슬라이드에 두 줄"
          />
        </label>
        <p className="text-xs text-gray-400">
          새 작업의 조건입니다. 선택한 파일과 이번 작업의 지시·준비 중인 곡 내용은 선택한 AI에
          전송됩니다. 새 곡은 찬양 목록에도 저장하며, 기존 원곡 갱신은 검토 화면에서 별도로
          선택합니다. 가사·순서가 불명확하면 자동 적용을 멈추고 확인합니다.
        </p>
        <div className="flex gap-2 items-center flex-wrap">
          <button
            type="button"
            disabled={busy || processing || !selectedProfile?.configured}
            className="bg-blue-600 p-2 rounded text-sm disabled:opacity-40"
            onClick={() => void selectFiles()}
          >
            PDF·이미지 파일 선택
          </button>
          <span className="text-xs text-gray-400">
            여기에 파일을 끌어 놓아도 됩니다 · 20개/40MB/50페이지, 파일당 20MB
          </span>
        </div>
        {jobs.length > 0 && (
          <label className="block text-xs">
            최근 준비 작업
            <select
              aria-label="최근 준비 작업"
              value={job?.id || ''}
              className="bg-gray-800 p-2 ml-2 max-w-full"
              onChange={(e) => {
                setJob(jobs.find((j) => j.id === e.target.value) || null)
                setSongIndex(0)
                setSourceIndex(0)
              }}
            >
              {jobs.map((j) => (
                <option value={j.id} key={j.id}>
                  {new Date(j.createdAt).toLocaleString()} · {j.sources[0]?.name} ·{' '}
                  {names[j.status]}
                </option>
              ))}
            </select>
          </label>
        )}
        {(error || job?.error) && (
          <p role="alert" className="bg-red-950/50 text-red-200 p-3 text-sm rounded">
            {!error && job?.error && profileChanged && (
              <span className="block font-bold">
                이전 분석 오류 · {job.profile.name} · {job.profile.model}
              </span>
            )}
            {error || job?.error}
          </p>
        )}
        {job && (
          <>
            <div className="bg-gray-800 rounded p-3 space-y-2">
              <p role="status" className="font-bold text-sm">
                {names[job.status]}
              </p>
              <p className="text-xs">
                {job.profile.name} · {job.profile.model} ·{' '}
                {job.mode === 'append' ? '기존 콘티 끝에 추가' : '기존 콘티 순서를 새로 구성'} ·{' '}
                {job.automatic ? '명확한 결과 자동 적용' : '확인 후 적용'}
              </p>
              <label className="text-xs flex gap-2">
                <input
                  aria-label="원본과 작업본 계속 보관"
                  type="checkbox"
                  checked={job.keepSources}
                  disabled={busy}
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
              <p className="text-xs text-gray-400">
                {job.sources.map((s) => `${s.name} (${s.pages}페이지)`).join(' · ')}
              </p>
              {!processing && job.status !== 'completed' && (
                <fieldset className="space-y-1">
                  <legend className="text-xs">다시 분석할 파일 (이전 초안은 보존)</legend>
                  {job.sources.map((source) => (
                    <label className="text-xs flex gap-2" key={source.id}>
                      <input
                        type="checkbox"
                        aria-label={`분석 파일: ${source.name}`}
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
                    disabled={busy || !selectedProfile?.configured || analysisSources.length === 0}
                    className="bg-blue-600 px-3 py-2 rounded text-sm"
                    onClick={() =>
                      void run(async () => {
                        const target = profileChanged
                          ? await window.ipcRenderer.switchSongAI(job.id, profileId)
                          : job
                        if (profileChanged) setJob(target)
                        setJob(await window.ipcRenderer.analyzeSongJob(target.id, analysisSources))
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
                    disabled={busy}
                    className="text-sm"
                  >
                    분석 취소
                  </button>
                )}
                {!processing && (
                  <button
                    type="button"
                    disabled={busy}
                    className="text-sm text-gray-400"
                    onClick={() =>
                      void run(async () => {
                        await window.ipcRenderer.removeSongJob(job.id)
                        setJobs((list) => list.filter((j) => j.id !== job.id))
                        setJob(null)
                        setDraft(null)
                      })
                    }
                  >
                    원본·작업본 삭제
                  </button>
                )}
              </div>
            </div>
            {source && (
              <details>
                <summary className="text-sm cursor-pointer">원본 확인</summary>
                <div className="flex gap-2 py-2">
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
                        setSourcePage(Math.max(1, Math.min(source.pages, Number(e.target.value))))
                      }
                    />
                  </label>
                </div>
                <SongSourcePreview jobId={job.id} sourceId={source.id} page={sourcePage} />
              </details>
            )}
          </>
        )}
        {job && draft && song && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <label className="block text-sm">
                검토할 곡
                <select
                  aria-label="검토할 곡"
                  className="block bg-gray-800 p-2 w-full"
                  value={song.id}
                  onChange={(e) => {
                    setSongIndex(draft.songs.findIndex((s) => s.id === e.target.value))
                    setPreviewIndex(0)
                  }}
                >
                  {draft.songs.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.title} · {s.confirmed ? '확인됨' : '확인 필요'}
                    </option>
                  ))}
                </select>
              </label>
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
              {song.form.parts.map((part, partIndex) => (
                <div key={part.id} className="border border-gray-700 rounded p-2 space-y-2">
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
                                ? { ...p, pages: e.target.value.replace(/\r/g, '').split('\n\n') }
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
                      setSourceIndex(job.sources.findIndex((s) => s.id === part.sourceId))
                      setSourcePage(part.sourcePage)
                    }}
                  >
                    근거: {job.sources.find((s) => s.id === part.sourceId)?.name} ·{' '}
                    {part.sourcePage}페이지
                  </button>
                </div>
              ))}
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
                                i === index ? { ...s, repeat: Number(e.target.value) } : s,
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
                      (p) => p.id === song.originalId || titleKey(p.title) === titleKey(song.title),
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
                    onChange={(e) => editSong(song.id, { updateOriginal: e.target.checked })}
                  />
                  기존 원곡도 이번 구성으로 갱신
                </label>
              )}
              <label className="flex gap-2 text-sm text-blue-200">
                <input
                  aria-label="이 곡의 가사와 송폼 확인 완료"
                  disabled={readonly}
                  type="checkbox"
                  checked={song.confirmed}
                  onChange={(e) => editSong(song.id, { confirmed: e.target.checked })}
                />
                이 곡의 가사·송폼·원곡 연결 확인 완료
              </label>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-bold">
                슬라이드 미리보기 · {preview?.slides.length || 0}장
              </p>
              {preview?.slides.length ? (
                <>
                  <div className="aspect-video relative">
                    <ScaledSlide
                      slide={preview.slides[Math.min(previewIndex, preview.slides.length - 1)]}
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
                      {Math.min(previewIndex + 1, preview.slides.length)}/{preview.slides.length} ·{' '}
                      {preview.slides[Math.min(previewIndex, preview.slides.length - 1)].label}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewIndex(Math.min(preview.slides.length - 1, previewIndex + 1))
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
                          order: draft.order.map((x, i) => (i === index ? e.target.value : x)),
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
                        ;[order[index - 1], order[index]] = [order[index], order[index - 1]]
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
                  onClick={() => setDraft({ ...draft, order: [...draft.order, song.id] })}
                >
                  선택한 곡을 한 번 더 추가
                </button>
              </fieldset>
              <p className="text-xs text-gray-400">
                준비한 곡은 이번 콘티에 독립적으로 보존됩니다. 적용해도 현재 편집과 송출은
                유지됩니다.
              </p>
              {!readonly && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className="bg-gray-800 rounded p-2 text-sm"
                    onClick={() => void run(save)}
                  >
                    검토 내용 저장
                  </button>
                  <button
                    type="button"
                    disabled={busy || !draft.songs.every((s) => s.confirmed) || !preview}
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
                          (await window.ipcRenderer.listSongJobs()).find((j) => j.id === saved.id)!,
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
                    disabled={busy}
                    className="text-xs text-blue-300"
                    onClick={() =>
                      void run(async () => {
                        await withOperatorLock(
                          () => store.getState().songJobOperation('rebase', job.id),
                          modal.current || undefined,
                        )
                        setJob(
                          (await window.ipcRenderer.listSongJobs()).find((j) => j.id === job.id)!,
                        )
                      })
                    }
                  >
                    최신 콘티에 맞춰 다시 확인
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {receipt && (
          <div className="bg-blue-950/50 border border-blue-700 p-3 rounded space-y-2">
            <p className="text-sm font-bold">
              저장 완료 · 새 찬양 {receipt.added}곡 · 원곡 갱신 {receipt.updated}곡 · 콘티{' '}
              {receipt.finalItems.length}개 순서
            </p>
            <div className="flex gap-3">
              <button type="button" className="text-sm text-blue-200" onClick={close}>
                준비한 콘티 보기
              </button>
              {job && (
                <button
                  type="button"
                  disabled={busy || !!receipt.undoneAt}
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
                  {receipt.undoneAt ? '순서를 되돌렸습니다' : '이번 순서 적용 되돌리기'}
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400">
              되돌리기는 콘티 순서만 복원합니다. 찬양 목록에 저장하거나 갱신한 곡은 유지됩니다.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
