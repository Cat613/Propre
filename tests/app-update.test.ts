import { afterEach, expect, it, vi } from 'vitest'
import { AppUpdates, readUpdateManifest } from '../electron/services/app-update'
import { isNewerVersion } from '../shared/app-update'
const feed = 'https://github.com/Cat613/Propre/releases/latest/download/propre-update.json'
const dmg = 'https://github.com/Cat613/Propre/releases/download/v0.2.0/ProPre-arm64.dmg'
const manifest = { schemaVersion: 1, version: '0.2.0', downloads: { 'mac-arm64': dmg } }
function setup() {
  const fetch = vi.fn(async () => new Response(JSON.stringify(manifest))),
    open = vi.fn(async () => {}),
    notify = vi.fn()
  return {
    fetch,
    open,
    notify,
    updates: new AppUpdates('0.1.0', 'mac-arm64', feed, { fetch, open }, notify),
  }
}
afterEach(() => vi.useRealTimers())
it('keeps local builds without a feed offline', async () => {
  const fetch = vi.fn(),
    open = vi.fn()
  const updates = new AppUpdates('0.1.0', 'mac-arm64', undefined, { fetch, open }, vi.fn())
  updates.start()
  await updates.check()
  await updates.download()
  expect(updates.snapshot().status).toBe('disabled')
  expect(fetch).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
})
it('automatically checks but opens only the Main-owned HTTPS URL on an explicit request', async () => {
  const { updates, fetch, open } = setup()
  await updates.check()
  expect(updates.snapshot()).toMatchObject({ status: 'available', version: '0.2.0' })
  expect(open).not.toHaveBeenCalled()
  expect(fetch.mock.calls[0]).toMatchObject([feed, { credentials: 'omit', redirect: 'manual' }])
  await updates.download()
  expect(open).toHaveBeenCalledExactlyOnceWith(dmg)
  expect(updates.snapshot().status).toBe('download-opened') // Never claims the browser finished downloading.
  expect('install' in updates).toBe(false)
  expect('quitAndInstall' in updates).toBe(false)
})
it.each(['0.1.0', '0.0.9'])('does not offer same or older version %s', async (version) => {
  const { updates, fetch, open } = setup()
  fetch.mockResolvedValue(new Response(JSON.stringify({ ...manifest, version })))
  await updates.check()
  await updates.download()
  expect(updates.snapshot().status).toBe('idle')
  expect(open).not.toHaveBeenCalled()
})
it('compares versions numerically and rejects prereleases/malformed versions', () => {
  expect(isNewerVersion('0.10.0', '0.9.0')).toBe(true)
  expect(isNewerVersion('1.0.0-beta.1', '0.9.0')).toBe(false)
  expect(isNewerVersion('01.0.0', '0.9.0')).toBe(false)
})
it('does not offer the wrong CPU build', async () => {
  const { updates, fetch } = setup()
  fetch.mockResolvedValue(
    new Response(JSON.stringify({ ...manifest, downloads: { 'mac-x64': dmg } })),
  )
  await updates.check()
  expect(updates.snapshot()).toMatchObject({
    status: 'idle',
    message: expect.stringContaining('이 Mac'),
  })
})
it.each([
  'javascript:alert(1)',
  'file:///tmp/a.dmg',
  'http://github.com/a.dmg',
  'https://evil.invalid/a.dmg',
  'https://github.com/a.exe',
  'https://user:secret@github.com/a.dmg',
])('blocks unsafe external download %s', async (target) => {
  const { updates, fetch, open } = setup()
  fetch.mockResolvedValue(
    new Response(JSON.stringify({ ...manifest, downloads: { 'mac-arm64': target } })),
  )
  await updates.check()
  await updates.download()
  expect(updates.snapshot().status).toBe('error')
  expect(open).not.toHaveBeenCalled()
  expect(JSON.stringify(updates.snapshot())).not.toContain(target)
})
it('sanitizes network failures and permits retry', async () => {
  const { updates, fetch } = setup()
  fetch.mockRejectedValueOnce(new Error('https://secret.invalid?token=private'))
  await updates.check()
  expect(updates.snapshot().status).toBe('error')
  expect(JSON.stringify(updates.snapshot())).not.toContain('private')
  await updates.check()
  expect(updates.snapshot().status).toBe('available')
})
it('retries a failed browser opening without a new update check', async () => {
  const { updates, open } = setup()
  open.mockRejectedValueOnce(new Error('OS private details'))
  await updates.check()
  await updates.download()
  expect(updates.snapshot().status).toBe('available')
  expect(JSON.stringify(updates.snapshot())).not.toContain('private')
  await updates.download()
  expect(updates.snapshot().status).toBe('download-opened')
})
it('deduplicates checks and browser openings', async () => {
  const { updates, fetch, open } = setup()
  let resolve!: (value: Response) => void
  fetch.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  const pending = updates.check()
  await updates.check()
  expect(fetch).toHaveBeenCalledTimes(1)
  resolve(new Response(JSON.stringify(manifest)))
  await pending
  let finish!: () => void
  open.mockImplementationOnce(
    () =>
      new Promise((r) => {
        finish = r
      }),
  )
  const opening = updates.download()
  await updates.download()
  expect(open).toHaveBeenCalledTimes(1)
  finish()
  await opening
})
it('uses the four-hour timer and ignores a late response after disposal', async () => {
  vi.useFakeTimers()
  const { updates, fetch, notify } = setup()
  fetch.mockImplementation(async () => new Response(JSON.stringify(manifest)))
  updates.start()
  await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
  expect(fetch).toHaveBeenCalledTimes(2)
  updates.dispose()
  const count = notify.mock.calls.length
  await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(notify).toHaveBeenCalledTimes(count)
})
it('aborts a stalled check after 15 seconds', async () => {
  vi.useFakeTimers()
  const { updates, fetch } = setup()
  fetch.mockImplementationOnce(
    (...args: any[]) =>
      new Promise((_, reject) => {
        args[1].signal.addEventListener('abort', () => reject(new Error('timeout')))
      }),
  )
  const pending = updates.check()
  await vi.advanceTimersByTimeAsync(15000)
  await pending
  expect(updates.snapshot().status).toBe('error')
})
it('follows HTTPS release-asset redirects, rejects HTTP redirects and limits loops', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://release-assets.githubusercontent.com/data?signature=value' },
      }),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(manifest)))
  expect(await readUpdateManifest(fetch, feed, new AbortController().signal)).toEqual(manifest)
  fetch.mockResolvedValue(
    new Response(null, { status: 302, headers: { location: 'http://evil.invalid/data' } }),
  )
  await expect(readUpdateManifest(fetch, feed, new AbortController().signal)).rejects.toThrow()
  fetch.mockImplementation(
    async () => new Response(null, { status: 302, headers: { location: feed } }),
  )
  await expect(readUpdateManifest(fetch, feed, new AbortController().signal)).rejects.toThrow(
    '이동',
  )
})
it('rejects oversized streamed manifests and malformed JSON', async () => {
  const fetch = vi.fn(async () => new Response('x'.repeat(65537)))
  await expect(readUpdateManifest(fetch, feed, new AbortController().signal)).rejects.toThrow(
    '너무',
  )
  fetch.mockResolvedValueOnce(new Response('{broken'))
  await expect(readUpdateManifest(fetch, feed, new AbortController().signal)).rejects.toThrow()
})
it('does not notify or offer a URL from a response completing after disposal', async () => {
  const { updates, fetch, notify, open } = setup()
  let resolve!: (value: Response) => void
  fetch.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  const pending = updates.check()
  updates.dispose()
  const count = notify.mock.calls.length
  resolve(new Response(JSON.stringify(manifest)))
  await pending
  await updates.download()
  expect(notify).toHaveBeenCalledTimes(count)
  expect(open).not.toHaveBeenCalled()
})
