import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import vm from 'node:vm'
afterEach(() => vi.useRealTimers())
async function adapter(
  options: {
    playlist?: boolean
    loaded?: boolean
    button?: boolean
    titleLink?: boolean
    marker?: string
  } = {},
) {
  const resolvers: (() => void)[] = []
  const sendMessage = vi.fn(async () => ({ ok: true }))
  const replaceState = vi.fn()
  const events = new Map<string, (event?: any) => void>()
  const video = {
    currentSrc: options.loaded === false ? '' : 'blob:test-song',
    readyState: options.loaded === false ? 0 : 4,
    paused: true,
    ended: false,
    pause() {
      this.paused = true
    },
    play() {
      return new Promise<void>((resolve) =>
        resolvers.push(() => {
          this.paused = false
          events.get('play')?.()
          resolve()
        }),
      )
    },
  }
  const button = { click: vi.fn(), getAttribute: () => 'false', getClientRects: () => [{}] }
  let listener: (message: unknown, sender: unknown, reply: (state: any) => void) => void
  vm.runInNewContext(await fs.readFile('browser-extension/youtube-music/content.js', 'utf8'), {
    crypto: { randomUUID: () => 'document-a' },
    URL,
    Date,
    setTimeout,
    history: { state: null, replaceState },
    location: {
      href:
        (options.playlist
          ? 'https://music.youtube.com/playlist?list=PLtest'
          : 'https://music.youtube.com/watch?v=track-a&list=PLtest') +
        (options.marker ? `#propre-connect=${options.marker}` : ''),
    },
    document: {
      addEventListener: (name: string, fn: (event?: any) => void) => events.set(name, fn),
      querySelector: (selector: string) => {
        if (selector === 'video') return video
        if (selector.includes('ytmusic-play-button-renderer')) return options.button ? button : null
        if (selector.includes('a[href')) {
          if (
            !video.currentSrc ||
            (selector.startsWith('ytmusic-player-bar') && options.titleLink === false)
          )
            return null
          return { href: 'https://music.youtube.com/watch?v=track-a&list=PLtest' }
        }
        return { textContent: '시험 곡' }
      },
    },
    chrome: {
      runtime: {
        sendMessage,
        onMessage: {
          addListener(fn: typeof listener) {
            listener = fn
          },
        },
      },
    },
  })
  const command = (action: string, generation: number, extra = {}) =>
    new Promise<any>((resolve) =>
      listener(
        {
          action,
          generation,
          bindingId: 'document-a',
          expiresAt: Date.now() + 2000,
          url: options.playlist
            ? 'https://music.youtube.com/playlist?list=PLtest'
            : 'https://music.youtube.com/watch?v=track-a&list=PLtest',
          ...extra,
        },
        {},
        resolve,
      ),
    )
  const load = () => {
    video.currentSrc = 'blob:album-song'
    video.readyState = 4
    video.paused = false
    events.get('play')?.()
  }
  return { video, resolvers, command, button, load, sendMessage, replaceState }
}
it('a late play never resumes after a newer pause or executes against another document', async () => {
  const a = await adapter()
  const first = a.command('play', 1)
  await a.command('pause', 2)
  a.resolvers[0]()
  expect((await first).error).toBe('stale')
  expect(a.video.paused).toBe(true)
  expect((await a.command('play', 3, { bindingId: 'other' })).error).toBe('stale')
  expect(a.resolvers).toHaveLength(1)
})
it('a late old play does not pause a newer explicitly requested play', async () => {
  const a = await adapter()
  const old = a.command('play', 1)
  await a.command('pause', 2)
  const latest = a.command('play', 3)
  a.resolvers[0]()
  await old
  expect(a.video.paused).toBe(false)
  a.resolvers[1]()
  expect((await latest).state.playing).toBe(true)
})
it('expired requests are refused before invoking the media element', async () => {
  const a = await adapter()
  expect((await a.command('play', 1, { expiresAt: Date.now() - 1 })).error).toBe('stale')
  expect(a.resolvers).toHaveLength(0)
})
it('an unloaded playlist starts only on explicit play, then confirms the loaded track', async () => {
  const a = await adapter({ playlist: true, loaded: false, button: true, titleLink: false })
  vi.useFakeTimers()
  expect(await a.command('inspect', 0)).toMatchObject({
    videoId: '',
    pageListId: 'PLtest',
    canStart: true,
    playing: false,
  })
  expect(a.button.click).not.toHaveBeenCalled()
  const starting = a.command('play', 1)
  expect(a.button.click).toHaveBeenCalledTimes(1)
  a.load()
  await vi.advanceTimersByTimeAsync(50)
  expect((await starting).state).toMatchObject({
    videoId: 'track-a',
    listId: 'PLtest',
    playing: true,
  })
  expect(a.resolvers).toHaveLength(0)
})
it('pause during album loading blocks a late site queue play', async () => {
  const a = await adapter({ playlist: true, loaded: false, button: true })
  vi.useFakeTimers()
  const starting = a.command('play', 1)
  await a.command('pause', 2)
  await vi.advanceTimersByTimeAsync(50)
  expect((await starting).error).toBe('stale')
  a.load()
  expect(a.video.paused).toBe(true)
})
it('timed out album initialization cannot start playing later', async () => {
  const a = await adapter({ playlist: true, loaded: false, button: true })
  vi.useFakeTimers()
  const starting = a.command('play', 1)
  await vi.advanceTimersByTimeAsync(2050)
  expect((await starting).error).toBe('stale')
  a.load()
  expect(a.video.paused).toBe(true)
})
it('refuses a different playlist and missing controls without clicking another target', async () => {
  const a = await adapter({ playlist: true, loaded: false, button: true })
  expect(
    (await a.command('play', 1, { url: 'https://music.youtube.com/playlist?list=other' })).error,
  ).toBe('start-unavailable')
  expect(a.button.click).not.toHaveBeenCalled()
  const b = await adapter({ playlist: true, loaded: false })
  expect((await b.command('play', 1)).error).toBe('start-unavailable')
})
it('uses the active row link when the player title is plain text', async () => {
  const a = await adapter({ playlist: true, titleLink: false })
  expect(await a.command('inspect', 0)).toMatchObject({ videoId: 'track-a', listId: 'PLtest' })
})

it('a marked preparation asks to connect automatically and blocks page autoplay without clicking play', async () => {
  const marker = 'a'.repeat(64)
  const a = await adapter({ playlist: true, loaded: false, button: true, marker })
  await Promise.resolve()
  expect(a.sendMessage).toHaveBeenCalledExactlyOnceWith({
    action: 'prepare-bind',
    requestId: marker,
  })
  expect(a.replaceState).toHaveBeenCalledWith(
    null,
    '',
    'https://music.youtube.com/playlist?list=PLtest',
  )
  expect(a.button.click).not.toHaveBeenCalled()
  a.load()
  expect(a.video.paused).toBe(true)
})
it('ordinary music pages never request automatic binding', async () => {
  const a = await adapter({ playlist: true })
  expect(a.sendMessage).not.toHaveBeenCalled()
})
