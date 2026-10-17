import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Repository } from '../electron/services/repository'
import { ServiceSessions } from '../electron/services/service-session'
import type { WindowManager } from '../electron/services/windows'
import type { OutputSource } from '../electron/services/output-source'
let dir: string, repo: Repository, sessions: ServiceSessions
let version: number
let windows: {
  onEmergencyStop: (() => void) | undefined
  notify: ReturnType<typeof vi.fn>
  outputVersion: () => number
  live: () => null
  stageLive: () => null
}
let sources: {
  generation: number
  commitSlides: ReturnType<typeof vi.fn>
  prepare: ReturnType<typeof vi.fn>
  commit: ReturnType<typeof vi.fn>
  browser: { mute: ReturnType<typeof vi.fn> }
}
const active = () => repo.state.setlists[0]
const now = '2026-10-16T00:00:00.000Z'
const request = (cueId: string) => ({
  setlistId: active().id,
  cueId,
  expectedSetlistRevision: active().revision,
})
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-service-session-'))
  repo = new Repository(dir)
  await repo.open()
  await repo.saveDraft({
    id: 'song',
    title: '합성 찬양',
    createdAt: now,
    updatedAt: now,
    slides: [{ id: 'slide', type: 'text', content: '가사' }],
  })
  await repo.setPlaylist([{ id: 'row', presentationId: 'song' }])
  const plan = structuredClone(active().servicePlan!)
  plan.items.push({
    id: 'prayer',
    kind: 'prayer',
    title: '기도',
    enter: { visual: 'keep', audio: 'keep' },
  })
  await repo.saveServicePlan({
    requestId: randomUUID(),
    setlistId: active().id,
    expectedSetlistRevision: active().revision,
    plan,
  })
  version = 1
  windows = {
    onEmergencyStop: undefined,
    notify: vi.fn(),
    outputVersion: () => version,
    live: () => null,
    stageLive: () => null,
  }
  sources = {
    generation: 0,
    commitSlides: vi.fn(async () => {}),
    prepare: vi.fn(),
    commit: vi.fn(),
    browser: { mute: vi.fn() },
  }
  sessions = new ServiceSessions(
    repo,
    windows as unknown as WindowManager,
    sources as unknown as OutputSource,
  )
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})
it('keeps preparation read-only and advances exactly once for repeated commits', async () => {
  const prepared = await sessions.prepare(request('prayer'))
  expect(sessions.snapshot()).toBeNull()
  expect(sources.commitSlides).not.toHaveBeenCalled()
  const first = await sessions.commit(prepared.token)
  expect(first.currentCueId).toBe('prayer')
  expect(first.runs).toHaveLength(1)
  expect(await sessions.commit(prepared.token)).toEqual(first)
  expect(sessions.snapshot()?.runs).toHaveLength(1)
})
it('rejects stale output/plan tokens and protects the current cue from deletion', async () => {
  const first = await sessions.prepare(request('prayer'))
  version++
  await expect(sessions.commit(first.token)).rejects.toThrow('다시 준비')
  const second = await sessions.prepare(request('prayer'))
  await sessions.commit(second.token)
  const plan = structuredClone(active().servicePlan!)
  plan.items = plan.items.filter((cue) => cue.id !== 'prayer')
  await expect(
    repo.saveServicePlan({
      requestId: randomUUID(),
      setlistId: active().id,
      expectedSetlistRevision: active().revision,
      plan,
    }),
  ).rejects.toThrow('진행 중')
  await sessions.finish()
  await repo.saveServicePlan({
    requestId: randomUUID(),
    setlistId: active().id,
    expectedSetlistRevision: active().revision,
    plan,
  })
})
it('does not advance after a native output failure and restores prior checkpoint', async () => {
  await sessions.commit((await sessions.prepare(request('prayer'))).token)
  const before = sessions.snapshot()
  sources.commitSlides.mockRejectedValueOnce(new Error('output failure'))
  await expect(
    sessions.commit((await sessions.prepare(request(active().servicePlan!.items[0].id))).token),
  ).rejects.toThrow('output failure')
  expect(sessions.snapshot()).toEqual(before)
  expect(JSON.parse(await fs.readFile(path.join(dir, 'service-session-v1.json'), 'utf8'))).toEqual(
    before,
  )
})
it('writes a checkpoint before output, so disk failure does not change the visible frame', async () => {
  const prepared = await sessions.prepare(request(active().servicePlan!.items[0].id))
  vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk failure'))
  await expect(sessions.commit(prepared.token)).rejects.toThrow('disk failure')
  expect(sources.commitSlides).not.toHaveBeenCalled()
  expect(sessions.snapshot()).toBeNull()
})
it('F2 during a native output wait prevents a late commit or automatic replay', async () => {
  let release!: () => void
  sources.commitSlides.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  const promise = sessions.commit(
    (await sessions.prepare(request(active().servicePlan!.items[0].id))).token,
  )
  await vi.waitFor(() => expect(sources.commitSlides).toHaveBeenCalled())
  windows.onEmergencyStop?.()
  release()
  await expect(promise).rejects.toThrow('중지')
  expect(windows.notify.mock.calls.some(([channel]) => channel === 'service-cue-applied')).toBe(
    false,
  )
})
it('restores a running checkpoint as interrupted without starting output', async () => {
  await sessions.commit((await sessions.prepare(request('prayer'))).token)
  const reopened = new ServiceSessions(
    repo,
    windows as unknown as WindowManager,
    sources as unknown as OutputSource,
  )
  await reopened.open()
  expect(reopened.snapshot()?.status).toBe('interrupted')
  expect(reopened.active()).toBe(true)
  expect(sources.commitSlides).not.toHaveBeenCalled()
  await reopened.finish()
  expect(reopened.active()).toBe(false)
})
it('commits the bound slide background and stop-audio policy together', async () => {
  const p = repo.playlist()[0].presentation
  const filename = path.join(dir, 'synthetic.png')
  await fs.writeFile(filename, 'synthetic')
  const asset = await repo.register(filename)
  await repo.saveDraft({
    ...p,
    revision: 2,
    slides: [{ ...p.slides[0], backgroundUrl: repo.assetURL(asset) }],
  })
  const plan = structuredClone(active().servicePlan!)
  plan.items[0].enter.audio = 'stop'
  await repo.saveServicePlan({
    requestId: randomUUID(),
    setlistId: active().id,
    expectedSetlistRevision: active().revision,
    plan,
  })
  await sessions.commit((await sessions.prepare(request(plan.items[0].id))).token)
  expect(sources.commitSlides.mock.calls[0][0].layers).toMatchObject({
    background: { type: 'image', url: repo.assetURL(asset) },
    audio: null,
  })
})
