import { BrowserWindow, type IpcMainEvent } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import type { Repository } from './repository'
import type { OutputResource } from '../../shared/output-resources'
import { z } from 'zod'
const Result = z
  .object({
    id: z.string().max(160),
    png: z
      .string()
      .max(24 * 1024 * 1024)
      .optional(),
    error: z.boolean().optional(),
    pages: z.number().int().min(1).max(1000).optional(),
  })
  .strict()
export class PdfOutput {
  private window: BrowserWindow | undefined
  private ready = false
  private tail: Promise<unknown> = Promise.resolve()
  private pending:
    | {
        id: string
        url: string
        bytes: Buffer
        page: number
        rotation: number
        width: number
        height: number
        resolve: (url: string) => void
        reject: (error: Error) => void
        timer: ReturnType<typeof setTimeout>
      }
    | undefined
  private frames = new Map<string, { bytes: Buffer; key: string; pages: number }>()
  private pins = new Set<string>()
  private total = 0
  private epoch = 0
  constructor(
    private repo: Repository,
    private root: string,
    private devURL?: string,
  ) {}
  pin(urls: string[]) {
    this.pins = new Set(urls)
    this.trim()
  }
  frame(url: string) {
    return this.frames.get(url)?.bytes
  }
  async document(token: string) {
    if (token !== this.pending?.id) throw new Error('만료된 PDF 읽기 요청입니다.')
    return this.pending.bytes
  }
  private trim() {
    for (const [url, frame] of this.frames) {
      if (this.total <= 128 * 1024 * 1024 && this.frames.size <= 20) break
      if (!this.pins.has(url)) {
        this.frames.delete(url)
        this.total -= frame.bytes.length
      }
    }
  }
  private authorized(event: IpcMainEvent) {
    if (
      !this.window ||
      this.window.isDestroyed() ||
      event.sender !== this.window.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      return false
    try {
      const url = new URL(event.senderFrame.url)
      return this.devURL
        ? url.origin === new URL(this.devURL).origin
        : url.protocol === 'app:' && url.hostname === 'propre'
    } catch {
      return false
    }
  }
  onReady(event: IpcMainEvent) {
    if (this.authorized(event)) {
      this.ready = true
      this.deliver()
    }
  }
  onResult(event: IpcMainEvent, raw: unknown) {
    if (!this.authorized(event)) return
    const parsed = Result.safeParse(raw),
      pending = this.pending
    if (!parsed.success || !pending || parsed.data.id !== pending.id) return
    if (parsed.data.error || !parsed.data.png || !parsed.data.pages) {
      this.fail()
      return
    }
    const bytes = Buffer.from(parsed.data.png, 'base64')
    if (
      bytes.length > 18 * 1024 * 1024 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      this.fail()
      return
    }
    const url = `output://frame/${pending.id}`
    const key = `${pending.url}:${pending.page}:${pending.rotation}:${pending.width}:${pending.height}`
    this.frames.set(url, { bytes, key, pages: parsed.data.pages })
    this.total += bytes.length
    clearTimeout(pending.timer)
    this.pending = undefined
    pending.resolve(url)
    this.trim()
  }
  private deliver() {
    if (this.ready && this.pending) {
      const { id, page, rotation, width, height } = this.pending
      this.window?.webContents.send('pdf-output-render', {
        id,
        page,
        rotation,
        width,
        height,
        url: `output://pdf/${id}`,
      })
    }
  }
  private fail() {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    this.pending.reject(
      new Error('PDF 페이지를 표시하지 못했습니다. 다른 페이지 또는 파일을 확인해주세요.'),
    )
    this.pending = undefined
  }
  cancel() {
    this.epoch++
    this.fail()
    this.ready = false
    this.window?.destroy()
    this.window = undefined
  }
  dispose() {
    this.cancel()
    this.frames.clear()
    this.total = 0
  }
  async inspect(bytes: Buffer) {
    const now = new Date().toISOString()
    const resource = {
      id: randomUUID(),
      kind: 'pdf' as const,
      name: 'PDF validation',
      revision: 0,
      createdAt: now,
      updatedAt: now,
      assetId: 'validation',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      pageCount: 1000,
      lastPreparedPage: 1,
      rotation: 0 as const,
    }
    const url = await this.render(resource, 1, 0, 960, 540, bytes)
    const frame = this.frames.get(url)
    if (!frame) throw new Error('PDF 검증 결과가 만료되었습니다.')
    return frame.pages
  }
  async render(
    resource: Extract<OutputResource, { kind: 'pdf' }>,
    page: number,
    rotation: number,
    width: number,
    height: number,
    validationBytes?: Buffer,
  ) {
    const epoch = this.epoch
    const operation = this.tail
      .catch(() => {})
      .then(async () => {
        if (epoch !== this.epoch) throw new Error('PDF 준비가 취소되었습니다.')
        const asset = this.repo.state.assets.find((a) => a.id === resource.assetId)
        if ((!asset && !validationBytes) || page < 1 || page > resource.pageCount)
          throw new Error('PDF 페이지를 확인해주세요.')
        const content =
          validationBytes ||
          (await fs.readFile(await this.repo.assetPath(this.repo.assetURL(asset!))))
        if (epoch !== this.epoch) throw new Error('PDF 준비가 취소되었습니다.')
        if (createHash('sha256').update(content).digest('hex') !== resource.sha256)
          throw new Error('PDF 원본이 변경되었습니다. 다시 등록해주세요.')
        const url = `${asset ? this.repo.assetURL(asset) : 'validation'}:${resource.sha256}`,
          key = `${url}:${page}:${rotation}:${width}:${height}`
        const cached = [...this.frames].find(([, f]) => f.key === key)
        if (cached) {
          this.frames.delete(cached[0])
          this.frames.set(...cached)
          return cached[0]
        }
        return new Promise<string>((resolve, reject) => {
          const id = randomUUID(),
            timer = setTimeout(() => {
              this.fail()
              this.window?.destroy()
              this.window = undefined
              this.ready = false
            }, 15000)
          this.pending = {
            id,
            url,
            bytes: content,
            page,
            rotation,
            width,
            height,
            resolve,
            reject,
            timer,
          }
          if (!this.window || this.window.isDestroyed()) {
            this.ready = false
            this.window = new BrowserWindow({
              show: false,
              width: 128,
              height: 128,
              webPreferences: {
                preload: path.join(this.root, 'dist-electron/preload.mjs'),
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                backgroundThrottling: false,
                additionalArguments: ['--propre-role=pdf-helper'],
              },
            })
            this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
            this.window.webContents.on('will-navigate', (event) => event.preventDefault())
            this.window.webContents.on('render-process-gone', () => {
              this.fail()
              this.ready = false
              this.window?.destroy()
              this.window = undefined
            })
            void this.window
              .loadURL(
                this.devURL ? `${this.devURL}/#pdf-helper` : 'app://propre/index.html#pdf-helper',
              )
              .catch(() => this.fail())
          }
          this.deliver()
        })
      })
    this.tail = operation
    return operation
  }
}
