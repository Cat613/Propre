import { BrowserWindow, type IpcMainEvent } from 'electron'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseSlide, GlobalStyle } from '../../shared/schema'
import { PreparationError, type PreparedPreview } from '../../shared/automation'

export class PreparationPreview {
  private window: BrowserWindow | undefined
  private current:
    | {
        id: string
        snapshot: PreparedPreview
        resolve: (image: string) => void
        reject: (error: unknown) => void
        timer: ReturnType<typeof setTimeout>
      }
    | undefined
  private ready = false
  constructor(
    private root: string,
    private devURL: string | undefined,
  ) {}
  private authorized(event: IpcMainEvent): boolean {
    if (
      !this.window ||
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
  onMediaError(event: IpcMainEvent) {
    if (this.authorized(event)) this.fail()
  }
  private deliver() {
    if (this.ready && this.current)
      this.window?.webContents.send('ai-preview', { id: this.current.id, ...this.current.snapshot })
  }
  onRendered(event: IpcMainEvent, id: unknown) {
    if (!this.authorized(event) || id !== this.current?.id) return
    const current = this.current!
    void this.window!.webContents.capturePage({ x: 0, y: 0, width: 960, height: 540 })
      .then((image) => {
        if (this.current !== current) return
        if (image.isEmpty()) throw new Error('empty')
        current.resolve(image.toPNG().toString('base64'))
        this.finish()
      })
      .catch(() => this.fail())
  }
  render(raw: PreparedPreview): Promise<string> {
    if (this.current)
      return Promise.reject(new PreparationError('PREVIEW_BUSY', '미리보기 생성이 진행 중입니다.'))
    const snapshot = { slide: parseSlide(raw.slide), style: GlobalStyle.parse(raw.style) }
    return new Promise((resolve, reject) => {
      this.current = {
        id: randomUUID(),
        snapshot,
        resolve,
        reject,
        timer: setTimeout(() => this.fail(), 8000),
      }
      if (!this.window || this.window.isDestroyed()) {
        this.ready = false
        const window = new BrowserWindow({
          show: false,
          width: 960,
          height: 540,
          useContentSize: true,
          webPreferences: {
            preload: path.join(this.root, 'dist-electron', 'preload.mjs'),
            additionalArguments: ['--propre-role=preview'],
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            offscreen: true,
            backgroundThrottling: false,
          },
        })
        this.window = window
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        window.webContents.on('will-navigate', (e) => e.preventDefault())
        window.webContents.on('render-process-gone', () => this.fail())
        window.once('closed', () => {
          this.ready = false
          this.window = undefined
          this.fail()
        })
        const url = this.devURL
          ? `${this.devURL}/?role=preparation-preview`
          : 'app://propre/index.html?role=preparation-preview'
        void window.loadURL(url).catch(() => this.fail())
      } else this.deliver()
    })
  }
  private finish() {
    if (this.current) clearTimeout(this.current.timer)
    this.current = undefined
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('ai-preview', null)
  }
  private fail() {
    this.current?.reject(
      new PreparationError(
        'PREVIEW_FAILED',
        '미리보기를 생성하지 못했습니다. 앱에서 슬라이드를 확인해주세요.',
      ),
    )
    this.finish()
  }
  dispose() {
    this.fail()
    this.window?.destroy()
    this.window = undefined
    this.ready = false
  }
}
