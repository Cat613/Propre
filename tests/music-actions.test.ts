import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { usePresentationStore as presentation } from '../src/store'
import { useMusicState as music, setMusicBridge } from '../src/music/state'
import { playPrepared, playMusic, stopMusic } from '../src/music/actions'
import { LocalMusicSchema } from '../shared/music'
const initial = presentation.getState(),
  initialMusic = music.getState()
const ipc = {
  musicBridge: vi.fn(async (_action?: string, _args?: any) => ({
    connected: false,
    stale: false,
    playing: false,
    title: '',
    videoId: '',
    listId: '',
    bindingId: '',
  })),
  prepareMusicURL: vi.fn(async (_url: string): Promise<any> => {
    throw new Error('자동 연결에 실패했습니다.')
  }),
  getExternalOutput: vi.fn(async () => ({ source: { kind: 'slides' }, generation: 0 })),
  stopExternalOutput: vi.fn(async () => {}),
}
beforeAll(() => vi.stubGlobal('window', { ipcRenderer: ipc }))
beforeEach(() => {
  presentation.setState(initial, true)
  music.setState(initialMusic, true)
  vi.clearAllMocks()
  ipc.musicBridge
    .mockReset()
    .mockResolvedValue({
      connected: false,
      stale: false,
      playing: false,
      title: '',
      videoId: '',
      listId: '',
      bindingId: '',
    })
  ipc.prepareMusicURL.mockReset().mockRejectedValue(new Error('자동 연결에 실패했습니다.'))
  const now = new Date().toISOString()
  const item = {
    id: 'local',
    revision: 1,
    title: '다음 음악',
    source: {
      kind: 'local' as const,
      local: LocalMusicSchema.parse({ url: 'media://asset/audio/audio.wav' }),
    },
  }
  presentation.setState({
    activeSetlistId: 'service',
    setlists: [
      {
        id: 'service',
        revision: 1,
        title: '예배',
        createdAt: now,
        updatedAt: now,
        items: [],
        music: [item],
      },
    ],
    activeAudio: { id: 'old', url: 'media://asset/old/old.wav', name: '현재 음악', playing: true },
  })
  music.setState({ prepared: { item, setlistId: 'service' } })
})
afterAll(() => vi.unstubAllGlobals())
it('a full stop while previous-source pause is pending prevents the prepared source starting later', async () => {
  let resolve: ((v: any) => void) | undefined
  ipc.musicBridge.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  const running = playPrepared()
  await Promise.resolve()
  presentation.getState().clearAll()
  resolve!({ connected: false, stale: false, playing: false })
  await running
  expect(presentation.getState().activeAudio).toBeNull()
  expect(music.getState().busy).toBe(false)
})
it('a stale prepared revision is refused without mutating the active source', async () => {
  const saved = presentation.getState().setlists[0]
  presentation.setState({
    setlists: [{ ...saved, music: saved.music!.map((x) => ({ ...x, revision: 2 })) }],
  })
  await playPrepared()
  expect(presentation.getState().activeAudio?.id).toBe('old')
  expect(ipc.musicBridge).not.toHaveBeenCalled()
  expect(music.getState().message).toContain('다시 준비')
})

it('older bridge replies cannot replace a more recent playback observation', () => {
  const state = { ...music.getState().bridge, sequence: 5, playing: true }
  setMusicBridge(state)
  expect(setMusicBridge({ ...state, sequence: 4, playing: false })).toBe(false)
  expect(music.getState().bridge.playing).toBe(true)
  expect(setMusicBridge({ ...state, sequence: 6, playing: false })).toBe(true)
  expect(music.getState().bridge.playing).toBe(false)
})

it('an unloaded external album reports recovery before changing the active source', async () => {
  const item = {
    id: 'album',
    revision: 1,
    title: '앨범',
    source: {
      kind: 'youtube-music' as const,
      url: 'https://music.youtube.com/playlist?list=PLtest',
    },
  }
  presentation.setState({ setlists: [{ ...presentation.getState().setlists[0], music: [item] }] })
  music.setState({ prepared: { item, setlistId: 'service' } })
  ipc.musicBridge.mockResolvedValueOnce({
    connected: true,
    stale: false,
    playing: false,
    title: '',
    videoId: '',
    listId: 'PLtest',
    bindingId: 'document-a',
  })
  await playPrepared()
  expect(presentation.getState().activeAudio?.id).toBe('old')
  expect(music.getState().activeExternal).toBeNull()
  expect(music.getState().phase).toBe('error')
  expect(music.getState().message).toContain('자동 연결')
  expect(ipc.musicBridge).toHaveBeenCalledTimes(1)
  expect(music.getState().busy).toBe(false)
})

it('an unloaded but startable playlist is passed to the bridge and remains starting until observed', async () => {
  const item = {
    id: 'album',
    revision: 1,
    title: '앨범',
    source: {
      kind: 'youtube-music' as const,
      url: 'https://music.youtube.com/playlist?list=PLtest',
    },
  }
  presentation.setState({
    activeAudio: null,
    setlists: [{ ...presentation.getState().setlists[0], music: [item] }],
  })
  music.setState({ prepared: { item, setlistId: 'service' } })
  vi.stubGlobal('document', { querySelector: () => null })
  const observed = {
    connected: true,
    stale: false,
    playing: false,
    title: '',
    videoId: '',
    listId: '',
    bindingId: 'document-a',
    pageListId: 'PLtest',
    canStart: true,
  }
  let finish!: (state: any) => void
  ipc.musicBridge
    .mockResolvedValueOnce(observed)
    .mockResolvedValueOnce(observed)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
  const running = playPrepared()
  for (let i = 0; i < 10 && !finish; i++) await Promise.resolve()
  expect(ipc.musicBridge).toHaveBeenLastCalledWith('play', { url: item.source.url })
  expect(music.getState().phase).toBe('starting')
  expect(music.getState().busy).toBe(true)
  finish({ ...observed, playing: true, videoId: 'first-song', listId: 'PLtest' })
  await running
  expect(music.getState().phase).toBe('playing')
  expect(music.getState().busy).toBe(false)
})

function albumSetup() {
  const item = {
    id: 'album',
    revision: 1,
    title: '선택한 앨범',
    source: {
      kind: 'youtube-music' as const,
      url: 'https://music.youtube.com/playlist?list=PLnew',
    },
  }
  presentation.setState({
    activeAudio: null,
    setlists: [{ ...presentation.getState().setlists[0], music: [item] }],
  })
  vi.stubGlobal('document', { querySelector: () => null })
  const ready = {
    connected: true,
    stale: false,
    playing: false,
    title: '',
    videoId: '',
    listId: '',
    pageListId: 'PLnew',
    canStart: true,
    bindingId: 'new-document',
  }
  return { item, ready }
}
it('one card play repairs an old connected target and starts the requested album', async () => {
  const { item, ready } = albumSetup()
  ipc.musicBridge
    .mockResolvedValueOnce({
      ...ready,
      title: '예전 곡',
      videoId: 'old',
      listId: 'PLold',
      bindingId: 'old-document',
      pageListId: 'PLold',
      canStart: false,
    })
    .mockResolvedValueOnce(ready)
    .mockResolvedValueOnce({ ...ready, playing: true, videoId: 'first-song', listId: 'PLnew' })
  ipc.prepareMusicURL.mockResolvedValueOnce(ready)
  await playMusic(item, 'service')
  expect(ipc.prepareMusicURL).toHaveBeenCalledExactlyOnceWith(item.source.url)
  expect(ipc.musicBridge).toHaveBeenLastCalledWith('play', { url: item.source.url })
  expect(music.getState()).toMatchObject({
    busy: false,
    phase: 'playing',
    activeExternal: { id: item.id },
  })
})
it('stop during automatic connection cancels the queued first play', async () => {
  const { item, ready } = albumSetup()
  let finish!: (value: any) => void
  ipc.prepareMusicURL.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const playing = playMusic(item, 'service')
  for (let i = 0; i < 12 && !finish; i++) await Promise.resolve()
  expect(finish).toBeTypeOf('function')
  stopMusic()
  finish(ready)
  await playing
  expect(ipc.musicBridge.mock.calls.some(([action]) => action === 'play')).toBe(false)
  expect(music.getState()).toMatchObject({ busy: false, phase: 'stopped', activeExternal: null })
})
