import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { atomicWrite, mediaURLs, type Repository } from './repository'
import type { WindowManager } from './windows'
import {
  PreflightCommand,
  cuePresentation,
  type PreflightResult,
  type PreflightRun,
} from '../../shared/preflight'
import { songProjection } from '../../shared/service-plan'
export class Preflight {
  private runs = new Map<string, PreflightRun>()
  private active: PreflightRun | null = null
  private starting = false
  private acknowledging = false
  constructor(
    private repo: Repository,
    private windows: WindowManager,
  ) {}
  private list(id: string) {
    const list = this.repo.state.setlists.find((entry) => entry.id === id && !entry.deletedAt)
    if (!list?.servicePlan) throw new Error('예배를 먼저 열어주세요.')
    return list
  }
  private async dependencies(id: string, fonts: string) {
    const list = this.list(id),
      state = this.repo.state
    const documents = list.servicePlan!.items.flatMap((cue) => {
      const p = cuePresentation(cue, list.items, state.setlistSongs, state.cuePresentations)
      return p ? [p] : []
    })
    const resourceIds = new Set(
      list.servicePlan!.items.flatMap((cue) =>
        cue.binding?.kind === 'resource' ? [cue.binding.resourceId] : [],
      ),
    )
    const resources = state.cueResources
      .filter((entry) => entry.ownerSetlistId === id && resourceIds.has(entry.resource.id))
      .map((entry) => entry.resource)
    const assetIds = new Set(mediaURLs(documents).map((url) => new URL(url).pathname.split('/')[1]))
    for (const r of resources) if (r.kind === 'pdf') assetIds.add(r.assetId)
    const assets: unknown[] = [],
      ids = [...assetIds]
    for (let index = 0; index < ids.length; index += 4) {
      assets.push(
        ...(await Promise.all(
          ids.slice(index, index + 4).map(async (assetId) => {
            const asset = state.assets.find((entry) => entry.id === assetId)
            const stat = asset
              ? await this.repo
                  .assetPath(this.repo.assetURL(asset))
                  .then((file) => fs.stat(file))
                  .then((info) => [info.size, info.mtimeMs, info.isFile()])
                  .catch(() => null)
              : null
            return [assetId, asset?.type, stat]
          }),
        )),
      )
    }
    return createHash('sha256')
      .update(
        JSON.stringify({
          list,
          documents: documents.map((p) => [p.id, p.revision]),
          resources,
          assets,
          settings: state.settings,
          displays: this.windows.displays(),
          health: this.windows.allHealth(),
          fonts,
        }),
      )
      .digest('hex')
  }
  private notify(run: PreflightRun) {
    this.windows.notify('preflight-changed', structuredClone(run))
  }
  async command(raw: unknown): Promise<PreflightRun | null> {
    const command = PreflightCommand.parse(raw)
    if (command.action === 'get') {
      if (!this.runs.has(command.setlistId)) return null
      const fingerprint = await this.dependencies(command.setlistId, command.fonts)
      const run = this.runs.get(command.setlistId)!
      return {
        ...structuredClone(run),
        stale: run.fingerprint !== fingerprint,
      }
    }
    if (command.action === 'cancel') {
      if (this.active?.id === command.runId) {
        this.active.status = 'cancelled'
        this.active.completedAt = new Date().toISOString()
        this.notify(this.active)
        this.active = null
      }
      return [...this.runs.values()].find((run) => run.id === command.runId) || null
    }
    if (command.action === 'ack') {
      if (this.acknowledging || this.active || this.starting)
        throw new Error('진행 중인 확인을 마친 뒤 다시 시도해주세요.')
      this.acknowledging = true
      try {
        const run = [...this.runs.values()].find((entry) => entry.id === command.runId)
        if (
          !run ||
          run.status !== 'completed' ||
          run.fingerprint !== command.fingerprint ||
          run.fingerprint !== (await this.dependencies(run.setlistId, command.fonts))
        )
          throw new Error('점검 이후 내용이 바뀌었습니다. 다시 검사해주세요.')
        const result = run.results.find((entry) => entry.checkId === command.checkId)
        if (!result || !['manual', 'warning'].includes(result.severity))
          throw new Error('직접 확인할 항목을 선택해주세요.')
        const next = structuredClone(run),
          check = next.results.find((entry) => entry.checkId === command.checkId)!
        check.status = command.acknowledged
          ? 'acknowledged'
          : check.severity === 'manual'
            ? 'unchecked'
            : 'fail'
        check.checkedAt = command.acknowledged ? new Date().toISOString() : undefined
        await this.persist(next)
        this.runs.set(run.setlistId, next)
        this.notify(next)
        return next
      } finally {
        this.acknowledging = false
      }
    }
    if (this.starting || this.active || this.acknowledging)
      throw new Error('진행 중인 점검을 취소하거나 완료될 때까지 기다려주세요.')
    this.starting = true
    try {
      const baseline = this.repo.state
      const list = structuredClone(this.list(command.setlistId))
      if (list.revision !== command.revision)
        throw new Error('예배 내용이 바뀌었습니다. 다시 검사해주세요.')
      const fingerprint = await this.dependencies(list.id, command.fonts)
      if (baseline !== this.repo.state)
        throw new Error('점검 준비 중 자료가 변경되었습니다. 다시 검사해주세요.')
      const run: PreflightRun = {
        id: randomUUID(),
        setlistId: list.id,
        setlistRevision: list.revision,
        fingerprint,
        status: 'running',
        startedAt: new Date().toISOString(),
        processed: 0,
        total: list.servicePlan!.items.length,
        results: [],
      }
      this.runs.set(list.id, run)
      this.active = run
      this.notify(run)
      const state = structuredClone(this.repo.state)
      void (async () => {
        const add = (result: PreflightResult) => run.results.push(result)
        try {
          try {
            songProjection(list.servicePlan!, list.items)
            add({ checkId: 'plan', severity: 'info', status: 'pass', code: 'plan-valid' })
          } catch {
            add({ checkId: 'plan', severity: 'blocking', status: 'fail', code: 'missing-material' })
          }
          if (!run.total)
            add({ checkId: 'empty', severity: 'blocking', status: 'fail', code: 'empty-plan' })
          const files = new Map<string, Promise<boolean>>()
          const exists = (id: string) => {
            if (!files.has(id))
              files.set(
                id,
                (async () => {
                  const asset = state.assets.find((entry) => entry.id === id)
                  if (!asset) return false
                  return this.repo
                    .assetPath(this.repo.assetURL(asset))
                    .then((file) => fs.stat(file))
                    .then((stat) => stat.isFile() && stat.size > 0)
                    .catch(() => false)
                })(),
              )
            return files.get(id)!
          }
          const cues = list.servicePlan!.items
          for (let index = 0; index < cues.length; index += 4) {
            if (this.active !== run) return
            const batch = await Promise.all(
              cues.slice(index, index + 4).map(async (cue) => {
                const results: PreflightResult[] = [],
                  result = (
                    code: string,
                    severity: PreflightResult['severity'],
                    status: PreflightResult['status'],
                  ) =>
                    results.push({
                      checkId: `${cue.id}:${code}`,
                      cueId: cue.id,
                      code,
                      severity,
                      status,
                    })
                const p = cuePresentation(
                  cue,
                  list.items,
                  state.setlistSongs,
                  state.cuePresentations,
                )
                if (cue.materialPending) result('missing-material', 'blocking', 'fail')
                if (
                  (cue.kind === 'song' ||
                    (cue.enter.visual === 'bound' && cue.binding?.kind === 'presentation')) &&
                  !p?.slides.length
                )
                  result('missing-material', 'blocking', 'fail')
                if (p) {
                  const urls = [...new Set(mediaURLs(p))]
                  for (const url of urls)
                    if (!(await exists(new URL(url).pathname.split('/')[1]))) {
                      result('missing-asset', 'blocking', 'fail')
                      break
                    }
                  const measurement = command.layouts.find(
                    (layout) =>
                      layout.presentationId === p.id && layout.revision === (p.revision || 0),
                  )
                  result(
                    !measurement || measurement.unmeasured || !command.fonts.startsWith('loaded')
                      ? 'layout-manual'
                      : measurement.warning
                        ? 'layout-warning'
                        : 'layout-pass',
                    !measurement || measurement.unmeasured || !command.fonts.startsWith('loaded')
                      ? 'manual'
                      : measurement.warning
                        ? 'warning'
                        : 'info',
                    !measurement || measurement.unmeasured || !command.fonts.startsWith('loaded')
                      ? 'unchecked'
                      : measurement.warning
                        ? 'fail'
                        : 'pass',
                  )
                }
                if (cue.binding?.kind === 'resource') {
                  const binding = cue.binding,
                    r = state.cueResources.find(
                      (entry) =>
                        entry.ownerSetlistId === list.id &&
                        entry.resource.id === binding.resourceId,
                    )?.resource
                  if (!r || r.deletedAt) result('missing-material', 'blocking', 'fail')
                  else if (r.kind === 'web') result('web-manual', 'manual', 'unchecked')
                  else {
                    if (!binding.page || binding.page > r.pageCount)
                      result('pdf-page', 'blocking', 'fail')
                    if (!(await exists(r.assetId))) result('missing-asset', 'blocking', 'fail')
                  }
                }
                if (cue.enter.visual === 'bound' && cue.kind !== 'song' && !cue.binding)
                  result('missing-material', 'blocking', 'fail')
                return results
              }),
            )
            if (this.active !== run) return
            run.results.push(...batch.flat())
            run.processed = Math.min(index + 4, cues.length)
            this.notify(run)
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
          }
          for (const role of ['main', 'stage'] as const) {
            const health = this.windows.allHealth().find((entry) => entry.screen === role)
            add({
              checkId: `${role}-window`,
              severity: 'warning',
              status: health?.status === 'applied' ? 'pass' : 'fail',
              code: `${role}-window`,
            })
          }
          if (
            [state.outputDisplayId, state.stageDisplayId].some(
              (id) => id !== null && !this.windows.displays().some((display) => display.id === id),
            )
          )
            add({
              checkId: 'display',
              severity: 'blocking',
              status: 'fail',
              code: 'display-missing',
            })
          for (const code of ['main-readable', 'stage-readable', 'sound', 'emergency'])
            add({ checkId: code, severity: 'manual', status: 'unchecked', code })
          if (this.active !== run) return
          run.status = 'completed'
          run.completedAt = new Date().toISOString()
          run.stale = run.fingerprint !== (await this.dependencies(list.id, command.fonts))
          if (this.active !== run) return
          await this.persist(run)
        } catch {
          if (this.active === run) {
            run.status = 'error'
            run.error =
              '점검 결과를 저장하지 못했습니다. 파일·저장 공간을 확인하고 다시 검사해주세요.'
          }
        } finally {
          if (this.active === run) {
            this.active = null
            this.notify(run)
          }
        }
      })()
      return structuredClone(run)
    } finally {
      this.starting = false
    }
  }
  private async persist(run: PreflightRun) {
    const filename = path.join(this.repo.directory, 'service-preflight-v1.json')
    // A summary from an earlier app run is historical only; never loaded as current readiness.
    let prior: PreflightRun[] = []
    try {
      const stat = await fs.stat(filename)
      if (stat.size <= 2 * 1024 * 1024) {
        const raw: unknown = JSON.parse(await fs.readFile(filename, 'utf8'))
        if (Array.isArray(raw))
          prior = raw.filter(
            (entry) => entry && typeof entry.setlistId === 'string',
          ) as PreflightRun[]
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const next = prior
      .filter((entry) => entry.setlistId !== run.setlistId)
      .concat(structuredClone(run))
      .slice(-500)
    while (Buffer.byteLength(JSON.stringify(next)) > 2 * 1024 * 1024 && next.length > 1)
      next.shift()
    if (Buffer.byteLength(JSON.stringify(next)) > 2 * 1024 * 1024)
      throw new Error('점검 결과가 저장 한도를 초과했습니다.')
    await atomicWrite(filename, JSON.stringify(next))
  }
}
