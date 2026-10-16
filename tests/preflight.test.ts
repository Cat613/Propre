import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { Repository } from '../electron/services/repository'
import { Preflight } from '../electron/services/preflight'
import type { WindowManager } from '../electron/services/windows'
import { preflightSummary, type PreflightRun } from '../shared/preflight'
let dir: string, repo: Repository, service: Preflight, notified: PreflightRun[]
const list = () => repo.state.setlists[0]
const layouts = () =>
  repo.state.setlistSongs.map((song) => ({
    presentationId: song.presentation.id,
    revision: song.presentation.revision || 0,
    warning: false,
    unmeasured: false,
  }))
const start = () =>
  service.command({
    action: 'start',
    setlistId: list().id,
    revision: list().revision,
    fonts: 'loaded:0',
    layouts: layouts(),
  })
const get = () => service.command({ action: 'get', setlistId: list().id, fonts: 'loaded:0' })
async function finish() {
  await vi.waitFor(() => expect(notified.at(-1)?.status).not.toBe('running'))
  return (await get())!
}
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-preflight-'))
  repo = new Repository(dir)
  await repo.open()
  await repo.saveDraft({
    id: 'song',
    title: '합성 찬양',
    slides: [{ id: 'slide', type: 'text', content: '가사' }],
    createdAt: '2026-10-16T00:00:00.000Z',
    updatedAt: '2026-10-16T00:00:00.000Z',
    revision: 1,
  })
  await repo.setPlaylist([{ id: 'row', presentationId: 'song' }])
  notified = []
  service = new Preflight(repo, {
    notify: (_channel: string, run: PreflightRun) => notified.push(run),
    displays: () => [{ id: 1, bounds: { width: 1920, height: 1080 } }],
    allHealth: () =>
      ['main', 'stage'].map((screen) => ({ screen, version: 1, applied: 1, status: 'applied' })),
  } as unknown as WindowManager)
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})
it('checks without changing workspace and requires separate manual confirmation; persists summary without source text', async () => {
  const bytes = await fs.readFile(repo.filename, 'utf8')
  await start()
  let run = await finish()
  expect(run.status).toBe('completed')
  expect(preflightSummary(run)).toMatchObject({ blocking: 0, manual: 4, ready: false })
  for (const check of run.results.filter((entry) => entry.severity === 'manual'))
    run = (await service.command({
      action: 'ack',
      runId: run.id,
      checkId: check.checkId,
      fingerprint: run.fingerprint,
      fonts: 'loaded:0',
      acknowledged: true,
    }))!
  expect(preflightSummary(run).ready).toBe(true)
  expect(await fs.readFile(repo.filename, 'utf8')).toBe(bytes)
  const summary = await fs.readFile(path.join(dir, 'service-preflight-v1.json'), 'utf8')
  expect(summary).not.toContain('합성 찬양')
  expect(summary).not.toContain('가사')
  expect(summary).not.toContain(dir)
})
it('reports missing media and web manual checks without starting output or fetching the web', async () => {
  const file = path.join(dir, 'synthetic.png')
  await fs.writeFile(file, 'synthetic')
  const asset = await repo.register(file),
    p = repo.playlist()[0].presentation
  await repo.saveDraft({
    ...p,
    revision: 2,
    slides: [{ ...p.slides[0], backgroundUrl: repo.assetURL(asset) }],
  })
  await fs.rm(path.join(repo.mediaDir, asset.filename))
  await repo.manageOutputResource({
    action: 'create-web',
    name: '절대 접속하지 않을 주소',
    url: 'https://example.invalid/',
  })
  const plan = structuredClone(list().servicePlan!)
  plan.items.push({
    id: 'web',
    kind: 'sermon',
    title: '설교',
    binding: { kind: 'resource', resourceId: repo.state.outputResources[0].id },
    enter: { visual: 'bound', audio: 'keep' },
  })
  await repo.attachServiceCue({
    requestId: randomUUID(),
    setlistId: list().id,
    cueId: 'web',
    expectedSetlistRevision: list().revision,
    plan,
    source: { kind: 'resource', id: repo.state.outputResources[0].id },
  })
  const fetch = vi.spyOn(globalThis, 'fetch')
  await start()
  const run = await finish()
  expect(run.results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: 'missing-asset',
        severity: 'blocking',
        cueId: plan.items[0].id,
      }),
      expect.objectContaining({ code: 'web-manual', status: 'unchecked', cueId: 'web' }),
    ]),
  )
  expect(fetch).not.toHaveBeenCalled()
  await expect(
    service.command({
      action: 'ack',
      runId: run.id,
      checkId: run.results.find((entry) => entry.severity === 'blocking')!.checkId,
      fingerprint: run.fingerprint,
      fonts: 'loaded:0',
      acknowledged: true,
    }),
  ).rejects.toThrow('직접 확인')
})
it('invalidates checks on plan, font, asset or source changes and refuses stale confirmation', async () => {
  await start()
  const run = await finish()
  expect(
    (await service.command({ action: 'get', setlistId: list().id, fonts: 'loading:1' }))!.stale,
  ).toBe(true)
  const p = repo.playlist()[0].presentation
  await repo.saveDraft({ ...p, revision: 2, slides: [{ ...p.slides[0], content: '새 내용' }] })
  expect((await get())!.stale).toBe(true)
  await expect(
    service.command({
      action: 'ack',
      runId: run.id,
      checkId: 'sound',
      fingerprint: run.fingerprint,
      fonts: 'loaded:0',
      acknowledged: true,
    }),
  ).rejects.toThrow('바뀌')
})
it('handles unknown fonts/measurements as manual, never as pass', async () => {
  await service.command({
    action: 'start',
    setlistId: list().id,
    revision: list().revision,
    fonts: 'loading:0',
    layouts: [],
  })
  const run = await finish()
  expect(run.results.find((result) => result.code === 'layout-manual')).toMatchObject({
    severity: 'manual',
    status: 'unchecked',
  })
})
it('batches 1000 cues, yields to cancellation within one second and never completes a cancelled run', async () => {
  const plan = structuredClone(list().servicePlan!)
  plan.items.push(
    ...Array.from({ length: 999 }, (_, index) => ({
      id: `cue-${index}`,
      kind: 'prayer' as const,
      title: '합성 기도',
      enter: { visual: 'keep' as const, audio: 'keep' as const },
    })),
  )
  await repo.saveServicePlan({
    requestId: randomUUID(),
    setlistId: list().id,
    expectedSetlistRevision: list().revision,
    plan,
  })
  const run = (await start())!,
    began = performance.now()
  await service.command({ action: 'cancel', runId: run.id })
  const result = await get()
  expect(result?.status).toBe('cancelled')
  expect(result?.processed).toBeLessThan(1000)
  expect(performance.now() - began).toBeLessThan(1000)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect((await get())!.status).toBe('cancelled')
})
it('reports summary disk failure and does not reuse prior app readiness after restart', async () => {
  vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('synthetic failure'))
  await start()
  const run = await finish()
  expect(run.status).toBe('error')
  expect(run.error).toContain('저장')
  expect(preflightSummary(run).ready).toBe(false)
  vi.restoreAllMocks()
  await start()
  await finish()
  expect(
    await new Preflight(repo, {} as WindowManager).command({
      action: 'get',
      setlistId: list().id,
      fonts: 'loaded:0',
    }),
  ).toBeNull()
})
