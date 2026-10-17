import { musicTargetMatches, type MusicItem } from '../../shared/music'
import { usePresentationStore } from '../store'
import { useMusicState, setMusicBridge } from './state'
export function stopMusic() {
  useMusicState.setState((s) => ({
    request: s.request + 1,
    busy: false,
    phase: 'stopped',
    position: 0,
  }))
  usePresentationStore.getState().clearLayer('audio')
  void window.ipcRenderer.musicBridge('pause').then(
    (bridge) => setMusicBridge(bridge),
    () =>
      useMusicState.setState({
        message: '로컬 음악은 중지했습니다. 외부 음악은 브라우저에서 확인해주세요.',
      }),
  )
}
export async function playPrepared(fallback = false, manuallyStopped = false) {
  const state = useMusicState.getState(),
    prepared = state.prepared
  const item = fallback ? state.activeExternal : prepared?.item
  if (!item) return
  const token = useMusicState.getState().request + 1
  useMusicState.setState({ request: token })
  useMusicState.setState({ busy: true, message: '' })
  try {
    const list = usePresentationStore.getState().setlists.find((x) => x.id === prepared?.setlistId)
    if (!fallback && !list?.music?.some((x) => x.id === item.id && x.revision === item.revision))
      throw new Error('음악 설정이 바뀌었습니다. 다시 준비해주세요.')
    if (item.source.kind === 'local' || fallback) {
      const local = item.source.kind === 'local' ? item.source.local : item.source.fallback
      if (!local) throw new Error('대체 음원을 먼저 연결해주세요.')
      if (manuallyStopped && !useMusicState.getState().bridge.stale)
        throw new Error('외부 연결 상태가 바뀌었습니다. 다시 확인해주세요.')
      // Explicit manual confirmation is only for the current unresolved binding.
      if (manuallyStopped) {
        const bridge = await window.ipcRenderer.musicBridge('confirm-stop', {
          bindingId: state.bridge.bindingId,
        })
        setMusicBridge(bridge)
      }
      const before = usePresentationStore.getState().activeAudio
      await usePresentationStore.getState().playAudio({
        id: crypto.randomUUID(),
        name: fallback ? `${item.title} · 대체 음원` : item.title,
        ...local,
        musicItemId: item.id,
        ownerSetlistId: prepared?.setlistId,
      })
      if (token !== useMusicState.getState().request) {
        usePresentationStore.getState().pauseAudio()
        return
      }
      const after = usePresentationStore.getState().activeAudio
      if (!after?.playing || after === before)
        throw new Error('기존 소리 중단을 확인하지 못했습니다. 브라우저에서 음악을 멈춰주세요.')
      useMusicState.setState({ activeExternal: null, phase: 'starting' })
    } else {
      let bridge = await window.ipcRenderer.musicBridge('status')
      if (token !== useMusicState.getState().request) return
      if (!bridge.connected || bridge.stale || !musicTargetMatches(item.source.url, bridge)) {
        useMusicState.setState({ message: 'Chrome에서 음악을 연결하는 중입니다…' })
        bridge = await window.ipcRenderer.prepareMusicURL(item.source.url)
        if (token !== useMusicState.getState().request) return
        setMusicBridge(bridge)
      }
      if (!bridge.connected || bridge.stale || !musicTargetMatches(item.source.url, bridge))
        throw new Error('음악을 연결하지 못했습니다. 다시 재생하거나 연결 도움말을 확인해주세요.')
      useMusicState.setState({ message: '음악을 불러오는 중입니다…' })
      await window.ipcRenderer.musicBridge('pause')
      if (token !== useMusicState.getState().request) return
      const external = await window.ipcRenderer.getExternalOutput()
      if (external.browser?.live && !external.browser.muted)
        await window.ipcRenderer.browserOutputCommand({
          action: 'mute',
          value: true,
          generation: external.generation,
        })
      usePresentationStore.getState().pauseAudio()
      // Allow the local element to apply pause before starting an external source.
      document.querySelector<HTMLAudioElement>('[data-music-engine]')?.pause()
      if (token !== useMusicState.getState().request) return
      usePresentationStore.setState({ activeAudio: null })
      useMusicState.setState({ activeExternal: structuredClone(item), phase: 'starting' })
      const result = await window.ipcRenderer.musicBridge('play', { url: item.source.url })
      if (token !== useMusicState.getState().request) {
        await window.ipcRenderer.musicBridge('pause')
        return
      }
      setMusicBridge(result, 'playing')
      useMusicState.setState({ message: '' })
    }
  } catch (e) {
    if (token !== useMusicState.getState().request) return
    useMusicState.setState({
      phase: 'error',
      message:
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
          : '음악을 재생하지 못했습니다.',
    })
  } finally {
    if (token === useMusicState.getState().request) useMusicState.setState({ busy: false })
  }
}
export async function toggleMusic() {
  if (useMusicState.getState().busy) return
  useMusicState.setState((s) => ({ request: s.request + 1, busy: false, message: '' }))
  const music = useMusicState.getState()
  if (
    music.activeExternal ||
    (!usePresentationStore.getState().activeAudio && music.bridge.playing)
  ) {
    try {
      if (music.bridge.playing) {
        const bridge = await window.ipcRenderer.musicBridge('pause')
        setMusicBridge(bridge, 'paused')
      } else {
        const source = music.activeExternal?.source
        if (source?.kind === 'youtube-music') {
          const bridge = await window.ipcRenderer.musicBridge('play', { url: source.url })
          setMusicBridge(bridge, 'playing')
        }
      }
    } catch (e) {
      useMusicState.setState({
        phase: 'error',
        message: e instanceof Error ? e.message : '브라우저 연결을 확인해주세요.',
      })
    }
  } else {
    const s = usePresentationStore.getState()
    if (s.activeAudio?.playing) s.pauseAudio()
    else await s.playAudio()
  }
}

export async function prepareMusic(item: MusicItem, setlistId: string) {
  const token = useMusicState.getState().preparationRequest + 1
  useMusicState.setState({ preparationRequest: token, message: '음악을 확인하는 중입니다.' })
  try {
    if (item.source.kind === 'local') {
      const local = item.source.local
      await window.ipcRenderer.pinMusic([
        local.url,
        ...[usePresentationStore.getState().activeAudio?.url].filter((x): x is string => !!x),
      ])
      const duration = await new Promise<number>((resolve, reject) => {
        const el = new Audio()
        el.preload = 'metadata'
        const finish = (error?: Error) => {
          clearTimeout(timer)
          el.removeAttribute('src')
          el.load()
          if (error) reject(error)
        }
        const timer = setTimeout(
          () => finish(new Error('파일 확인 시간이 초과되었습니다. 다시 준비해주세요.')),
          10000,
        )
        el.onloadedmetadata = () => {
          const duration = el.duration
          finish()
          resolve(duration)
        }
        el.onerror = () => finish(new Error('파일을 읽지 못했습니다. 다시 연결해주세요.'))
        el.src = local.url
      })
      if (
        !Number.isFinite(duration) ||
        local.startSeconds >= duration ||
        (local.endSeconds ?? duration) > duration
      )
        throw new Error('곡 길이와 시작·끝 구간을 확인해주세요.')
    }
    const current = usePresentationStore.getState()
    if (
      token !== useMusicState.getState().preparationRequest ||
      current.activeSetlistId !== setlistId
    )
      return
    const saved = current.setlists
      .find((x) => x.id === setlistId)
      ?.music?.find((x) => x.id === item.id)
    if (!saved || saved.revision !== item.revision)
      throw new Error('음악 설정이 바뀌었습니다. 다시 준비해주세요.')
    useMusicState.setState({
      prepared: { item: structuredClone(item), setlistId },
      message:
        item.source.kind === 'local'
          ? '파일 확인됨 · 아직 재생하지 않음'
          : '음악 선택됨 · 재생을 누르면 시작합니다.',
    })
    return true
  } catch (e) {
    if (token === useMusicState.getState().preparationRequest)
      useMusicState.setState({
        message: e instanceof Error ? e.message : '음악 준비에 실패했습니다.',
      })
  }
}

/** Explicit card play combines silent validation, target connection and playback. */
export async function playMusic(item: MusicItem, setlistId: string) {
  if (useMusicState.getState().busy) return
  const token = useMusicState.getState().request + 1
  useMusicState.setState({ request: token, busy: true, message: '' })
  try {
    const ready = await prepareMusic(item, setlistId)
    if (!ready || token !== useMusicState.getState().request) return
    await playPrepared()
  } finally {
    if (token === useMusicState.getState().request) useMusicState.setState({ busy: false })
  }
}
