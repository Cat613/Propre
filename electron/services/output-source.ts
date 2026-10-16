import { randomUUID } from 'node:crypto'
import type { Repository } from './repository'
import type { WindowManager } from './windows'
import { PdfOutput } from './pdf-output'
import { BrowserOutput } from './browser-output'
import {
  BrowserCommand,
  PrepareRequest,
  Rotation,
  type PreparedOutput,
  type ExternalOutputStatus,
  type VisualSource,
} from '../../shared/output-resources'
import { z } from 'zod'
import type { OutputState, StageData } from '../../src/types'
export class OutputSource {
  readonly pdf: PdfOutput
  readonly browser: BrowserOutput
  generation = 0
  private prepared:
    | (PreparedOutput & {
        generation: number
        width: number
        height: number
        nextFrameURL?: string
      })
    | undefined
  private committedSource: VisualSource = { kind: 'slides' }
  private lastCommit: string | undefined
  private committing = false
  constructor(
    private repo: Repository,
    private windows: WindowManager,
    root: string,
    devURL?: string,
  ) {
    this.pdf = new PdfOutput(repo, root, devURL)
    this.browser = new BrowserOutput(
      (channel, data) => {
        if (channel === 'browser-output-navigating' || channel === 'browser-output-resized') {
          this.generation++
          this.prepared = undefined
          this.notify()
        } else if (channel === 'browser-output-crashed') {
          const source = this.windows.visualSource
          if (source.kind === 'web') {
            const frozenFrame = typeof data === 'string' ? data : undefined
            this.committedSource = { ...source, frozenFrame }
            this.windows.setVisualSource(this.committedSource)
            this.notify()
          }
        } else if (channel === 'browser-output-changed') this.notify()
        else windows.notify(channel, data)
      },
      () => this.generation,
      () => this.stop(true),
    )
    windows.onEmergencyStop = () => this.stop(true)
    windows.onMainClosing = () => {
      if (this.browser.live) this.browser.detach()
    }
    windows.onMainCreated = (win) => {
      if (
        windows.visualSource.kind === 'web' &&
        this.browser.view &&
        !this.browser.view.webContents.isDestroyed() &&
        !this.browser.crashed
      )
        void this.browser.commit(win).catch(() => this.returnToSlides())
    }
    windows.onMainResize = (win) => {
      this.generation++
      this.prepared = undefined
      this.browser.resize(win)
      this.notify()
    }
  }
  status(): ExternalOutputStatus {
    return {
      source: this.committedSource,
      generation: this.generation,
      browser: this.browser.status(),
    }
  }
  private notify() {
    this.windows.notify('external-output-status', this.status())
  }
  private viewport() {
    return this.windows.windows.get('main')?.getContentBounds() || this.windows.outputBounds()
  }
  async prepare(raw: unknown) {
    const request = PrepareRequest.parse(raw),
      resource = [
        ...this.repo.state.outputResources,
        ...this.repo.state.cueResources.map((x) => x.resource),
      ].find((r) => r.id === request.resourceId && !r.deletedAt)
    if (!resource || resource.revision !== request.revision)
      throw new Error('자료가 변경되었습니다. 다시 조회해주세요.')
    if (this.committing) throw new Error('송출 전환이 진행 중입니다.')
    if (resource.kind === 'web' && this.browser.live)
      throw new Error('웹 송출을 끝낸 뒤 다시 준비해주세요.')
    const generation = ++this.generation
    this.prepared = undefined
    this.notify()
    const bounds = this.viewport(),
      width = Math.min(4096, Math.max(100, bounds.width)),
      height = Math.min(4096, Math.max(100, bounds.height))
    const token = randomUUID()
    let prepared: PreparedOutput & {
      generation: number
      width: number
      height: number
      nextFrameURL?: string
    }
    if (resource.kind === 'pdf') {
      const page = request.page ?? resource.lastPreparedPage,
        rotation = request.rotation ?? resource.rotation
      const frameURL = await this.pdf.render(resource, page, rotation, width, height)
      if (generation !== this.generation)
        throw new Error('새 준비 요청이 있어 이전 결과를 취소했습니다.')
      // A failed next-page preview does not prevent displaying the current page.
      const nextFrameURL =
        page < resource.pageCount
          ? await this.pdf
              .render(resource, page + 1, rotation, Math.min(width, 960), Math.min(height, 540))
              .catch(() => undefined)
          : undefined
      if (generation !== this.generation) throw new Error('준비가 취소되었습니다.')
      await this.repo.rememberPDF(resource.id, resource.revision, page, rotation)
      prepared = {
        token,
        resourceId: resource.id,
        revision: resource.revision,
        generation,
        page,
        rotation,
        frameURL,
        nextFrameURL,
        width,
        height,
      }
    } else {
      if (
        this.browser.resourceId !== resource.id ||
        !this.browser.view ||
        this.browser.view.webContents.isDestroyed() ||
        this.browser.crashed
      )
        await this.browser.prepare(resource.id, resource.url, bounds)
      else if (this.browser.loading) throw new Error('웹페이지 로딩을 기다려주세요.')
      if (generation !== this.generation) throw new Error('웹 준비가 취소되었습니다.')
      prepared = {
        token,
        resourceId: resource.id,
        revision: resource.revision,
        generation,
        width,
        height,
      }
    }
    if (generation !== this.generation) throw new Error('준비가 취소되었습니다.')
    this.prepared = prepared
    if (resource.kind === 'pdf')
      this.windows.notify('output-resources-changed', this.repo.state.outputResources)
    this.updatePins()
    this.notify()
    return prepared
  }
  async thumbnails(raw: unknown) {
    const request = z
      .object({
        id: z.string().max(160),
        revision: z.number().int().nonnegative(),
        start: z.number().int().min(1).max(1000),
        rotation: Rotation.optional(),
      })
      .strict()
      .parse(raw)
    const resource = [
      ...this.repo.state.outputResources,
      ...this.repo.state.cueResources.map((x) => x.resource),
    ].find((r) => r.id === request.id && !r.deletedAt)
    if (!resource || resource.kind !== 'pdf' || resource.revision !== request.revision)
      throw new Error('PDF 자료가 변경되었습니다.')
    const frames: { page: number; url: string }[] = []
    for (let page = request.start; page <= Math.min(request.start + 5, resource.pageCount); page++)
      frames.push({
        page,
        url: await this.pdf.render(resource, page, request.rotation ?? resource.rotation, 160, 160),
      })
    return frames
  }
  private updatePins() {
    const source = this.windows.visualSource
    this.pdf.pin([
      ...(source.kind === 'pdf' ? [source.frameURL, source.nextFrameURL || ''] : []),
      this.prepared?.frameURL || '',
      this.prepared?.nextFrameURL || '',
    ])
  }
  async commit(rawToken: unknown, rawGeneration: unknown) {
    const token = z.string().uuid().parse(rawToken),
      generation = z.number().int().nonnegative().parse(rawGeneration),
      prepared = this.prepared
    if (
      !prepared ||
      prepared.token !== token ||
      prepared.generation !== generation ||
      this.generation !== generation
    )
      throw new Error('준비한 화면이 변경되었습니다. 다시 준비해주세요.')
    const resource = [
      ...this.repo.state.outputResources,
      ...this.repo.state.cueResources.map((x) => x.resource),
    ].find((r) => r.id === prepared.resourceId && !r.deletedAt)
    if (!resource || resource.revision !== prepared.revision)
      throw new Error('자료가 변경되었습니다. 다시 준비해주세요.')
    if (
      this.lastCommit === token &&
      this.committedSource.kind !== 'slides' &&
      this.committedSource.resourceId === resource.id
    )
      return this.status()
    if (this.committing) throw new Error('송출 전환이 진행 중입니다.')
    const previous = this.windows.visualSource
    const previousMuted = this.browser.muted
    let candidate: VisualSource | undefined
    this.committing = true
    try {
      const existing = this.windows.windows.get('main')
      const win = existing && !existing.isDestroyed() ? existing : this.windows.create('main')
      if (generation !== this.generation)
        throw new Error('출력 크기가 변경되었습니다. 다시 준비해주세요.')
      const source: VisualSource =
        resource.kind === 'pdf'
          ? {
              kind: 'pdf',
              resourceId: resource.id,
              name: resource.name,
              page: prepared.page!,
              rotation: prepared.rotation!,
              pageCount: resource.pageCount,
              frameURL: prepared.frameURL!,
              nextFrameURL: prepared.nextFrameURL,
            }
          : {
              kind: 'web',
              resourceId: resource.id,
              name: resource.name,
              host: new URL(this.browser.status()?.url || resource.url).hostname,
            }
      candidate = source
      if (resource.kind === 'web') {
        if (this.browser.loading || this.browser.crashed)
          throw new Error('웹페이지 로딩을 기다린 뒤 다시 준비해주세요.')
        await this.browser.commit(win)
        if (generation !== this.generation) throw new Error('송출이 취소되었습니다.')
      }
      // PDF swaps only after the output renderer has preloaded the raster.
      const version = this.windows.setVisualSource(source)
      await this.windows.waitApplied(version)
      if (generation !== this.generation) throw new Error('송출이 취소되었습니다.')
      if (resource.kind === 'pdf' && this.browser.live) this.browser.detach()
      this.committedSource = source
      this.lastCommit = token
      this.updatePins()
      this.notify()
      return this.status()
    } catch (error) {
      if (
        generation === this.generation ||
        this.windows.visualSource === candidate ||
        this.windows.visualSource === previous
      ) {
        if (this.browser.live) this.browser.detach()
        this.windows.setVisualSource(previous)
        if (
          previous.kind === 'web' &&
          this.browser.view &&
          !this.browser.view.webContents.isDestroyed()
        ) {
          const win = this.windows.windows.get('main')
          if (win && !win.isDestroyed()) {
            await this.browser
              .commit(win)
              .then(() => this.browser.mute(previousMuted))
              .catch(() => {})
          }
        }
        this.notify()
      }
      throw error
    } finally {
      this.committing = false
    }
  }
  async commitSlides(output: OutputState, stage: StageData) {
    if (this.committing) throw new Error('송출 전환이 진행 중입니다.')
    const candidate: VisualSource = { kind: 'slides' }
    const previous = this.windows.visualSource
    const previousOutput = this.windows.live()
    const previousStage = this.windows.stageLive()
    const generation = ++this.generation
    this.prepared = undefined
    this.committing = true
    try {
      this.windows.setVisualSource(candidate)
      this.windows.publishOutput(output)
      this.windows.publishStage(stage)
      const existing = this.windows.windows.get('main')
      if (!existing || existing.isDestroyed()) this.windows.create('main')
      await this.windows.waitApplied(this.windows.outputVersion())
      if (this.generation !== generation) throw new Error('송출이 중지되었습니다.')
      this.browser.detach()
      this.committedSource = { kind: 'slides' }
      this.lastCommit = undefined
      this.updatePins()
      this.notify()
    } catch (error) {
      if (this.generation === generation || this.windows.visualSource === candidate) {
        this.windows.setVisualSource(previous)
        if (previousOutput) this.windows.publishOutput(previousOutput)
        if (previousStage) this.windows.publishStage(previousStage)
      }
      throw error
    } finally {
      this.committing = false
    }
  }
  returnToSlides() {
    this.generation++
    this.prepared = undefined
    this.browser.detach()
    this.pdf.cancel()
    this.committedSource = { kind: 'slides' }
    this.lastCommit = undefined
    this.windows.setVisualSource(this.committedSource)
    this.updatePins()
    this.notify()
  }
  stop(notifyControl = false) {
    this.generation++
    this.prepared = undefined
    this.pdf.cancel()
    this.browser.reset()
    this.committedSource = { kind: 'slides' }
    this.lastCommit = undefined
    this.windows.blank()
    this.updatePins()
    this.notify()
    if (notifyControl) this.windows.notify('external-output-stop', null)
  }
  async command(raw: unknown) {
    const command = BrowserCommand.parse(raw)
    if (
      command.generation !== this.generation ||
      !this.browser.view ||
      this.browser.view.webContents.isDestroyed()
    )
      throw new Error('웹 화면이 변경되었습니다. 다시 준비해주세요.')
    const contents = this.browser.view.webContents
    if (command.action === 'mute') {
      if (!command.value && !this.browser.live)
        throw new Error('송출 중에만 웹 소리를 켤 수 있습니다.')
      this.browser.mute(command.value)
    } else if (command.action === 'show') this.browser.showPreparation()
    else if (command.action === 'reset') {
      this.returnToSlides()
      this.browser.reset()
    } else if (command.action === 'input') {
      if (!this.browser.live) throw new Error('준비 조작 창을 사용해주세요.')
      const bounds = this.browser.view.getBounds(),
        x = Math.round((command.x ?? 0) * (bounds.width - 1)),
        y = Math.round((command.y ?? 0) * (bounds.height - 1))
      if (command.type === 'click') {
        contents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
        contents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
      } else if (command.type === 'wheel')
        contents.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: command.delta ?? 0 })
      else if (command.key && !['F2', 'Meta', 'Control', 'Alt'].includes(command.key)) {
        contents.sendInputEvent({ type: 'keyDown', keyCode: command.key })
        if (command.key.length === 1)
          contents.sendInputEvent({ type: 'char', keyCode: command.key })
        contents.sendInputEvent({ type: 'keyUp', keyCode: command.key })
      }
    } else {
      if (this.browser.live) throw new Error('웹 송출을 끝낸 뒤 이동·새로고침·확대를 해주세요.')
      this.generation++
      this.prepared = undefined
      if (command.action === 'back' && contents.navigationHistory.canGoBack())
        contents.navigationHistory.goBack()
      if (command.action === 'forward' && contents.navigationHistory.canGoForward())
        contents.navigationHistory.goForward()
      if (command.action === 'reload') contents.reload()
      if (command.action === 'zoom') contents.setZoomFactor(command.value)
    }
    this.notify()
    return this.status()
  }
  assertMutable(id: string) {
    if (this.windows.visualSource.kind !== 'slides' && this.windows.visualSource.resourceId === id)
      throw new Error('송출을 끝낸 뒤 자료를 변경해주세요.')
    if (this.browser.resourceId === id) this.browser.reset()
    if (this.prepared?.resourceId === id) {
      this.generation++
      this.prepared = undefined
      this.pdf.cancel()
      if (this.browser.resourceId === id) this.browser.reset()
      this.notify()
    }
  }
  async dispose() {
    this.pdf.dispose()
    await this.browser.dispose()
  }
}
