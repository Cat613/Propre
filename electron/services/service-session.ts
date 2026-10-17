import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  CueRequestSchema,
  ServiceSessionSchema,
  type ServiceSessionView,
  type PreparedCue,
} from '../../shared/service-session'
import type { CueItem } from '../../shared/service-plan'
import { atomicWrite, type Repository, type RepositoryState } from './repository'
import type { WindowManager } from './windows'
import type { OutputSource } from './output-source'
import type { PreparedOutput } from '../../shared/output-resources'
import type { Presentation, OutputState, StageData } from '../../src/types'

export class ServiceSessions {
  onChanged?: (session: ServiceSessionView | null) => void
  private value: ServiceSessionView | null = null
  private prepared:
    | (PreparedCue & {
        cue: CueItem
        sourceRevision?: number
        outputVersion: number
        generation: number
        sessionRevision: number
        external?: PreparedOutput
      })
    | undefined
  private busy = false
  private preparationRevision = 0
  private completed = new Map<string, ServiceSessionView>()
  private readonly filename: string
  constructor(
    private repo: Repository,
    private windows: WindowManager,
    private sources: OutputSource,
  ) {
    this.filename = path.join(repo.directory, 'service-session-v1.json')
    repo.assertServiceMutation = (draft) => this.assertMutation(draft)
    const stop = windows.onEmergencyStop
    windows.onEmergencyStop = () => {
      stop?.()
      this.interrupt()
    }
  }
  snapshot() {
    return structuredClone(this.value)
  }
  executing() {
    return this.busy
  }
  active() {
    return this.busy || (!!this.value && this.value.status !== 'finished')
  }
  private notify() {
    this.onChanged?.(this.snapshot())
    this.windows.notify('service-session-changed', this.snapshot())
  }
  async open() {
    try {
      const info = await fs.stat(this.filename)
      if (info.size > 2 * 1024 * 1024) return
      const value = ServiceSessionSchema.parse(JSON.parse(await fs.readFile(this.filename, 'utf8')))
      if (value.status === 'finished') return
      const list = this.repo.state.setlists.find((x) => x.id === value.setlistId && !x.deletedAt)
      if (
        !list ||
        (value.currentCueId && !list.servicePlan?.items.some((x) => x.id === value.currentCueId))
      )
        return
      this.value = { ...value, status: 'interrupted', revision: value.revision + 1 }
    } catch {
      /* Missing or invalid checkpoints never initiate output. */
    }
  }
  private async persist() {
    if (this.value) await atomicWrite(this.filename, JSON.stringify(this.value))
  }
  private assertMutation(draft: RepositoryState) {
    if (this.busy && this.prepared) {
      const list = draft.setlists.find((x) => x.id === this.prepared!.setlistId)
      if (!list || list.revision !== this.prepared.planRevision)
        throw new Error('순서 전환을 마친 뒤 수정해주세요.')
    }
    if (!this.value || this.value.status === 'finished') return
    const old = this.repo.state.setlists.find((x) => x.id === this.value!.setlistId)
    const next = draft.setlists.find((x) => x.id === this.value!.setlistId && !x.deletedAt)
    if (!next) throw new Error('진행 중인 예배를 마친 뒤 삭제해주세요.')
    const cueId = this.value.currentCueId
    if (!cueId) return
    const before = old?.servicePlan?.items.find((x) => x.id === cueId)
    const after = next.servicePlan?.items.find((x) => x.id === cueId)
    const signature = (cue: CueItem | undefined, list: typeof old) =>
      JSON.stringify(
        cue && {
          kind: cue.kind,
          songItemId: cue.songItemId,
          songPresentationId: list?.items.find((row) => row.id === cue.songItemId)?.presentationId,
          binding: cue.binding,
          enter: cue.enter,
        },
      )
    if (!after || signature(before, old) !== signature(after, next))
      throw new Error('진행 중인 순서의 화면을 바꾸려면 다른 순서로 전환하거나 예배를 마쳐주세요.')
  }
  private material(
    cue: CueItem,
    setlistId: string,
  ): { presentation: Presentation; slideId: string } | undefined {
    const state = this.repo.state
    if (cue.kind === 'song') {
      const row = state.setlists
        .find((x) => x.id === setlistId)
        ?.items.find((x) => x.id === cue.songItemId)
      const presentation = state.setlistSongs.find(
        (x) => x.presentation.id === row?.presentationId,
      )?.presentation
      if (!presentation?.slides.length) throw new Error('송출할 찬양 슬라이드를 확인해주세요.')
      return { presentation, slideId: presentation.slides[0].id }
    }
    if (cue.binding?.kind === 'presentation') {
      const binding = cue.binding
      const presentation = state.cuePresentations.find(
        (x) => x.ownerSetlistId === setlistId && x.presentation.id === binding.presentationId,
      )?.presentation
      if (!presentation || !presentation.slides.some((x) => x.id === binding.slideId))
        throw new Error('연결한 슬라이드를 확인해주세요.')
      return { presentation, slideId: binding.slideId }
    }
  }
  async prepare(raw: unknown): Promise<PreparedCue> {
    if (this.busy) throw new Error('순서 전환을 기다려주세요.')
    const request = CueRequestSchema.parse(raw)
    const list = this.repo.state.setlists.find((x) => x.id === request.setlistId && !x.deletedAt)
    const cue = list?.servicePlan?.items.find((x) => x.id === request.cueId)
    if (!list || !cue || list.revision !== request.expectedSetlistRevision)
      throw new Error('예배 순서가 변경되었습니다. 다시 확인해주세요.')
    if (cue.materialPending)
      throw new Error(
        '자료 선택이 필요한 순서입니다. 자료를 연결하거나 자료 없이 진행을 명시해주세요.',
      )
    if (this.value && this.value.status !== 'finished' && this.value.setlistId !== list.id)
      throw new Error('진행 중인 예배를 마친 뒤 다른 예배를 시작해주세요.')
    this.prepared = undefined
    const preparationRevision = ++this.preparationRevision
    const material = cue.enter.visual === 'bound' ? this.material(cue, list.id) : undefined
    let external: PreparedOutput | undefined
    if (cue.enter.visual === 'bound' && cue.binding?.kind === 'resource') {
      const binding = cue.binding
      const resource = this.repo.state.cueResources.find(
        (x) => x.ownerSetlistId === list.id && x.resource.id === binding.resourceId,
      )?.resource
      if (!resource) throw new Error('연결한 송출 자료를 확인해주세요.')
      external = await this.sources.prepare({
        resourceId: resource.id,
        revision: resource.revision,
        page: binding.page,
        rotation: binding.rotation,
      })
    }
    if (preparationRevision !== this.preparationRevision)
      throw new Error('새 준비 요청이 있어 이전 결과를 취소했습니다.')
    if (list.revision !== this.repo.state.setlists.find((x) => x.id === list.id)?.revision)
      throw new Error('준비 중 예배 내용이 변경되었습니다. 다시 준비해주세요.')
    this.prepared = {
      token: randomUUID(),
      cueId: cue.id,
      setlistId: list.id,
      planRevision: list.revision,
      cue: structuredClone(cue),
      sourceRevision: material?.presentation.revision,
      outputVersion: this.windows.outputVersion(),
      generation: this.sources.generation,
      sessionRevision: this.value?.revision || 0,
      external,
    }
    return {
      token: this.prepared.token,
      cueId: cue.id,
      setlistId: list.id,
      planRevision: list.revision,
    }
  }
  async commit(token: string) {
    const prior = this.completed.get(token)
    if (prior) return structuredClone(prior)
    if (this.busy) throw new Error('순서 전환을 기다려주세요.')
    const prepared = this.prepared
    const list =
      prepared && this.repo.state.setlists.find((x) => x.id === prepared.setlistId && !x.deletedAt)
    if (
      !prepared ||
      prepared.token !== token ||
      !list ||
      list.revision !== prepared.planRevision ||
      this.sources.generation !== prepared.generation ||
      this.windows.outputVersion() !== prepared.outputVersion ||
      (this.value?.revision || 0) !== prepared.sessionRevision
    )
      throw new Error('준비한 순서나 송출 화면이 바뀌었습니다. 다시 준비해주세요.')
    const cue = prepared.cue
    const material = cue.enter.visual === 'bound' ? this.material(cue, list.id) : undefined
    if (material && material.presentation.revision !== prepared.sourceRevision)
      throw new Error('자료가 변경되었습니다. 다시 준비해주세요.')
    const previousOutput = this.windows.live()
    const previousSession = this.snapshot()
    const now = new Date().toISOString()
    const value: ServiceSessionView =
      this.value && this.value.status !== 'finished'
        ? structuredClone(this.value)
        : {
            id: randomUUID(),
            setlistId: list.id,
            revision: 0,
            status: 'running',
            currentCueId: null,
            startedAt: now,
            states: {},
            runs: [],
          }
    if (value.runs.length >= 2000)
      throw new Error('진행 기록이 한도에 도달했습니다. 예배를 마친 뒤 새로 시작해주세요.')
    if (value.currentCueId) value.states[value.currentCueId] = 'completed'
    const last = value.runs.at(-1)
    if (last && !last.endedAt) {
      last.endedAt = now
      last.outcome = 'completed'
    }
    value.currentCueId = cue.id
    value.status = 'running'
    value.states[cue.id] = 'running'
    value.revision++
    value.runs.push({ id: randomUUID(), cueId: cue.id, startedAt: now })
    this.busy = true
    try {
      await atomicWrite(this.filename, JSON.stringify({ ...value, status: 'interrupted' }))
      if (this.prepared !== prepared) throw new Error('순서 진행이 중지되었습니다.')
      if (prepared.external)
        await this.sources.commit(prepared.external.token, prepared.external.generation)
      else if (cue.enter.visual !== 'keep') {
        const base: OutputState = previousOutput || {
          type: 'state-update',
          layers: {
            audio: null,
            background: { type: 'none' },
            slide: null,
            announcement: null,
            message: null,
            props: [],
          },
        }
        const slide = material?.presentation.slides.find((x) => x.id === material.slideId) || null
        const layers =
          cue.enter.visual === 'bound'
            ? {
                ...base.layers,
                slide,
                ...(slide?.backgroundUrl
                  ? {
                      background: {
                        type: slide.type === 'video' ? ('video' as const) : ('image' as const),
                        url: slide.backgroundUrl,
                      },
                    }
                  : {}),
              }
            : {
                ...base.layers,
                slide: null,
                announcement: null,
                message: null,
                props: [],
                ...(cue.enter.visual === 'black' ? { background: { type: 'none' as const } } : {}),
              }
        const output: OutputState = {
          ...base,
          ...(cue.enter.visual === 'black' ? { isGreenScreen: false } : {}),
          globalSlideStyle: material?.presentation.globalSlideStyle || base.globalSlideStyle,
          layers: { ...layers, ...(cue.enter.audio === 'stop' ? { audio: null } : {}) },
        }
        const index =
          material?.presentation.slides.findIndex((x) => x.id === material.slideId) ?? -1
        const stage: StageData = {
          current: slide,
          next: material?.presentation.slides[index + 1] || null,
          globalSlideStyle: material?.presentation.globalSlideStyle,
          settings: this.windows.stageLive()?.settings,
        }
        await this.sources.commitSlides(output, stage)
      }
      if (this.prepared !== prepared) throw new Error('순서 진행이 중지되었습니다.')
      this.value = value
      await this.persist().catch(() =>
        this.windows.notify(
          'operation-warning',
          '진행 상태를 저장하지 못했습니다. 재시작하면 중단 상태로 복구됩니다.',
        ),
      )
      if (this.prepared !== prepared) throw new Error('순서 진행이 중지되었습니다.')
      this.prepared = undefined
      this.windows.notify('service-cue-applied', {
        musicPreparationId: cue.musicPreparationId,
        musicSetlistId: list.id,
        presentation: material?.presentation,
        slideId: material?.slideId,
        visual: cue.enter.visual,
        audio: cue.enter.audio,
      })
      if (cue.enter.audio === 'stop') this.sources.browser.mute(true)
      this.completed.set(token, this.snapshot()!)
      if (this.completed.size > 100) this.completed.delete(this.completed.keys().next().value!)
      this.notify()
      return this.snapshot()!
    } catch (error) {
      if (this.prepared === prepared) {
        this.value = previousSession
        if (previousSession) await this.persist().catch(() => {})
        else await fs.rm(this.filename, { force: true }).catch(() => {})
      }
      if (!this.value && this.prepared !== prepared)
        await fs.rm(this.filename, { force: true }).catch(() => {})
      throw error
    } finally {
      this.busy = false
    }
  }
  private async archive() {
    if (!this.value || this.value.status !== 'finished') return
    const filename = path.join(this.repo.directory, 'service-runs-v1.json')
    let history: ServiceSessionView[] = []
    try {
      const info = await fs.stat(filename)
      if (info.size > 2 * 1024 * 1024) throw new Error('진행 기록이 한도를 초과했습니다.')
      history = ServiceSessionSchema.array().parse(JSON.parse(await fs.readFile(filename, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    history = history.filter((run) => run.id !== this.value!.id).concat(this.snapshot()!)
    const counts = new Map<string, number>()
    history = history
      .reverse()
      .filter((run) => {
        const count = (counts.get(run.setlistId) || 0) + 1
        counts.set(run.setlistId, count)
        return count <= 20
      })
      .reverse()
    while (Buffer.byteLength(JSON.stringify(history)) > 2 * 1024 * 1024 && history.length > 1)
      history.shift()
    await atomicWrite(filename, JSON.stringify(history))
  }
  async finish(skip = false) {
    if (this.busy) throw new Error('순서 전환을 기다려주세요.')
    if (!this.value) return null
    if (this.value.status === 'finished') {
      await this.archive()
      return this.snapshot()
    }
    const before = this.snapshot()
    const now = new Date().toISOString()
    const next = this.snapshot()!
    const last = next.runs.at(-1)
    if (last && !last.endedAt) {
      last.endedAt = now
      last.outcome = skip ? 'skipped' : 'completed'
    }
    if (next.currentCueId) next.states[next.currentCueId] = skip ? 'skipped' : 'completed'
    next.currentCueId = null
    next.revision++
    next.status = skip ? 'running' : 'finished'
    this.busy = true
    this.value = next
    try {
      await this.persist()
      if (!skip)
        await this.archive().catch(() =>
          this.windows.notify(
            'operation-warning',
            '예배 종료는 저장했지만 진행 기록 보관에 실패했습니다.',
          ),
        )
    } catch (error) {
      this.value = before
      throw error
    } finally {
      this.busy = false
    }
    this.prepared = undefined
    this.preparationRevision++
    this.notify()
    return this.snapshot()
  }
  interrupt() {
    this.prepared = undefined
    this.preparationRevision++
    if (!this.value || this.value.status === 'finished') return
    this.value.status = 'interrupted'
    this.value.revision++
    void this.persist().catch(() =>
      this.windows.notify('operation-warning', '중단한 예배 상태를 저장하지 못했습니다.'),
    )
    this.notify()
  }
}
