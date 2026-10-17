import { useEffect, useState } from 'react'
import { usePresentationStore } from '../store'
import { useMusicState, setMusicBridge } from '../music/state'
import { playPrepared, prepareMusic, stopMusic, toggleMusic } from '../music/actions'
import {
  LocalMusicSchema,
  MusicItemSchema,
  musicURL,
  type MusicItem,
  type LocalMusic,
} from '../../shared/music'
import { mediaKind } from '../../shared/model'
const clock = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(n % 60)
    .toString()
    .padStart(2, '0')}`
export default function MusicPanel() {
  const lists = usePresentationStore((s) => s.setlists),
    id = usePresentationStore((s) => s.activeSetlistId),
    audio = usePresentationStore((s) => s.activeAudio)
  const music = useMusicState(),
    list = lists.find((x) => x.id === id),
    items = list?.music || []
  const [form, setForm] = useState<MusicItem | null>(null),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [extensionId, setExtensionId] = useState(''),
    [setup, setSetup] = useState(false),
    [undoItems, setUndoItems] = useState<{ item: MusicItem; index: number } | null>(null),
    [confirmed, setConfirmed] = useState(false)
  useEffect(() => {
    if (useMusicState.getState().prepared?.setlistId !== id)
      useMusicState.setState({ prepared: null })
    setForm(null)
    setUndoItems(null)
    setError('')
  }, [id])
  useEffect(() => {
    useMusicState.setState({ undoPin: undoItems?.item || null })
    return () => useMusicState.setState({ undoPin: null })
  }, [undoItems])
  useEffect(() => setConfirmed(false), [music.bridge.bindingId, music.bridge.stale])
  async function persist(next: MusicItem[]) {
    if (!list) throw new Error('예배를 먼저 만들거나 열어주세요.')
    setSaving(true)
    try {
      const workspace = await window.ipcRenderer.saveMusic({
        setlistId: list.id,
        expectedRevision: list.revision,
        items: next,
      })
      usePresentationStore.setState(workspace)
    } finally {
      setSaving(false)
    }
  }
  async function files(): Promise<string | undefined> {
    const selected = await window.ipcRenderer.selectMediaFiles()
    const url = selected.find((x) => mediaKind(x) === 'audio')
    if (!url && selected.length) throw new Error('오디오 파일을 선택해주세요.')
    if (url) usePresentationStore.getState().addMediaToBin([url])
    return url
  }
  async function addLocal() {
    try {
      setError('')
      const url = await files()
      if (!url) return
      setForm({
        id: crypto.randomUUID(),
        revision: 0,
        title: decodeURIComponent(url.split('/').pop() || '음악'),
        source: { kind: 'local', local: LocalMusicSchema.parse({ url }) },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일을 선택하지 못했습니다.')
    }
  }
  function prepare(item: MusicItem) {
    void prepareMusic(item, id!)
  }
  const local = form?.source.kind === 'local' ? form.source.local : undefined
  const updateLocal = (value: Partial<LocalMusic>) => {
    if (form?.source.kind === 'local')
      setForm({ ...form, source: { kind: 'local', local: { ...form.source.local, ...value } } })
  }
  const preparedSource = music.prepared?.item.source
  const targetURL = preparedSource?.kind === 'youtube-music' ? new URL(preparedSource.url) : null
  const targetReady =
    !targetURL ||
    (music.bridge.connected &&
      !music.bridge.stale &&
      music.bridge.playing !== null &&
      (targetURL.pathname === '/playlist'
        ? targetURL.searchParams.get('list') === music.bridge.listId
        : targetURL.searchParams.get('v') === music.bridge.videoId))
  return (
    <section className="music-panel" aria-label="예배 음악">
      <div className="music-row justify-between">
        <h2 className="workbench-heading">음악</h2>
        <span className="text-xs text-gray-500">
          {items.length}개 · {list?.title || '예배 선택 필요'}
        </span>
      </div>
      <div className="music-message">
        {music.activeExternal
          ? `${music.activeExternal.title} · 유튜브 뮤직 ${music.bridge.stale ? '상태 미확인' : music.bridge.playing ? '재생 중' : '일시정지'}`
          : audio
            ? `${audio.name} · ${music.phase === 'playing' ? '재생 중' : music.phase === 'starting' ? '재생 확인 중' : '일시정지'}`
            : '현재 재생 중인 음악 없음'}
      </div>
      {audio && (
        <div className="music-message tabular-nums">
          {clock(music.position)} / {clock(music.duration)}
          {audio.ownerSetlistId && audio.ownerSetlistId !== id ? ' · 다른 예배의 음악' : ''}
        </div>
      )}
      {music.activeExternal && (
        <p className="music-message">
          {music.bridge.title ? `현재 곡: ${music.bridge.title}` : '현재 곡 정보 확인 불가'} ·{' '}
          {music.bridge.connected && !music.bridge.stale ? '브라우저 연결됨' : '브라우저 확인 필요'}
        </p>
      )}
      {(audio || music.activeExternal) && (
        <div className="music-controls">
          <button
            className="workbench-button"
            disabled={music.busy || (!!music.activeExternal && music.bridge.stale)}
            onClick={() => void toggleMusic()}
          >
            {audio?.playing || music.bridge.playing ? '일시정지' : '이어 재생'}
          </button>
          {audio && (
            <>
              <button
                className="workbench-button"
                onClick={() =>
                  useMusicState.setState((s) => ({ restartRequest: s.restartRequest + 1 }))
                }
              >
                처음부터
              </button>
              <button
                className="workbench-button"
                disabled={!audio.playing}
                onClick={() => useMusicState.setState((s) => ({ fadeRequest: s.fadeRequest + 1 }))}
              >
                {audio.fadeSeconds ?? 3}초간 줄여 멈춤
              </button>
            </>
          )}
          <button className="workbench-button workbench-button-danger" onClick={stopMusic}>
            음악 중지
          </button>
        </div>
      )}
      {audio && (
        <label className="music-row music-message">
          현재 음량 {Math.round((audio.volume ?? 0.5) * 100)}%
          <input
            type="range"
            aria-label="오디오 음량"
            min="0"
            max="1"
            step=".05"
            value={audio.volume ?? 0.5}
            onChange={(e) =>
              usePresentationStore.setState((s) => ({
                activeAudio: s.activeAudio
                  ? { ...s.activeAudio, volume: Number(e.target.value) }
                  : null,
              }))
            }
          />
        </label>
      )}
      {music.activeExternal && (
        <p className="music-message">음량은 유튜브 뮤직 브라우저에서 조절합니다.</p>
      )}
      {(music.message || error) && (
        <p role="status" className="music-message text-amber-500">
          {error || music.message}
        </p>
      )}
      {music.bridge.stale && (
        <div className="music-message rounded border border-amber-500/30 p-2">
          <p>음악이 계속 나올 수 있습니다. 브라우저에서 먼저 멈춰주세요.</p>
          <button
            className="workbench-button"
            onClick={() => {
              const source = music.activeExternal?.source
              if (source?.kind === 'youtube-music') void window.ipcRenderer.openMusicURL(source.url)
            }}
          >
            브라우저 확인
          </button>
          <label className="block mt-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{' '}
            외부 음악을 직접 멈췄습니다
          </label>
          {music.activeExternal?.source.kind === 'youtube-music' &&
            music.activeExternal.source.fallback && (
              <button
                className="workbench-button"
                disabled={!confirmed || music.busy}
                onClick={() => void playPrepared(true, true)}
              >
                확인 후 대체 음원 재생
              </button>
            )}
        </div>
      )}
      {music.prepared && (
        <div className="music-message border-t border-white/10 pt-2">
          <p>다음 준비: {music.prepared.item.title} · 아직 재생하지 않음</p>
          <button
            className="workbench-button workbench-button-primary"
            disabled={music.busy || !targetReady}
            onClick={() => void playPrepared()}
          >
            {audio || music.activeExternal ? '전환해 재생' : '준비한 음악 재생'}
          </button>
          {!targetReady && (
            <p className="music-message">유튜브 뮤직 탭을 연결하고 재생 대상을 확인해주세요.</p>
          )}
        </div>
      )}
      <div className="music-controls">
        <button
          className="workbench-button"
          aria-label="오디오 선택"
          disabled={!list || saving || !!form}
          onClick={() => void addLocal()}
        >
          파일 음악 추가
        </button>
        <button
          className="workbench-button"
          disabled={!list || saving || !!form}
          onClick={() =>
            setForm({
              id: crypto.randomUUID(),
              revision: 0,
              title: '',
              source: { kind: 'youtube-music', url: '' },
            })
          }
        >
          유튜브 뮤직 링크
        </button>
        <button className="workbench-button" onClick={() => setSetup(!setup)}>
          브라우저 연결
        </button>
      </div>
      {!list && <p className="music-message">콘티 보관함에서 예배를 먼저 만들거나 열어주세요.</p>}
      {setup && (
        <div className="music-message space-y-2">
          <button
            className="workbench-button"
            onClick={() => void window.ipcRenderer.showMusicExtension()}
          >
            확장 폴더 열기
          </button>
          <p>
            Chrome 확장 프로그램 관리에서 개발자 모드 → 압축해제된 확장 프로그램 로드로 이 폴더를
            선택합니다.
          </p>
          <p>
            Chrome에 ProPre 음악 연결 확장을 설치하고, 확장 팝업의 ID를 입력하세요. 설정 후 유튜브
            뮤직 탭에서 연결합니다.
          </p>
          <label className="block">
            확장 ID
            <input
              className="workbench-field w-full"
              value={extensionId}
              onChange={(e) => setExtensionId(e.target.value)}
              maxLength={32}
            />
          </label>
          <button
            className="workbench-button"
            onClick={() =>
              void window.ipcRenderer.musicBridge('setup', { extensionId }).then(
                () => setError('연결 프로그램 설정 완료. Chrome 확장에서 이 탭 연결을 누르세요.'),
                (e) => setError(e.message),
              )
            }
          >
            연결 프로그램 설정
          </button>
          <button
            className="workbench-button"
            onClick={() =>
              void window.ipcRenderer.musicBridge('status').then((bridge) => setMusicBridge(bridge))
            }
          >
            연결 확인
          </button>
          <span>
            {music.bridge.connected && !music.bridge.stale ? '연결됨' : '연결 확인 필요'}
            {music.bridge.connected && !music.bridge.stale && (
              <button
                className="workbench-button"
                onClick={() =>
                  void window.ipcRenderer.musicBridge('disconnect').then(
                    (bridge) => setMusicBridge(bridge),
                    (e) => setError(e.message),
                  )
                }
              >
                브라우저 연결 해제
              </button>
            )}
          </span>
        </div>
      )}
      {form && (
        <form
          aria-label="음악 설정"
          className="music-message space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void (async () => {
              try {
                setError('')
                const parsed = MusicItemSchema.parse({ ...form, revision: form.revision + 1 })
                await persist(
                  items.some((x) => x.id === form.id)
                    ? items.map((x) => (x.id === form.id ? parsed : x))
                    : [...items, parsed],
                )
                setForm(null)
              } catch {
                setError('이름·주소·시작/끝 구간과 저장 상태를 확인해주세요. 입력은 유지했습니다.')
              }
            })()
          }}
        >
          <label className="block">
            등록 이름
            <input
              aria-label="음악 이름"
              className="workbench-field w-full"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              maxLength={200}
            />
          </label>
          {local ? (
            <>
              <label className="block">
                시작 시간(초)
                <input
                  className="workbench-field w-full"
                  type="number"
                  min="0"
                  step=".1"
                  value={local.startSeconds}
                  onChange={(e) => updateLocal({ startSeconds: Number(e.target.value) })}
                />
              </label>
              <label className="block">
                끝 시간(초, 비우면 곡 끝)
                <input
                  className="workbench-field w-full"
                  type="number"
                  min="0.1"
                  step=".1"
                  value={local.endSeconds ?? ''}
                  onChange={(e) =>
                    updateLocal({ endSeconds: e.target.value ? Number(e.target.value) : undefined })
                  }
                />
              </label>
              <label className="block">
                기본 음량 {Math.round(local.volume * 100)}%
                <input
                  aria-label="음악 기본 음량"
                  type="range"
                  min="0"
                  max="1"
                  step=".05"
                  value={local.volume}
                  onChange={(e) => updateLocal({ volume: Number(e.target.value) })}
                />
              </label>
              <label className="block">
                <input
                  type="checkbox"
                  checked={local.loop}
                  onChange={(e) => updateLocal({ loop: e.target.checked })}
                />{' '}
                지정 구간 반복
              </label>
              <label className="block">
                줄여 멈춤(초)
                <input
                  className="workbench-field w-full"
                  type="number"
                  min="0"
                  max="10"
                  step=".5"
                  value={local.fadeSeconds}
                  onChange={(e) => updateLocal({ fadeSeconds: Number(e.target.value) })}
                />
              </label>
              <button
                type="button"
                className="workbench-button"
                onClick={() =>
                  void files().then(
                    (url) => url && updateLocal({ url }),
                    (e) => setError(e.message),
                  )
                }
              >
                파일 다시 연결
              </button>
            </>
          ) : (
            <>
              <label className="block">
                유튜브 뮤직 주소
                <input
                  className="workbench-field w-full"
                  type="url"
                  required
                  value={form.source.kind === 'youtube-music' ? form.source.url : ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      source: { ...form.source, url: e.target.value } as MusicItem['source'],
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="workbench-button"
                onClick={() =>
                  void files().then(
                    (url) => {
                      if (url && form.source.kind === 'youtube-music')
                        setForm({
                          ...form,
                          source: { ...form.source, fallback: LocalMusicSchema.parse({ url }) },
                        })
                    },
                    (e) => setError(e.message),
                  )
                }
              >
                {form.source.kind === 'youtube-music' && form.source.fallback
                  ? '대체 음원 변경'
                  : '로컬 대체 음원 연결'}
              </button>
              <p>
                {form.source.kind === 'youtube-music' && form.source.fallback
                  ? '로컬 대체 음원 연결됨'
                  : '대체 음원 없음'}
              </p>
            </>
          )}
          <p>저장한 설정은 다음 재생부터 적용됩니다. 등록·저장만으로 소리가 나지 않습니다.</p>
          <div className="music-row">
            <button className="workbench-button workbench-button-primary" disabled={saving}>
              음악 저장
            </button>
            <button type="button" className="workbench-button" onClick={() => setForm(null)}>
              취소
            </button>
          </div>
        </form>
      )}
      {undoItems && (
        <button
          className="workbench-button"
          disabled={saving}
          onClick={() =>
            void persist(
              items.some((x) => x.id === undoItems.item.id)
                ? items
                : [
                    ...items.slice(0, undoItems.index),
                    undoItems.item,
                    ...items.slice(undoItems.index),
                  ],
            ).then(
              () => setUndoItems(null),
              (e) => setError(e.message),
            )
          }
        >
          음악 삭제 되돌리기
        </button>
      )}
      <div className="music-list">
        {items.map((item, index) => (
          <div key={item.id} className="music-list-item">
            <button
              className="w-full text-left"
              aria-label={`${item.title} 음악 준비`}
              disabled={!!form && form.id === item.id}
              aria-pressed={music.prepared?.item.id === item.id}
              onClick={() => prepare(item)}
            >
              <span className="block truncate">{item.title}</span>
              <span className="text-xs text-gray-500">
                {item.source.kind === 'local'
                  ? '로컬 파일'
                  : '유튜브 뮤직 · 브라우저 대상 확인 필요'}
                {music.prepared?.item.id === item.id ? ' · 다음 준비' : ''}
              </span>
            </button>
            <div className="music-controls">
              <button
                className="workbench-button"
                aria-label={`${item.title} 음악 설정`}
                disabled={!!form && form.id !== item.id}
                onClick={() => setForm(structuredClone(item))}
              >
                설정
              </button>
              {item.source.kind === 'youtube-music' && (
                <button
                  className="workbench-button"
                  onClick={() =>
                    void window.ipcRenderer
                      .openMusicURL(
                        musicURL(item.source.kind === 'youtube-music' ? item.source.url : ''),
                      )
                      .catch((e) => setError(e.message))
                  }
                >
                  브라우저에서 준비
                </button>
              )}
              <button
                className="workbench-button"
                disabled={index === 0 || saving}
                aria-label={`${item.title} 위로 이동`}
                onClick={() => {
                  const next = [...items]
                  ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                  void persist(next).catch((e) => setError(e.message))
                }}
              >
                위로
              </button>
              <button
                className="workbench-button"
                disabled={saving}
                aria-label={`${item.title} 음악 삭제`}
                onClick={() =>
                  void persist(items.filter((x) => x.id !== item.id)).then(
                    () => {
                      setUndoItems({ item: structuredClone(item), index })
                      if (music.prepared?.item.id === item.id)
                        if (useMusicState.getState().prepared?.setlistId !== id)
                          useMusicState.setState({ prepared: null })
                    },
                    (e) => setError(e.message),
                  )
                }
              >
                삭제
              </button>
            </div>
          </div>
        ))}
      </div>
      {music.activeExternal?.source.kind === 'youtube-music' &&
        music.activeExternal.source.fallback &&
        !music.bridge.stale && (
          <button
            className="workbench-button mt-2"
            disabled={music.busy}
            onClick={() => void playPrepared(true)}
          >
            로컬 대체 음원으로 전환
          </button>
        )}
    </section>
  )
}
