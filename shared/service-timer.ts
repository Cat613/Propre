import { z } from 'zod'
import type { TimerPreset } from './service-plan'
const seconds = z.number().int().min(0).max(86400)
export const TimerRuntimeSchema = z
  .object({
    sessionId: z.string().uuid(),
    cueId: z.string().min(1).max(160),
    runId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    state: z.enum(['idle', 'running', 'paused', 'finished']),
    mode: z.enum(['countdown', 'countup']),
    targetSeconds: seconds.optional(),
    warningSeconds: seconds,
    showOnStage: z.boolean(),
    elapsedMs: z.number().min(0).max(315360000000),
    cueElapsedMs: z.number().min(0).max(315360000000),
    sampledAt: z.string().datetime(),
    reason: z.enum(['sleep', 'emergency', 'restart']).optional(),
  })
  .strict()
  .refine((value) =>
    value.mode === 'countdown'
      ? !!value.targetSeconds && value.warningSeconds <= value.targetSeconds
      : value.targetSeconds === undefined && value.warningSeconds === 0,
  )
export type TimerRuntime = z.infer<typeof TimerRuntimeSchema>
export const TimerCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.enum(['start', 'pause', 'resume', 'reset', 'extend', 'apply-plan']),
      requestId: z.string().uuid(),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal('stage'),
      show: z.boolean(),
      requestId: z.string().uuid(),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
])
export type TimerAction = z.infer<typeof TimerCommand>
export const formatTimer = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(Math.abs(milliseconds) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
export const formatDuration = (seconds: number) =>
  [seconds >= 60 ? `${Math.floor(seconds / 60)}분` : '', seconds % 60 ? `${seconds % 60}초` : '']
    .filter(Boolean)
    .join(' ') || '0초'
export function timerDisplay(timer: TimerRuntime) {
  const remaining =
    timer.mode === 'countdown'
      ? (timer.targetSeconds || 0) * 1000 - timer.elapsedMs
      : timer.elapsedMs
  return {
    text: formatTimer(
      timer.mode === 'countdown' && remaining > 0 ? Math.ceil(remaining / 1000) * 1000 : remaining,
    ),
    label:
      timer.state === 'idle'
        ? '대기'
        : timer.mode === 'countup'
          ? '경과'
          : remaining <= 0
            ? '초과'
            : '남음',
    warning:
      timer.state !== 'idle' &&
      timer.mode === 'countdown' &&
      remaining <= timer.warningSeconds * 1000,
    overtime: timer.mode === 'countdown' && remaining <= 0,
  }
}
export interface TimerClock {
  mono(): number
  wall(): number
}
/** This engine never schedules output or changes the service cursor. */
export class TimerEngine {
  private value: TimerRuntime | null = null
  private anchor = 0
  private cueAnchor = 0
  constructor(
    private clock: TimerClock = { mono: () => performance.now(), wall: () => Date.now() },
  ) {}
  snapshot(): TimerRuntime | null {
    if (!this.value) return null
    const delta = Math.max(0, this.clock.mono() - this.anchor),
      cueDelta =
        this.value.state === 'finished' ? 0 : Math.max(0, this.clock.mono() - this.cueAnchor)
    return {
      ...this.value,
      elapsedMs: this.value.elapsedMs + (this.value.state === 'running' ? delta : 0),
      cueElapsedMs: this.value.cueElapsedMs + cueDelta,
      sampledAt: new Date(this.clock.wall()).toISOString(),
    }
  }
  restore(runtime: TimerRuntime) {
    const value = TimerRuntimeSchema.parse(runtime)
    this.value = {
      ...value,
      state: value.state === 'idle' ? 'idle' : value.state === 'finished' ? 'finished' : 'paused',
      showOnStage: false,
      revision: value.revision + 1,
      reason: 'restart',
    }
    this.anchor = this.cueAnchor = this.clock.mono()
    return this.snapshot()
  }
  mark() {
    return this.clock.mono()
  }
  rollback(runtime: TimerRuntime | null, at = this.clock.mono()) {
    const delta = Math.max(0, this.clock.mono() - at)
    this.value = runtime
      ? {
          ...runtime,
          elapsedMs: runtime.elapsedMs + (runtime.state === 'running' ? delta : 0),
          cueElapsedMs: runtime.cueElapsedMs + (runtime.state !== 'finished' ? delta : 0),
        }
      : null
    this.anchor = this.cueAnchor = this.clock.mono()
  }
  enter(identity: Pick<TimerRuntime, 'sessionId' | 'cueId' | 'runId'>, preset: TimerPreset) {
    this.value = {
      ...identity,
      revision: (this.value?.revision || 0) + 1,
      state: preset.autoStart ? 'running' : 'idle',
      mode: preset.mode,
      targetSeconds: preset.targetSeconds,
      warningSeconds: preset.warningSeconds,
      showOnStage: preset.showOnStage,
      elapsedMs: 0,
      cueElapsedMs: 0,
      sampledAt: new Date(this.clock.wall()).toISOString(),
    }
    this.anchor = this.cueAnchor = this.clock.mono()
    return this.snapshot()!
  }
  finish() {
    if (!this.value) return null
    this.capture()
    this.value!.state = 'finished'
    this.value!.showOnStage = false
    this.value!.revision++
    return this.snapshot()
  }
  pause(reason?: TimerRuntime['reason']) {
    if (!this.value || this.value.state === 'finished') return this.snapshot()
    this.capture()
    if (this.value.state === 'running') this.value.state = 'paused'
    this.value.showOnStage = reason ? false : this.value.showOnStage
    this.value.reason = reason
    this.value.revision++
    return this.snapshot()
  }
  private capture() {
    this.value = this.snapshot()
    this.anchor = this.cueAnchor = this.clock.mono()
  }
  command(raw: TimerAction, preset?: TimerPreset) {
    const command = TimerCommand.parse(raw)
    if (!this.value || this.value.state === 'finished')
      throw new Error('순서를 진행한 뒤 타이머를 시작하세요.')
    if (command.expectedRevision !== this.value.revision)
      throw new Error('타이머 상태가 바뀌었습니다. 현재 상태를 확인해주세요.')
    this.capture()
    const value = this.value!
    if (command.action === 'start' || command.action === 'resume') {
      if (value.state === 'running') throw new Error('이미 타이머가 진행 중입니다.')
      value.state = 'running'
      delete value.reason
    } else if (command.action === 'pause') value.state = 'paused'
    else if (command.action === 'reset') {
      value.elapsedMs = 0
      value.state = 'idle'
      delete value.reason
    } else if (command.action === 'extend') {
      if (value.mode !== 'countdown' || !value.targetSeconds || value.targetSeconds + 60 > 86400)
        throw new Error('카운트다운은 최대24시간까지 늘릴 수 있습니다.')
      value.targetSeconds += 60
    } else if (command.action === 'stage') value.showOnStage = command.show
    else if (command.action === 'apply-plan') {
      if (!preset) throw new Error('현재 순서 설정을 찾지 못했습니다.')
      value.mode = preset.mode
      value.targetSeconds = preset.targetSeconds
      value.warningSeconds = preset.warningSeconds
    }
    value.revision++
    return this.snapshot()!
  }
}

export function serviceTiming(
  plan: import('./service-plan').ServicePlan,
  session: import('./service-session').ServiceSessionView,
  timer: TimerRuntime,
  now: number,
) {
  const index = plan.items.findIndex((cue) => cue.id === timer.cueId),
    current = plan.items[index],
    prior = plan.items.slice(0, index),
    later = plan.items.slice(index + 1)
  const totalElapsedMs = Math.max(0, now - Date.parse(session.startedAt))
  const known =
    index >= 0 && !!current && [...prior, current].every((cue) => cue.durationSeconds !== undefined)
  const elapsedPlanMs = plan.plannedStartAt ? now - Date.parse(plan.plannedStartAt) : totalElapsedMs
  const delayMs = known
    ? elapsedPlanMs -
      prior.reduce((sum, cue) => sum + cue.durationSeconds! * 1000, 0) -
      Math.min(timer.cueElapsedMs, current.durationSeconds! * 1000)
    : undefined
  const remainingMs =
    timer.mode === 'countdown'
      ? Math.max(0, (timer.targetSeconds || 0) * 1000 - timer.elapsedMs)
      : current?.durationSeconds === undefined
        ? undefined
        : Math.max(0, current.durationSeconds * 1000 - timer.cueElapsedMs)
  const laterMs = later.reduce((sum, cue) => sum + (cue.durationSeconds || 0) * 1000, 0)
  return {
    totalElapsedMs,
    delayMs,
    knownRemainingMs: (remainingMs || 0) + laterMs,
    expectedEndAt:
      remainingMs !== undefined &&
      current?.durationSeconds !== undefined &&
      later.every((cue) => cue.durationSeconds !== undefined)
        ? new Date(now + remainingMs + laterMs).toISOString()
        : undefined,
  }
}
