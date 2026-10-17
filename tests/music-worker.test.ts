import { expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import vm from 'node:vm'
const requestId = 'a'.repeat(64)
async function adapter(approved = true) {
  let listener: (msg: any, sender: any, reply: (reply: any) => void) => unknown
  let native: (msg: any) => void
  const events: string[] = []
  const states = new Map(
    [1, 2].map((id) => [
      id,
      {
        bindingId: `document-${id}`,
        title: '',
        videoId: '',
        listId: '',
        pageListId: `PL${id}`,
        playing: false,
      },
    ]),
  )
  const postMessage = vi.fn((msg: any) => {
    if (msg.type === 'prepare-tab')
      queueMicrotask(() => native({ type: 'prepare-approved', requestId: msg.requestId, approved }))
  })
  const sendMessage = vi.fn(async (id: number, msg: any) => {
    events.push(`${msg.action}:${id}`)
    const state = states.get(id)!
    if (msg.action === 'pause') {
      state.playing = false
      return { state: { ...state } }
    }
    if (msg.action === 'release') return { ...state }
    return { ...state }
  })
  vm.runInNewContext(await fs.readFile('browser-extension/youtube-music/worker.js', 'utf8'), {
    URL,
    Map,
    Promise,
    setTimeout,
    clearTimeout,
    chrome: {
      tabs: {
        query: async () => [{ id: 1, url: 'https://music.youtube.com/playlist?list=PL1' }],
        sendMessage,
      },
      runtime: {
        id: 'extension',
        connectNative: () => {
          queueMicrotask(() => native({ type: 'ready', sessionId: 'session-a' }))
          return {
            postMessage,
            disconnect: vi.fn(),
            onDisconnect: { addListener: vi.fn() },
            onMessage: {
              addListener: (fn: typeof native) => {
                native = fn
              },
            },
          }
        },
        onMessage: {
          addListener: (fn: typeof listener) => {
            listener = fn
          },
        },
      },
    },
  })
  const request = (msg: any, sender: any) =>
    new Promise<any>((resolve) => {
      if (!listener(msg, sender, resolve)) resolve(undefined)
    })
  const auto = (id = 2, overrides = {}) =>
    request(
      { action: 'prepare-bind', requestId },
      {
        id: 'extension',
        frameId: 0,
        tab: { id },
        url: `https://music.youtube.com/playlist?list=PL${id}#propre-connect=${requestId}`,
        ...overrides,
      },
    )
  return { events, states, postMessage, sendMessage, request, auto }
}
it('auto-binds only the sender tab after native approval, without using the active tab or playing', async () => {
  const a = await adapter()
  expect(await a.auto()).toEqual({ ok: true })
  expect(a.events).toContain('bind:2')
  expect(a.events).not.toContain('bind:1')
  expect(a.events.some((x) => x.startsWith('play:'))).toBe(false)
  expect(a.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'prepare-tab', requestId }),
  )
})
it('refuses missing markers, foreign senders and unapproved preparation requests', async () => {
  const a = await adapter(false)
  expect(await a.auto(2, { url: 'https://music.youtube.com/playlist?list=PL2' })).toBeUndefined()
  expect(await a.auto(2, { id: 'other' })).toBeUndefined()
  expect(await a.auto()).toHaveProperty('error')
  expect(a.events).not.toContain('bind:2')
})
it('pauses and releases the old binding before automatically connecting the requested tab', async () => {
  const a = await adapter()
  expect(await a.request({ action: 'bind' }, { id: 'extension' })).toEqual({ ok: true })
  a.states.get(1)!.playing = true
  a.events.length = 0
  expect(await a.auto()).toEqual({ ok: true })
  expect(a.events.indexOf('pause:1')).toBeLessThan(a.events.indexOf('release:1'))
  expect(a.events.indexOf('release:1')).toBeLessThan(a.events.indexOf('bind:2'))
})
it('keeps the old binding when its pause cannot be confirmed', async () => {
  const a = await adapter()
  await a.request({ action: 'bind' }, { id: 'extension' })
  a.events.length = 0
  a.sendMessage.mockImplementationOnce(async () => ({ ...a.states.get(2)! })) // candidate inspect
  a.sendMessage.mockImplementationOnce(
    async () => ({ state: { ...a.states.get(1)!, playing: true } }) as any,
  )
  expect(await a.auto()).toHaveProperty('error')
  expect(a.events).not.toContain('bind:2')
})
