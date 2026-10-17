import { expect, it } from 'vitest'
import fs from 'node:fs/promises'
import vm from 'node:vm'
async function adapter() {
  const resolvers: (() => void)[] = []
  const video = {
    paused: true,
    ended: false,
    pause() {
      this.paused = true
    },
    play() {
      return new Promise<void>((resolve) =>
        resolvers.push(() => {
          this.paused = false
          resolve()
        }),
      )
    },
  }
  let listener: (message: unknown, sender: unknown, reply: (state: any) => void) => void
  vm.runInNewContext(await fs.readFile('browser-extension/youtube-music/content.js', 'utf8'), {
    crypto: { randomUUID: () => 'document-a' },
    URL,
    Date,
    location: { href: 'https://music.youtube.com/watch?v=track-a&list=PLtest' },
    document: {
      querySelector: (selector: string) =>
        selector === 'video'
          ? video
          : selector.includes('a[href')
            ? { href: 'https://music.youtube.com/watch?v=track-a&list=PLtest' }
            : { textContent: '시험 곡' },
    },
    chrome: {
      runtime: {
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
        { action, generation, bindingId: 'document-a', expiresAt: Date.now() + 2000, ...extra },
        {},
        resolve,
      ),
    )
  return { video, resolvers, command }
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
