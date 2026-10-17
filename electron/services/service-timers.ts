import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite, type Repository } from './repository'
import type { WindowManager } from './windows'
import type { ServiceSessions } from './service-session'
import type { ServiceSessionView } from '../../shared/service-session'
import {
  TimerCommand,
  TimerEngine,
  TimerRuntimeSchema,
  type TimerRuntime,
} from '../../shared/service-timer'
import type { CueItem, TimerPreset } from '../../shared/service-plan'
export function cueTimerPreset(cue: CueItem): TimerPreset {
  return (
    cue.timer ||
    (cue.durationSeconds
      ? {
          mode: 'countdown',
          targetSeconds: cue.durationSeconds,
          warningSeconds: Math.min(120, cue.durationSeconds),
          autoStart: false,
          showOnStage: false,
        }
      : { mode: 'countup', warningSeconds: 0, autoStart: false, showOnStage: false })
  )
}
export class ServiceTimers {
  private history: TimerRuntime[] = []
  private tail: Promise<void> = Promise.resolve()
  private generation = 0
  private busy = false
  private receipts = new Map<string, { signature: string; result: Promise<TimerRuntime | null> }>()
  private interval?: ReturnType<typeof setInterval>
  private sampleCount = 0
  private filename: string
  constructor(
    private repo: Repository,
    private windows: WindowManager,
    private sessions: ServiceSessions,
    private engine = new TimerEngine(),
    ticking = true,
  ) {
    this.filename = path.join(repo.directory, 'service-timer-v1.json')
    sessions.onChanged = (session) => this.sync(session)
    const ready = windows.onStageReady
    windows.onStageReady = () => {
      ready?.()
      this.deliver()
    }
    if (ticking) {
      this.interval = setInterval(() => {
        this.notify()
        if (++this.sampleCount % 10 === 0 && this.engine.snapshot()?.state === 'running')
          void this.checkpoint().catch(() => this.warning())
      }, 1000)
      this.interval.unref?.()
    }
  }
  snapshot() {
    return this.engine.snapshot()
  }
  private stageOpen() {
    const stage = this.windows.windows.get('stage')
    return !!stage && !stage.isDestroyed()
  }
  private deliver() {
    const stage = this.windows.windows.get('stage')
    if (stage && !stage.isDestroyed())
      stage.webContents.send(
        'service-timer-stage',
        this.snapshot()?.showOnStage ? this.snapshot() : null,
      )
  }
  private notify() {
    this.windows.notify('service-timer-changed', this.snapshot())
    this.deliver()
  }
  private warning() {
    this.windows.notify(
      'operation-warning',
      '타이머 기록을 저장하지 못했습니다. 저장 공간을 확인해주세요.',
    )
  }
  private preset(session: ServiceSessionView) {
    return this.repo.state.setlists
      .find((list) => list.id === session.setlistId)
      ?.servicePlan?.items.find((cue) => cue.id === session.currentCueId)
  }
  async open() {
    try {
      const stat = await fs.stat(this.filename)
      if (stat.size > 2 * 1024 * 1024) throw new Error('too large')
      const raw = JSON.parse(await fs.readFile(this.filename, 'utf8'))
      this.history = TimerRuntimeSchema.array()
        .max(1000)
        .parse(raw.history || [])
      const timer = raw.current ? TimerRuntimeSchema.parse(raw.current) : null,
        session = this.sessions.snapshot()
      if (
        timer &&
        session &&
        session.status !== 'finished' &&
        session.id === timer.sessionId &&
        session.currentCueId === timer.cueId &&
        session.runs.at(-1)?.id === timer.runId
      )
        this.engine.restore(timer)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.warning()
    }
  }
  sync(session: ServiceSessionView | null) {
    const current = this.snapshot(),
      run = session?.runs.at(-1)
    if (!session || session.status === 'finished' || !session.currentCueId) {
      if (current && current.state !== 'finished') {
        this.generation++
        const finished = this.engine.finish()!
        this.history.push(finished)
        this.notify()
        void this.checkpoint().catch(() => this.warning())
      }
      return
    }
    if (current?.runId === run?.id) {
      if (session.status === 'interrupted') this.suspend('emergency')
      return
    }
    if (session.status !== 'running' || !run?.id) return
    const cue = this.preset(session)
    if (!cue) return
    if (current && current.state !== 'finished') this.history.push(this.engine.finish()!)
    const preset = cueTimerPreset(cue)
    this.generation++
    this.engine.enter(
      { sessionId: session.id, cueId: cue.id, runId: run.id },
      { ...preset, showOnStage: preset.showOnStage && this.stageOpen() },
    )
    this.notify()
    void this.checkpoint().catch(() => this.warning())
  }
  suspend(reason: 'sleep' | 'emergency') {
    if (!this.snapshot() || this.snapshot()?.state === 'finished') return
    this.generation++
    this.engine.pause(reason)
    this.notify()
    void this.checkpoint().catch(() => this.warning())
  }
  command(raw: unknown): Promise<TimerRuntime | null> {
    const command = TimerCommand.parse(raw),
      signature = JSON.stringify(command),
      prior = this.receipts.get(command.requestId)
    if (prior) {
      if (prior.signature !== signature)
        return Promise.reject(new Error('요청 ID에 다른 타이머 명령이 있습니다.'))
      return prior.result.then(() => this.snapshot())
    }
    if (this.busy || this.sessions.executing())
      return Promise.reject(new Error('진행 중인 변경을 마친 뒤 타이머를 조작해주세요.'))
    if (command.action === 'stage' && command.show && !this.stageOpen())
      return Promise.reject(new Error('무대 화면을 먼저 열어주세요.'))
    const before = this.snapshot(),
      at = this.engine.mark(),
      generation = this.generation,
      session = this.sessions.snapshot(),
      cue = session && this.preset(session)
    try {
      this.engine.command(command, cue ? cueTimerPreset(cue) : undefined)
    } catch (error) {
      return Promise.reject(error)
    }
    this.busy = true
    this.notify()
    const result = this.checkpoint()
      .then(() => this.snapshot())
      .catch((error) => {
        if (this.generation === generation) {
          this.engine.rollback(before, at)
          this.notify()
        }
        this.receipts.delete(command.requestId)
        throw error
      })
      .finally(() => {
        this.busy = false
      })
    this.receipts.set(command.requestId, { signature, result })
    if (this.receipts.size > 1000) this.receipts.delete(this.receipts.keys().next().value!)
    return result
  }
  checkpoint() {
    const history = this.history.slice(-1000),
      current = this.snapshot()
    while (
      Buffer.byteLength(JSON.stringify({ current, history })) > 2 * 1024 * 1024 &&
      history.length
    )
      history.shift()
    this.history = history
    this.tail = this.tail
      .catch(() => {})
      .then(() => atomicWrite(this.filename, JSON.stringify({ current, history })))
    return this.tail
  }
  dispose() {
    clearInterval(this.interval)
  }
}
