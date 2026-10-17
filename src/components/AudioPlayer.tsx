import { useEffect, useRef } from 'react'
import { usePresentationStore } from '../store'
import { useMusicState, setMusicBridge } from '../music/state'
import { stopMusic, toggleMusic } from '../music/actions'

/** Always mounted in Control. Inspector tabs only render controls, never another audio element. */
export default function AudioPlayer() {
  const audio = usePresentationStore((s) => s.activeAudio)
  const prepared = useMusicState((s) => s.prepared),
    external = useMusicState((s) => s.activeExternal),
    undoPin = useMusicState((s) => s.undoPin)
  useEffect(() => {
    const urls = [
      audio?.url,
      undoPin?.source.kind === 'local' ? undoPin.source.local.url : undoPin?.source.fallback?.url,
      prepared?.item.source.kind === 'local'
        ? prepared.item.source.local.url
        : prepared?.item.source.fallback?.url,
      external?.source.kind === 'youtube-music' ? external.source.fallback?.url : undefined,
    ].filter((url): url is string => !!url)
    void window.ipcRenderer.pinMusic(urls).catch(() => {})
  }, [audio?.url, prepared, external, undoPin])
  return audio ? (
    <LocalEngine key={audio.id} />
  ) : (
    <>
      <BridgeObserver />
      <audio data-music-idle />
    </>
  )
}
function BridgeObserver() {
  const visible = usePresentationStore(
    (s) => s.screenLooks[s.isGreenScreen ? 'chroma' : 'main'].audio.isVisible,
  )
  useEffect(() => {
    if (!visible) {
      useMusicState.setState((s) => ({ request: s.request + 1 }))
      void window.ipcRenderer
        .musicBridge('pause')
        .catch(() => useMusicState.setState({ message: '외부 음악 중단을 확인해주세요.' }))
    }
  }, [visible])
  useEffect(() => {
    const apply = (bridge: import('../../shared/music').MusicBridgeState) => {
      if (!setMusicBridge(bridge)) return
      if (
        bridge.playing &&
        (usePresentationStore.getState().activeAudio?.playing ||
          !usePresentationStore.getState().screenLooks[
            usePresentationStore.getState().isGreenScreen ? 'chroma' : 'main'
          ].audio.isVisible)
      )
        void window.ipcRenderer.musicBridge('pause').catch(() =>
          useMusicState.setState({
            message: '브라우저에서도 음악이 재생 중일 수 있습니다. 확인해주세요.',
          }),
        )
    }
    void window.ipcRenderer
      .musicBridge('status')
      .then(apply)
      .catch(() => {})
    return window.ipcRenderer.on('music-bridge-state', apply)
  }, [])
  return null
}
function LocalEngine() {
  const audio = usePresentationStore((s) => s.activeAudio),
    green = usePresentationStore((s) => s.isGreenScreen),
    looks = usePresentationStore((s) => s.screenLooks)
  const restart = useMusicState((s) => s.restartRequest),
    fadeRequest = useMusicState((s) => s.fadeRequest)
  const ref = useRef<HTMLAudioElement>(null),
    gain = useRef(1),
    fadeTimer = useRef<ReturnType<typeof setInterval>>(),
    initialized = useRef(false),
    lastFade = useRef(fadeRequest)
  const audible = looks[green ? 'chroma' : 'main'].audio.isVisible
  useEffect(
    () => () => {
      clearInterval(fadeTimer.current)
    },
    [],
  )
  useEffect(() => {
    const el = ref.current
    if (!el || !audio) return
    if (!audio.playing || !audible) {
      el.pause()
      if (useMusicState.getState().phase !== 'error') useMusicState.setState({ phase: 'paused' })
      if (!audible && audio.playing) usePresentationStore.getState().pauseAudio()
      return
    }
    el.volume = (audio.volume ?? 0.5) * gain.current
    useMusicState.setState({ phase: 'starting' })
    let canceled = false
    void el
      .play()
      .then(() => {
        if (
          !usePresentationStore.getState().activeAudio?.playing ||
          usePresentationStore.getState().activeAudio?.id !== audio.id
        )
          el.pause()
        else if (!canceled) useMusicState.setState({ phase: 'playing' })
      })
      .catch(() => {
        if (!canceled) {
          usePresentationStore.getState().pauseAudio()
          useMusicState.setState({
            phase: 'error',
            message: '파일을 재생하지 못했습니다. 파일 형식과 구간을 확인해주세요.',
          })
        }
      })
    return () => {
      canceled = true
      el.pause()
    }
  }, [audio?.id, audio?.playing, audible])
  useEffect(() => {
    if (ref.current) ref.current.volume = (audio?.volume ?? 0.5) * gain.current
  }, [audio?.volume])
  useEffect(() => {
    const el = ref.current
    if (el && initialized.current) el.currentTime = audio?.startSeconds ?? 0
  }, [restart, audio?.startSeconds])
  useEffect(() => {
    if (fadeRequest === lastFade.current) return
    lastFade.current = fadeRequest
    const el = ref.current
    if (!el || !audio?.playing) return
    clearInterval(fadeTimer.current)
    const start = performance.now(),
      duration = (audio.fadeSeconds ?? 3) * 1000
    fadeTimer.current = setInterval(() => {
      gain.current = duration === 0 ? 0 : Math.max(0, 1 - (performance.now() - start) / duration)
      el.volume = (usePresentationStore.getState().activeAudio?.volume ?? 0.5) * gain.current
      if (gain.current === 0) {
        clearInterval(fadeTimer.current)
        el.pause()
        gain.current = 1
        usePresentationStore.getState().pauseAudio()
      }
    }, 25)
    return () => {
      clearInterval(fadeTimer.current)
      gain.current = 1
    }
  }, [fadeRequest, audio?.id, audio?.playing])
  function update() {
    const el = ref.current
    if (!el || !audio) return
    const end = audio.endSeconds ?? el.duration
    if (Number.isFinite(end) && el.currentTime >= end) {
      if (audio.loop) {
        el.currentTime = audio.startSeconds ?? 0
        void el.play().catch(() => usePresentationStore.getState().pauseAudio())
      } else {
        el.pause()
        usePresentationStore.getState().pauseAudio()
      }
    }
    if (
      Math.abs(useMusicState.getState().position - el.currentTime) < 0.15 &&
      useMusicState.getState().duration === el.duration
    )
      return
    useMusicState.setState({
      position: el.currentTime,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
    })
  }
  useEffect(() => {
    const timer = setInterval(update, 50)
    return () => clearInterval(timer)
  })
  return (
    <>
      <BridgeObserver />
      <audio
        data-music-engine
        ref={ref}
        src={audio?.url}
        preload="metadata"
        onLoadedMetadata={() => {
          const el = ref.current
          if (!el || !audio) return
          if (
            !Number.isFinite(el.duration) ||
            (audio.startSeconds ?? 0) >= el.duration ||
            (audio.endSeconds ?? el.duration) > el.duration
          ) {
            usePresentationStore.getState().pauseAudio()
            useMusicState.setState({
              message: '곡 길이와 시작·끝 구간을 확인해주세요.',
              phase: 'error',
            })
            return
          }
          initialized.current = true
          el.currentTime = audio.startSeconds ?? 0
          useMusicState.setState({ duration: el.duration })
        }}
        onTimeUpdate={update}
        onEnded={() => {
          if (audio?.loop) {
            const el = ref.current
            if (el) {
              el.currentTime = audio.startSeconds ?? 0
              void el.play().catch(() => {})
            }
          } else usePresentationStore.getState().pauseAudio()
        }}
        onError={() => {
          usePresentationStore.getState().pauseAudio()
          useMusicState.setState({
            phase: 'error',
            message: '오디오 파일을 읽지 못했습니다. 파일을 다시 연결해주세요.',
          })
        }}
      />
    </>
  )
}
export function AudioStatus({ onOpen }: { onOpen: () => void }) {
  const audio = usePresentationStore((s) => s.activeAudio),
    show = usePresentationStore((s) => s.showAudioPlayer)
  const external = useMusicState((s) => s.activeExternal),
    bridge = useMusicState((s) => s.bridge),
    phase = useMusicState((s) => s.phase),
    busy = useMusicState((s) => s.busy)
  if (!audio && !external && !bridge.stale && !bridge.playing && !show) return null
  return (
    <div className="music-status" aria-label="음악 상태">
      <button className="workbench-button" onClick={onOpen}>
        {audio || external ? '음악' : '음악 열기'}
      </button>
      <span className="min-w-0 truncate">
        {external
          ? `${external.title} · ${bridge.stale ? '외부 상태 미확인' : bridge.playing ? '재생 중' : phase === 'starting' ? '재생 확인 중' : phase === 'error' ? '재생 오류' : '일시정지'}`
          : audio
            ? `${audio.name} · ${phase === 'playing' ? '재생 중' : phase === 'error' ? '재생 오류' : '일시정지'}`
            : bridge.playing
              ? '브라우저 음악 재생 중 · 대상 인수 필요'
              : '미디어에서 음악을 준비하세요'}
      </span>
      {(audio || external || bridge.stale || bridge.playing) && (
        <>
          <button
            className="workbench-button"
            onClick={() => void toggleMusic()}
            disabled={busy || bridge.stale || (!audio && !external && bridge.playing !== true)}
          >
            {audio?.playing || bridge.playing ? '일시정지' : '이어 재생'}
          </button>
          <button className="workbench-button workbench-button-danger" onClick={stopMusic}>
            음악 중지
          </button>
        </>
      )}
    </div>
  )
}
