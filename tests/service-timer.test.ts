import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { TimerEngine, timerDisplay, serviceTiming } from '../shared/service-timer'
import { ServiceTimers } from '../electron/services/service-timers'
import type { Repository } from '../electron/services/repository'
import type { WindowManager } from '../electron/services/windows'
import type { ServiceSessions } from '../electron/services/service-session'
import type { ServiceSessionView } from '../shared/service-session'
const preset = {
  mode: 'countdown' as const,
  targetSeconds: 60,
  warningSeconds: 10,
  autoStart: false,
  showOnStage: false,
}
const identity = () => ({ sessionId: randomUUID(), cueId: 'cue', runId: randomUUID() })
let mono: number, wall: number, engine: TimerEngine
beforeEach(() => {
  mono = 0
  wall = Date.parse('2026-10-16T00:00:00.000Z')
  engine = new TimerEngine({ mono: () => mono, wall: () => wall })
})
afterEach(() => vi.restoreAllMocks())
const command = (action: 'start' | 'pause' | 'resume' | 'reset' | 'extend') =>
  engine.command({ action, requestId: randomUUID(), expectedRevision: engine.snapshot()!.revision })
it('separates actual cue elapsed from timer idle/pause, and never changes cue identity at zero', () => {
  const id = identity()
  engine.enter(id, preset)
  mono += 1000
  expect(engine.snapshot()).toMatchObject({ elapsedMs: 0, cueElapsedMs: 1000, state: 'idle' })
  command('start')
  mono += 2000
  command('pause')
  mono += 5000
  expect(engine.snapshot()).toMatchObject({ elapsedMs: 2000, cueElapsedMs: 8000, state: 'paused' })
  command('resume')
  mono += 60000
  expect(timerDisplay(engine.snapshot()!)).toMatchObject({ label: '초과', warning: true })
  expect(engine.snapshot()).toMatchObject({ ...id, state: 'running', elapsedMs: 62000 })
})
it('extension/reset only change the timer, stale commands reject and wall-clock changes do not change elapsed', () => {
  engine.enter(identity(), preset)
  command('start')
  mono += 5000
  wall += 3600000
  expect(engine.snapshot()!.elapsedMs).toBe(5000)
  const revision = engine.snapshot()!.revision
  command('extend')
  expect(engine.snapshot()!.targetSeconds).toBe(120)
  expect(() =>
    engine.command({ action: 'pause', requestId: randomUUID(), expectedRevision: revision }),
  ).toThrow('바뀌')
  const actual = engine.snapshot()!.cueElapsedMs
  command('reset')
  expect(engine.snapshot()).toMatchObject({ state: 'idle', elapsedMs: 0, cueElapsedMs: actual })
})
it('restores paused with Stage hidden and suspends without losing checked elapsed', () => {
  engine.enter(identity(), { ...preset, autoStart: true, showOnStage: true })
  mono = 1234
  const snapshot = engine.snapshot()!,
    restored = new TimerEngine({ mono: () => mono, wall: () => wall })
  restored.restore(snapshot)
  mono += 999999
  expect(restored.snapshot()).toMatchObject({
    elapsedMs: 1234,
    state: 'paused',
    showOnStage: false,
    reason: 'restart',
  })
  engine.pause('sleep')
  const paused = engine.snapshot()!.elapsedMs
  mono += 999
  expect(engine.snapshot()).toMatchObject({
    elapsedMs: paused,
    state: 'paused',
    reason: 'sleep',
    showOnStage: false,
  })
})
it('keeps countdown boundaries, countup and maximum extension explicit', () => {
  engine.enter(identity(), { ...preset, targetSeconds: 1, warningSeconds: 0, autoStart: true })
  mono = 1000
  expect(timerDisplay(engine.snapshot()!)).toMatchObject({ label: '초과', text: '0:00' })
  engine.enter(identity(), {
    mode: 'countup',
    warningSeconds: 0,
    autoStart: true,
    showOnStage: false,
  })
  mono += 65000
  expect(timerDisplay(engine.snapshot()!)).toMatchObject({
    label: '경과',
    text: '1:05',
    warning: false,
  })
  expect(() => command('extend')).toThrow('최대')
  engine.enter(identity(), { ...preset, targetSeconds: 86400 })
  expect(() => command('extend')).toThrow('최대')
})
it('computes incomplete plans and midnight forecasts without treating missing duration as zero', () => {
  const now = Date.parse('2026-10-16T00:00:00Z'),
    id = identity()
  engine.enter(id, preset)
  const session = { startedAt: '2026-10-15T23:59:00Z' } as ServiceSessionView
  const plan = {
    version: 1 as const,
    timezone: 'UTC',
    plannedStartAt: '2026-10-15T23:58:00Z',
    items: [
      {
        id: 'before',
        kind: 'prayer' as const,
        title: '기도',
        durationSeconds: 60,
        enter: { visual: 'keep' as const, audio: 'keep' as const },
      },
      {
        id: id.cueId,
        kind: 'sermon' as const,
        title: '설교',
        durationSeconds: 60,
        enter: { visual: 'keep' as const, audio: 'keep' as const },
      },
    ],
  }
  expect(serviceTiming(plan, session, engine.snapshot()!, now)).toMatchObject({
    totalElapsedMs: 60000,
    delayMs: 60000,
    expectedEndAt: '2026-10-16T00:01:00.000Z',
  })
  delete (plan.items[0] as { durationSeconds?: number }).durationSeconds
  expect(serviceTiming(plan, session, engine.snapshot()!, now).delayMs).toBeUndefined()
})

let dir: string
async function serviceFixture() {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-timer-unit-'))
  let session: ServiceSessionView | null = null
  const repo = {
    directory: dir,
    state: { setlists: [{ id: 'list', servicePlan: { items: [{ id: 'cue', timer: preset }] } }] },
  } as unknown as Repository
  const sessions = { snapshot: () => session, executing: () => false } as unknown as ServiceSessions
  const windows = { windows: new Map(), notify: vi.fn() } as unknown as WindowManager
  const service = new ServiceTimers(repo, windows, sessions, engine, false)
  const start = () => {
    session = {
      id: randomUUID(),
      setlistId: 'list',
      revision: 1,
      status: 'running',
      currentCueId: 'cue',
      startedAt: new Date(wall).toISOString(),
      states: { cue: 'running' },
      runs: [{ id: randomUUID(), cueId: 'cue', startedAt: new Date(wall).toISOString() }],
    }
    service.sync(session)
    return session
  }
  return { service, start, sessions, windows, repo }
}
it('deduplicates commands, restores matching checkpoint paused and records repeated cue runs independently', async () => {
  const { service, start, sessions, windows, repo } = await serviceFixture()
  try {
    const first = start()
    await service.checkpoint()
    const request = {
      action: 'extend' as const,
      requestId: randomUUID(),
      expectedRevision: service.snapshot()!.revision,
    }
    await Promise.all([service.command(request), service.command(request)])
    expect(service.snapshot()!.targetSeconds).toBe(120)
    await service.command({
      action: 'start',
      requestId: randomUUID(),
      expectedRevision: service.snapshot()!.revision,
    })
    mono = 1234
    await service.checkpoint()
    const recovered = new ServiceTimers(
      repo,
      windows,
      sessions,
      new TimerEngine({ mono: () => mono, wall: () => wall }),
      false,
    )
    await recovered.open()
    expect(recovered.snapshot()).toMatchObject({
      elapsedMs: 1234,
      state: 'paused',
      showOnStage: false,
    })
    const next = start()
    await service.checkpoint()
    expect(next.runs[0].id).not.toBe(first.runs[0].id)
    expect(service.snapshot()!.elapsedMs).toBe(0)
    const file = JSON.parse(await fs.readFile(path.join(dir, 'service-timer-v1.json'), 'utf8'))
    expect(file.history).toHaveLength(1)
    expect(file.history[0].elapsedMs).toBe(1234)
    expect(JSON.stringify(file)).not.toContain('operatorNote')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
it('refuses Stage without its window and rolls a failed command back, allowing the same request to retry', async () => {
  const { service, start } = await serviceFixture()
  try {
    start()
    await service.checkpoint()
    await expect(
      service.command({
        action: 'stage',
        show: true,
        requestId: randomUUID(),
        expectedRevision: service.snapshot()!.revision,
      }),
    ).rejects.toThrow('무대 화면')
    const request = {
      action: 'extend' as const,
      requestId: randomUUID(),
      expectedRevision: service.snapshot()!.revision,
    }
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('synthetic disk failure'))
    await expect(service.command(request)).rejects.toThrow('disk failure')
    expect(service.snapshot()!.targetSeconds).toBe(60)
    vi.restoreAllMocks()
    await service.command(request)
    expect(service.snapshot()!.targetSeconds).toBe(120)
    service.suspend('sleep')
    await service.checkpoint()
    expect(service.snapshot()).toMatchObject({ reason: 'sleep', showOnStage: false })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
it('rollback includes time spent waiting on a failed command write', () => {
  engine.enter(identity(), { ...preset, autoStart: true })
  mono = 2000
  const before = engine.snapshot()!,
    at = engine.mark()
  command('pause')
  mono += 3000
  engine.rollback(before, at)
  expect(engine.snapshot()).toMatchObject({ elapsedMs: 5000, cueElapsedMs: 5000, state: 'running' })
})
