import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { usePresentationStore as presentation } from '../src/store'
import { useMusicState as music, setMusicBridge } from '../src/music/state'
import { playPrepared } from '../src/music/actions'
import { LocalMusicSchema } from '../shared/music'
const initial = presentation.getState(),
  initialMusic = music.getState()
const ipc = {
  musicBridge: vi.fn(async () => ({
    connected: false,
    stale: false,
    playing: false,
    title: '',
    videoId: '',
    listId: '',
    bindingId: '',
  })),
  getExternalOutput: vi.fn(async () => ({ source: { kind: 'slides' }, generation: 0 })),
  stopExternalOutput: vi.fn(async () => {}),
}
beforeAll(() => vi.stubGlobal('window', { ipcRenderer: ipc }))
beforeEach(() => {
  presentation.setState(initial, true)
  music.setState(initialMusic, true)
  vi.clearAllMocks()
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
