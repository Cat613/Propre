import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react'
import {
  Music2,
  Play,
  Pause,
  Square,
  Plus,
  MoreHorizontal,
  Volume2,
  Link2,
  FileAudio,
  Check,
  LoaderCircle,
  Headphones,
} from 'lucide-react'
import { usePresentationStore } from '../store'
import { useMusicState, setMusicBridge } from '../music/state'
import { playPrepared, playMusic, prepareMusic, stopMusic, toggleMusic } from '../music/actions'
import {
  LocalMusicSchema,
  MusicItemSchema,
  musicURL,
  musicTargetMatches,
  type MusicItem,
  type LocalMusic,
} from '../../shared/music'
import { mediaKind } from '../../shared/model'
function closeMenuOnEscape(event: KeyboardEvent<HTMLDetailsElement>) {
  if (event.key !== 'Escape') return
  event.currentTarget.removeAttribute('open')
  event.currentTarget.querySelector('summary')?.focus()
  event.stopPropagation()
}
function closeMenuOnAction(event: MouseEvent<HTMLDetailsElement>) {
  if ((event.target as Element).closest('button')) event.currentTarget.removeAttribute('open')
}
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
    [openingId, setOpeningId] = useState<string | null>(null),
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
  async function prepareInChrome(item: MusicItem) {
    if (item.source.kind !== 'youtube-music' || !id || openingId) return
    setError('')
    setOpeningId(item.id)
    const previousBinding = useMusicState.getState().bridge.bindingId
    try {
      await prepareMusic(item, id)
      const prepared = useMusicState.getState().prepared
      if (
        prepared?.setlistId !== id ||
        prepared.item.id !== item.id ||
        prepared.item.revision !== item.revision
      )
        throw new Error('음악 설정이 바뀌었습니다. 다시 준비해주세요.')
      useMusicState.setState({
        message: 'Chrome에서 음악 탭을 열고 연결하는 중입니다. 아직 재생하지 않습니다.',
      })
      const bridge = await window.ipcRenderer.prepareMusicURL(musicURL(item.source.url))
      setMusicBridge(bridge)
      if (bridge.bindingId !== previousBinding)
        useMusicState.setState({
          activeExternal: null,
          ...(!usePresentationStore.getState().activeAudio ? { phase: 'stopped' as const } : {}),
        })
      if (
        usePresentationStore.getState().activeSetlistId === id &&
        useMusicState.getState().prepared?.item.id === item.id
      )
        useMusicState.setState({
          message: 'Chrome 탭 연결됨 · 앱에서 재생을 누르면 음악이 시작됩니다.',
        })
    } catch (error) {
      useMusicState.setState({
        message:
          error instanceof Error
            ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
            : 'Chrome 자동 연결을 확인해주세요.',
      })
    } finally {
      setOpeningId(null)
    }
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
      musicTargetMatches(targetURL.href, music.bridge))
  const playing = audio
    ? !!audio.playing && music.phase === 'playing'
    : music.bridge.playing === true
  const activeId = audio?.musicItemId || music.activeExternal?.id
  const hasCurrent = !!audio || !!music.activeExternal || music.bridge.playing === true
  const currentTitle =
    audio?.name || music.bridge.title || music.activeExternal?.title || '음악을 선택해 주세요'
  const sourceTitle = audio
    ? '로컬 파일'
    : music.activeExternal
      ? music.activeExternal.title
      : 'YouTube Music'
  const status = music.busy
    ? '준비 중'
    : music.bridge.stale && music.activeExternal
      ? '연결 확인 필요'
      : music.phase === 'error'
        ? '재생 오류'
        : playing
          ? '재생 중'
          : hasCurrent
            ? music.phase === 'stopped'
              ? '중지됨'
              : '일시정지'
            : '대기'
  function addYouTube() {
    setForm({
      id: crypto.randomUUID(),
      revision: 0,
      title: '',
      source: { kind: 'youtube-music', url: '' },
    })
  }
  return (
    <section className="music-panel" aria-label="예배 음악">
      <header className="music-heading-row">
        <div className="music-heading">
          <Headphones size={16} aria-hidden="true" />
          <h2>음악</h2>
        </div>
        <button
          className="music-connection"
          data-connected={music.bridge.connected && !music.bridge.stale}
          onClick={() => setSetup(!setup)}
          aria-expanded={setup}
          aria-label="브라우저 연결 설정"
        >
          <span className="music-connection-dot" />
          {music.bridge.connected && !music.bridge.stale ? 'Chrome 연결됨' : '연결 설정'}
        </button>
      </header>
      <section className="music-player" data-playing={playing} aria-label="현재 음악">
        <div className="music-player-heading">
          <span>현재 음악</span>
          <span className="music-state" data-playing={playing} role="status">
            {status}
          </span>
        </div>
        <div className="music-player-track">
          <div className="music-artwork" aria-hidden="true">
            {music.busy ? (
              <LoaderCircle size={23} className="animate-spin" />
            ) : (
              <Music2 size={24} strokeWidth={1.7} />
            )}
          </div>
          <div className="music-player-copy">
            <h3 title={hasCurrent ? currentTitle : undefined}>
              {hasCurrent
                ? currentTitle
                : music.busy
                  ? '음악을 연결하고 있어요'
                  : '음악을 선택해 주세요'}
            </h3>
            <p title={hasCurrent ? sourceTitle : undefined}>
              {hasCurrent ? sourceTitle : '아래 목록에서 재생 버튼을 눌러주세요'}
            </p>
          </div>
        </div>
        {hasCurrent && (
          <>
            {audio && (
              <div className="music-progress">
                <progress
                  max={music.duration || 1}
                  value={music.position}
                  aria-label="음악 재생 진행"
                />
                <div>
                  <span>{clock(music.position)}</span>
                  <span>{clock(music.duration)}</span>
                </div>
              </div>
            )}
            <div className="music-player-controls">
              <button
                className="music-main-control"
                disabled={music.busy || (!!music.activeExternal && music.bridge.stale)}
                onClick={() => void toggleMusic()}
              >
                {playing ? (
                  <Pause size={16} fill="currentColor" aria-hidden="true" />
                ) : (
                  <Play size={16} fill="currentColor" aria-hidden="true" />
                )}
                {playing ? '일시정지' : '이어 재생'}
              </button>
              <button
                className="music-stop-control"
                aria-label="음악 중지"
                title="음악 중지"
                onClick={stopMusic}
              >
                <Square size={15} aria-hidden="true" />
                <span>중지</span>
              </button>
            </div>
            {audio ? (
              <label className="music-volume">
                <Volume2 size={14} aria-hidden="true" />
                <span className="sr-only">현재 음량</span>
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
                <span>{Math.round((audio.volume ?? 0.5) * 100)}%</span>
              </label>
            ) : (
              <details className="music-playback-details">
                <summary>재생 정보</summary>
                <p className="music-message">{currentTitle}</p>
                <p className="music-message">음량은 YouTube Music에서 조절할 수 있습니다.</p>
              </details>
            )}
            {audio && (
              <details className="music-playback-details">
                <summary>재생 설정</summary>
                <div className="music-controls">
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
                    onClick={() =>
                      useMusicState.setState((s) => ({ fadeRequest: s.fadeRequest + 1 }))
                    }
                  >
                    {audio.fadeSeconds ?? 3}초간 줄여 멈춤
                  </button>
                </div>
                {audio.ownerSetlistId && audio.ownerSetlistId !== id && (
                  <p className="music-message">다른 예배의 음악을 재생하고 있습니다.</p>
                )}
              </details>
            )}
          </>
        )}
        {music.busy && !hasCurrent && (
          <button className="music-cancel-control" onClick={stopMusic}>
            재생 취소
          </button>
        )}
      </section>
      {error && (
        <p role="alert" className="music-notice" data-tone="error">
          {error}
        </p>
      )}
      {music.message &&
        !['음악 선택됨 · 재생을 누르면 시작합니다.', '파일 확인됨 · 아직 재생하지 않음'].includes(
          music.message,
        ) && (
          <p
            role="status"
            className="music-notice"
            data-tone={music.phase === 'error' ? 'error' : 'info'}
          >
            {music.message}
          </p>
        )}
      {music.bridge.stale && (
        <div className="music-message rounded border border-amber-500/30 p-2">
          <p>음악이 계속 나올 수 있습니다. 브라우저에서 먼저 멈춰주세요.</p>
          <button
            className="workbench-button"
            onClick={() => {
              const source = music.activeExternal?.source
              if (source?.kind === 'youtube-music')
                void window.ipcRenderer.openMusicURL(source.url).catch((e) => setError(e.message))
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
      {music.prepared &&
        music.activeExternal?.id !== music.prepared.item.id &&
        audio?.musicItemId !== music.prepared.item.id && (
          <div className="music-next">
            <p>다음 준비: {music.prepared.item.title}</p>
            <button
              className="workbench-button workbench-button-primary"
              disabled={music.busy || !!openingId}
              onClick={() => {
                setError('')
                void playPrepared()
              }}
            >
              {music.busy
                ? '재생 확인 중…'
                : audio || music.activeExternal
                  ? '전환해 재생'
                  : '준비한 음악 재생'}
            </button>
            {!targetReady && (
              <p className="music-next-hint" role="status">
                재생을 누르면 Chrome 연결과 곡 준비를 자동으로 처리합니다.
              </p>
            )}
          </div>
        )}
      <div className="music-library-heading">
        <div>
          <h3>
            음악 목록 <span>{items.length}</span>
          </h3>
          <p title={list?.title}>{list?.title || '예배 선택 필요'}</p>
        </div>
        <details
          className="music-add-menu"
          onKeyDown={closeMenuOnEscape}
          onClickCapture={closeMenuOnAction}
        >
          <summary className="workbench-button" aria-label="음악 추가">
            <Plus size={14} aria-hidden="true" />
            추가
          </summary>
          <div className="music-menu-items">
            <button
              aria-label="오디오 선택"
              disabled={!list || saving || !!form}
              onClick={(e) => {
                e.currentTarget.closest('details')?.removeAttribute('open')
                void addLocal()
              }}
            >
              <FileAudio size={14} aria-hidden="true" />
              파일 음악 추가
            </button>
            <button
              disabled={!list || saving || !!form}
              onClick={(e) => {
                e.currentTarget.closest('details')?.removeAttribute('open')
                addYouTube()
              }}
            >
              <Link2 size={14} aria-hidden="true" />
              유튜브 뮤직 링크
            </button>
          </div>
        </details>
      </div>
      {!list && <p className="music-message">콘티 보관함에서 예배를 먼저 만들거나 열어주세요.</p>}
      {setup && (
        <div className="music-setup music-message space-y-2">
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
            Chrome에 ProPre 음악 연결 확장을 설치하고, 확장 팝업의 ID를 입력하세요. 설정 후에는 음악
            카드의 ‘재생’을 누르면 연결부터 재생까지 자동으로 진행됩니다. 직접 연 탭은 확장에서
            수동으로 연결할 수도 있습니다.
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
                () => {
                  setError('')
                  useMusicState.setState({
                    message: '연결 설정 완료. 목록에서 재생을 누르면 자동으로 연결됩니다.',
                  })
                },
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
          className="music-form music-message space-y-2"
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
              autoFocus
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
      {items.length === 0 && (
        <div className="music-library-empty">
          <Music2 size={25} strokeWidth={1.5} aria-hidden="true" />
          <p>예배에 사용할 음악을 담아보세요</p>
          <span>음악 파일이나 YouTube Music 링크를 추가할 수 있어요.</span>
        </div>
      )}
      <div className="music-list" aria-label="음악 목록">
        {items.map((item, index) => (
          <div key={item.id} className="music-list-item" data-active={activeId === item.id}>
            <div className="music-item-icon" aria-hidden="true">
              {item.source.kind === 'local' ? <FileAudio size={17} /> : <Music2 size={17} />}
            </div>
            <button
              className="music-item-copy"
              aria-label={`${item.title} 음악 준비`}
              disabled={!!form && form.id === item.id}
              aria-pressed={music.prepared?.item.id === item.id}
              onClick={() => prepare(item)}
            >
              <span className="music-item-title" title={item.title}>
                {item.title}
              </span>
              <span className="music-item-meta">
                {item.source.kind === 'local'
                  ? '로컬 파일'
                  : new URL(item.source.url).pathname === '/playlist'
                    ? 'YouTube Music · 목록'
                    : 'YouTube Music · 곡'}
                {activeId === item.id ? (
                  <span className="music-item-state">
                    {playing ? '재생 중' : music.phase === 'stopped' ? '중지됨' : '일시정지'}
                  </span>
                ) : music.prepared?.item.id === item.id ? (
                  <Check size={11} aria-label="선택됨" />
                ) : null}
              </span>
            </button>
            <div className="music-item-actions">
              <button
                className="music-item-play"
                aria-label={`${item.title} ${activeId === item.id && playing ? '일시정지' : '재생'}`}
                title={activeId === item.id && playing ? '일시정지' : '재생'}
                disabled={music.busy || !!openingId || !!form}
                onClick={() => {
                  setError('')
                  if (
                    activeId === item.id &&
                    !music.bridge.stale &&
                    (item.source.kind === 'local' ||
                      musicTargetMatches(item.source.url, music.bridge))
                  )
                    void toggleMusic()
                  else void playMusic(item, id!)
                }}
              >
                {music.busy && music.prepared?.item.id === item.id ? (
                  <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
                ) : activeId === item.id && playing ? (
                  <Pause size={14} fill="currentColor" aria-hidden="true" />
                ) : (
                  <Play size={14} fill="currentColor" aria-hidden="true" />
                )}
              </button>
              <details
                className="music-item-menu"
                onKeyDown={closeMenuOnEscape}
                onClickCapture={closeMenuOnAction}
              >
                <summary className="music-more-control" aria-label={`${item.title} 더 보기`}>
                  <MoreHorizontal size={17} aria-hidden="true" />
                </summary>
                <div className="music-menu-items">
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
                      disabled={!!openingId || music.busy}
                      onClick={() => void prepareInChrome(item)}
                    >
                      {openingId === item.id ? '연결 중…' : '재생 없이 연결'}
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
              </details>
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
