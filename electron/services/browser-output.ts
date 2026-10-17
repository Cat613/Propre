import { BrowserWindow, WebContentsView, session, screen, type Rectangle } from 'electron'
import { randomUUID } from 'node:crypto'
import { normalizeWebURL, type ExternalOutputStatus } from '../../shared/output-resources'
export class BrowserOutput {
  view: WebContentsView | undefined
  private host: BrowserWindow | undefined
  private preparation: BrowserWindow | undefined
  private partition = `propre-output-${randomUUID()}`
  lastImage: string | undefined
  crashed = false
  live = false
  loading = false
  muted = true
  resourceId = ''
  private dimensions = { width: 1280, height: 720 }
  private capturing = false
  private timer: ReturnType<typeof setInterval> | undefined
  private sequence = 0
  private loadGeneration = 0
  private ready = false
  constructor(
    private notify: (channel: string, value: unknown) => void,
    private generation: () => number,
    private emergencyStop: () => void,
  ) {}
  status(): ExternalOutputStatus['browser'] {
    if (!this.view || this.view.webContents.isDestroyed()) return undefined
    return {
      resourceId: this.resourceId,
      url: this.view.webContents.getURL(),
      loading: this.loading,
      muted: this.muted,
      zoom: this.view.webContents.getZoomFactor(),
      live: this.live,
    }
  }
  private check(url: string) {
    try {
      normalizeWebURL(url, false)
      return true
    } catch {
      return false
    }
  }
  async prepare(resourceId: string, url: string, bounds: Rectangle) {
    if (this.live) throw new Error('현재 웹 송출을 끝낸 뒤 다른 주소를 준비해주세요.')
    this.reset()
    const loadGeneration = ++this.loadGeneration
    this.resourceId = resourceId
    this.dimensions = { width: bounds.width, height: bounds.height }
    const ses = session.fromPartition(this.partition, { cache: false })
    ses.setPermissionCheckHandler(() => false)
    ses.setPermissionRequestHandler((_w, _p, callback) => callback(false))
    ses.webRequest.onBeforeRequest((details, callback) => {
      const protocol = new URL(details.url).protocol
      callback({ cancel: !['http:', 'https:', 'ws:', 'wss:', 'blob:', 'data:'].includes(protocol) })
    })
    ses.removeAllListeners('will-download')
    ses.on('will-download', (event) => {
      event.preventDefault()
      this.notify('operation-warning', '송출 브라우저에서는 다운로드를 지원하지 않습니다.')
    })
    this.view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
      },
    })
    const contents = this.view.webContents
    contents.setAudioMuted(true)
    contents.setWindowOpenHandler(() => {
      this.notify(
        'operation-warning',
        '새 창이 필요한 페이지는 송출 브라우저에서 지원하지 않습니다.',
      )
      return { action: 'deny' }
    })
    const guardNavigation = (event: Electron.Event, target: string) => {
      if (!this.check(target) || this.live) {
        event.preventDefault()
        this.notify('operation-warning', '페이지 이동은 웹 송출을 끝낸 뒤 준비 화면에서 해주세요.')
      }
    }
    contents.on('will-navigate', guardNavigation)
    contents.on('will-redirect', guardNavigation)
    contents.on('will-frame-navigate', (event) => {
      if (!['http:', 'https:', 'about:'].includes(new URL(event.url).protocol))
        event.preventDefault()
    })
    contents.on('before-input-event', (event, input) => {
      if (input.key === 'F2') {
        event.preventDefault()
        this.emergencyStop()
      }
    })
    contents.on('dom-ready', () => {
      if (contents.debugger.isAttached())
        void contents.debugger
          .sendCommand('Page.setInterceptFileChooserDialog', { enabled: true, cancel: true })
          .catch(() => {})
    })
    contents.on('did-start-loading', () => {
      if (this.ready && !this.live) this.notify('browser-output-navigating', null)
      this.loading = true
      this.notifyStatus()
    })
    contents.on('did-stop-loading', () => {
      this.loading = false
      this.notifyStatus()
    })
    contents.on('render-process-gone', () => {
      this.crashed = true
      if (this.host && !this.host.isDestroyed() && this.view)
        this.host.contentView.removeChildView(this.view)
      this.host = undefined
      this.live = false
      this.notify('browser-output-crashed', this.lastImage)
      this.notify(
        'operation-warning',
        '웹 화면이 중단되었습니다. 마지막 미리보기를 확인하고 슬라이드로 복귀해주세요.',
      )
      this.notifyStatus()
    })
    this.showPreparation()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await contents.loadURL('about:blank')
      contents.debugger.attach('1.3')
      await contents.debugger.sendCommand('Page.enable', { enableFileChooserOpenedEvent: true })
      await contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', {
        enabled: true,
        cancel: true,
      })
      contents.debugger.on('message', (_event, method) => {
        if (method === 'Page.fileChooserOpened')
          this.notify('operation-warning', '파일 업로드는 송출 브라우저에서 지원하지 않습니다.')
      })
      await Promise.race([
        contents.loadURL(normalizeWebURL(url, false)),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('웹페이지 로딩 시간이 초과되었습니다. 다시 준비해주세요.')),
            30000,
          )
        }),
      ])
      await contents.debugger.sendCommand('Page.enable', { enableFileChooserOpenedEvent: true })
      await contents.debugger.sendCommand('Page.setInterceptFileChooserDialog', {
        enabled: true,
        cancel: true,
      })
      if (loadGeneration !== this.loadGeneration || contents.isDestroyed())
        throw new Error('웹 준비가 취소되었습니다.')
      // Intercept native upload pickers; the source browser never receives a local file grant.

      const image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      if (image.isEmpty()) throw new Error('웹페이지 화면을 준비하지 못했습니다.')
      this.ready = true
      this.timer = setInterval(() => void this.capture(), 200)
      this.notifyStatus()
    } catch (error) {
      if (loadGeneration === this.loadGeneration) this.reset()
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
  private notifyStatus() {
    this.notify('browser-output-changed', this.status())
  }
  private attach(win: BrowserWindow) {
    if (!this.view || this.view.webContents.isDestroyed())
      throw new Error('웹페이지를 다시 준비해주세요.')
    if (this.host && !this.host.isDestroyed()) this.host.contentView.removeChildView(this.view)
    this.host = win
    win.contentView.addChildView(this.view)
    const bounds = win.getContentBounds()
    this.view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
  }
  showPreparation(reveal = true) {
    if (this.live) throw new Error('웹 송출을 끝낸 뒤 조작 창을 열어주세요.')
    if (!this.preparation || this.preparation.isDestroyed()) {
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
      this.preparation = new BrowserWindow({
        title: 'ProPre · 웹 준비 (F2 전체 중지)',
        show: false,
        width: Math.min(this.dimensions.width, Math.max(480, area.width - 48)),
        height: Math.min(this.dimensions.height, Math.max(320, area.height - 48)),
        useContentSize: true,
        resizable: true,
        minWidth: 480,
        minHeight: 320,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      this.preparation.on('resize', () => {
        if (
          this.live ||
          this.host !== this.preparation ||
          !this.view ||
          this.view.webContents.isDestroyed()
        )
          return
        const bounds = this.preparation!.getContentBounds()
        this.view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height })
        if (this.ready) this.notify('browser-output-resized', null)
      })
      this.preparation.on('close', (event) => {
        event.preventDefault()
        this.preparation?.hide()
      })
    }
    this.attach(this.preparation)
    if (reveal && process.env.PROPRE_TEST_HEADLESS !== '1') this.preparation.show()
  }
  async commit(win: BrowserWindow) {
    const view = this.view,
      generation = this.loadGeneration
    this.live = true
    try {
      this.attach(win)
      this.preparation?.hide()
      const frame = await this.view!.webContents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      })
      if (view !== this.view || generation !== this.loadGeneration || this.crashed)
        throw new Error('웹 송출이 취소되었습니다.')
      if (frame.isEmpty()) throw new Error('웹 송출 화면을 확인하지 못했습니다.')
    } catch (e) {
      if (view === this.view && generation === this.loadGeneration) {
        this.live = false
        this.showPreparation(false)
      }
      throw e
    }
    this.notifyStatus()
  }
  resize(win: BrowserWindow) {
    if (this.live && this.host === win && this.view && !this.view.webContents.isDestroyed()) {
      const b = win.getContentBounds()
      this.view.setBounds({ x: 0, y: 0, width: b.width, height: b.height })
    }
  }
  detach() {
    if (!this.live) return
    this.live = false
    this.mute(true)
    if (this.view && !this.view.webContents.isDestroyed() && !this.crashed) {
      this.showPreparation(false)
      this.preparation?.hide()
    }
    this.notifyStatus()
  }
  mute(value: boolean) {
    this.muted = value
    if (this.view && !this.view.webContents.isDestroyed())
      this.view.webContents.setAudioMuted(value)
  }
  private async capture() {
    if (this.capturing || this.crashed || !this.view || this.view.webContents.isDestroyed()) return
    this.capturing = true
    const contents = this.view.webContents,
      generation = this.generation()
    try {
      const frame = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      if (
        !frame.isEmpty() &&
        contents === this.view?.webContents &&
        generation === this.generation()
      ) {
        const image = frame.resize({ width: Math.min(960, frame.getSize().width) }),
          bytes = image.toJPEG(65)
        if (bytes.length <= 1024 * 1024) {
          this.lastImage = `data:image/jpeg;base64,${bytes.toString('base64')}`
          this.notify('browser-output-frame', {
            generation,
            sequence: ++this.sequence,
            resourceId: this.resourceId,
            width: frame.getSize().width,
            height: frame.getSize().height,
            timestamp: Date.now(),
            image: `data:image/jpeg;base64,${bytes.toString('base64')}`,
          })
        }
      }
    } catch {
      /* Capture is a preview; native output remains independent. */
    } finally {
      this.capturing = false
    }
  }
  reset() {
    this.ready = false
    this.crashed = false
    this.lastImage = undefined
    this.loadGeneration++
    clearInterval(this.timer)
    this.timer = undefined
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.webContents.setAudioMuted(true)
      if (this.host && !this.host.isDestroyed()) this.host.contentView.removeChildView(this.view)
      this.view.webContents.close()
    }
    this.view = undefined
    this.host = undefined
    this.live = false
    this.muted = true
    this.loading = false
    this.preparation?.destroy()
    this.preparation = undefined
  }
  async dispose() {
    this.reset()
    await session.fromPartition(this.partition).clearStorageData()
  }
}
