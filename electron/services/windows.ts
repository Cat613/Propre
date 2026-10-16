import type { VisualSource } from '../../shared/output-resources'
import {
  app,
  BrowserWindow,
  Menu,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron'
import path from 'node:path'
import type { Repository } from './repository'
import { boundedJSON, parseOutput, parseStage } from '../../shared/schema'
import type { OutputState, StageData } from '../../src/types'
import type { ScreenHealth } from '../../shared/contracts'
export type Role = 'control' | 'main' | 'stage'
export const WINDOW_TITLES: Record<Role, string> = {
  control: 'ProPre · 컨트롤',
  main: 'ProPre · 메인 송출',
  stage: 'ProPre · 모니터',
}
export class WindowManager {
  readonly windows = new Map<Role, BrowserWindow>()
  readonly roles = new Map<number, Role>()
  private snapshots = new Map<
    'main' | 'stage',
    { version: number; data: OutputState | StageData }
  >()
  private health = new Map<'main' | 'stage', ScreenHealth>()
  private sequence = 0
  visualSource: VisualSource = { kind: 'slides' }
  onEmergencyStop: (() => void) | undefined
  onStageReady: (() => void) | undefined
  onStageClosed: (() => void) | undefined
  onMainCreated: ((win: BrowserWindow) => void) | undefined
  onMainClosing: ((win: BrowserWindow) => void) | undefined
  onMainResize: ((win: BrowserWindow) => void) | undefined
  private appliedWaiters = new Map<
    number,
    { resolve: () => void; reject: () => void; timer: ReturnType<typeof setTimeout> }
  >()
  private changing = new Set<Role>()
  private retries = new Map<Role, number>()
  private controlReady = false
  onControlClose: ((event: Electron.Event) => void) | undefined
  constructor(
    private repo: Repository,
    private root: string,
    private devURL: string | undefined,
  ) {}
  allowed(url: string): boolean {
    try {
      const u = new URL(url)
      return this.devURL
        ? u.origin === new URL(this.devURL).origin
        : u.protocol === 'app:' && u.hostname === 'propre'
    } catch {
      return false
    }
  }
  authorize(event: IpcMainEvent | IpcMainInvokeEvent, roles: Role[]): Role {
    const role = this.roles.get(event.sender.id),
      win = role && this.windows.get(role)
    if (
      !role ||
      !roles.includes(role) ||
      !win ||
      win.isDestroyed() ||
      event.senderFrame !== event.sender.mainFrame ||
      !this.allowed(event.senderFrame.url)
    )
      throw new Error('허용되지 않은 요청입니다.')
    return role
  }
  notify(channel: string, data: unknown): void {
    const control = this.windows.get('control')
    if (control && !control.isDestroyed()) control.webContents.send(channel, data)
  }
  status(role: 'main' | 'stage'): boolean {
    const w = this.windows.get(role)
    return !!w && !w.isDestroyed() && w.isVisible()
  }
  private emitHealth(role: 'main' | 'stage', patch: Partial<ScreenHealth>): void {
    const current = this.health.get(role) || {
      screen: role,
      version: 0,
      applied: 0,
      status: 'closed',
    }
    const next = { ...current, ...patch }
    this.health.set(role, next)
    this.notify('screen-health', next)
  }
  live(): OutputState | null {
    return this.windows.has('main') || this.windows.has('stage')
      ? (this.snapshots.get('main')?.data as OutputState) || null
      : null
  }
  stageLive(): StageData | null {
    return (this.snapshots.get('stage')?.data as StageData) || null
  }
  allHealth(): ScreenHealth[] {
    return (['main', 'stage'] as const).map(
      (screenId) =>
        this.health.get(screenId) || {
          screen: screenId,
          version: this.snapshots.get(screenId)?.version || 0,
          applied: 0,
          status: 'closed',
        },
    )
  }
  publishOutput(raw: unknown): void {
    const value = typeof raw === 'string' ? boundedJSON(raw) : raw
    const data = parseOutput(value)
    this.repo.assertAssets(data)
    this.publish('main', { ...data, source: this.visualSource })
  }
  publishStage(raw: unknown): void {
    const value = typeof raw === 'string' ? boundedJSON(raw) : raw
    this.publish('stage', { ...parseStage(value), source: this.visualSource })
  }
  private publish(role: 'main' | 'stage', data: OutputState | StageData): number {
    const version = ++this.sequence
    this.snapshots.set(role, { version, data })
    this.emitHealth(role, { version, status: this.status(role) ? 'loading' : 'closed' })
    this.deliver(role)
    return version
  }
  outputVersion() {
    return this.snapshots.get('main')?.version || 0
  }
  setVisualSource(source: VisualSource) {
    this.visualSource = source
    const output = this.snapshots.get('main')?.data as OutputState | undefined
    const version = this.publish('main', {
      ...(output || {
        type: 'state-update',
        layers: {
          audio: null,
          background: { type: 'none' },
          slide: null,
          announcement: null,
          props: [],
          message: null,
        },
      }),
      source,
    })
    const stage = this.snapshots.get('stage')?.data as StageData | undefined
    this.publish('stage', { ...(stage || { current: null, next: null }), source })
    return version
  }
  blank() {
    this.visualSource = { kind: 'slides' }
    this.publish('main', {
      type: 'state-update',
      source: this.visualSource,
      layers: {
        audio: null,
        background: { type: 'none' },
        slide: null,
        announcement: null,
        props: [],
        message: null,
      },
    })
    this.publish('stage', { current: null, next: null, source: this.visualSource })
    for (const waiter of this.appliedWaiters.values()) {
      clearTimeout(waiter.timer)
      waiter.reject()
    }
    this.appliedWaiters.clear()
  }
  waitApplied(version: number) {
    if ((this.health.get('main')?.applied || 0) >= version) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.appliedWaiters.delete(version)
        reject(new Error('송출 화면의 표시를 확인하지 못했습니다.'))
      }, 5000)
      this.appliedWaiters.set(version, {
        resolve,
        reject: () => reject(new Error('송출이 중지되었습니다.')),
        timer,
      })
    })
  }
  private deliver(role: 'main' | 'stage'): void {
    const snapshot = this.snapshots.get(role),
      w = this.windows.get(role)
    if (snapshot && w && !w.isDestroyed())
      w.webContents.send(
        role === 'main' ? 'update-screen' : 'update-stage',
        JSON.stringify({ ...snapshot.data, version: snapshot.version }),
      )
  }
  ready(role: Role): void {
    if (role === 'control') {
      this.controlReady = true
      this.retries.set(role, 0)
      for (const h of this.allHealth()) this.notify('screen-health', h)
      return
    }
    this.deliver(role)
    if (role === 'stage') this.onStageReady?.()
  }
  isControlReady(): boolean {
    return this.controlReady
  }
  acknowledge(role: Role, version: number): void {
    if (role === 'control') return
    const snapshot = this.snapshots.get(role)
    if (snapshot && version === snapshot.version) {
      this.emitHealth(role, { applied: version, status: 'applied' })
      if (role === 'main')
        for (const [v, waiter] of this.appliedWaiters)
          if (v <= version) {
            clearTimeout(waiter.timer)
            waiter.resolve()
            this.appliedWaiters.delete(v)
          }
    }
    this.retries.set(role, 0)
  }
  mediaError(role: Role): void {
    if (role !== 'control')
      this.emitHealth(role, {
        status: 'error',
        error: '미디어를 재생하지 못했습니다. 등록 파일과 재생 형식을 확인해주세요.',
      })
    else this.notify('operation-warning', '미디어를 재생하지 못했습니다.')
  }
  outputBounds() {
    return this.display('main').bounds
  }
  private display(role: 'main' | 'stage'): Electron.Display {
    const id = role === 'main' ? this.repo.state.outputDisplayId : this.repo.state.stageDisplayId
    return (
      screen.getAllDisplays().find((d) => d.id === id) ||
      screen.getAllDisplays().find((d) => d.id !== screen.getPrimaryDisplay().id) ||
      screen.getPrimaryDisplay()
    )
  }
  create(role: Role): BrowserWindow {
    const existing = this.windows.get(role)
    if (existing && !existing.isDestroyed()) {
      existing.show()
      existing.focus()
      return existing
    }
    const target = role === 'control' ? null : this.display(role)
    const win = new BrowserWindow({
      title: WINDOW_TITLES[role],
      width: role === 'control' ? 1400 : role === 'stage' ? 800 : target!.bounds.width,
      height: role === 'control' ? 900 : role === 'stage' ? 600 : target!.bounds.height,
      x: target?.bounds.x,
      y: target?.bounds.y,
      fullscreen: role === 'main' && process.env.PROPRE_TEST_HEADLESS !== '1',
      frame: role !== 'main',
      show: false,
      backgroundColor: '#000000',
      webPreferences: {
        preload: path.join(this.root, 'dist-electron/preload.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
        additionalArguments: [`--propre-role=${role}`],
      },
    })
    if (role === 'main') {
      win.on('resize', () => this.onMainResize?.(win))
      win.on('close', () => this.onMainClosing?.(win))
    }
    if (role === 'stage') win.on('resize', () => this.onStageReady?.())
    const contentsId = win.webContents.id
    this.windows.set(role, win)
    this.roles.set(contentsId, role)
    if (role === 'control') {
      this.controlReady = false
      win.webContents.on('did-start-loading', () => {
        this.controlReady = false
      })
    }
    win.on('page-title-updated', (e) => {
      e.preventDefault()
      win.setTitle(WINDOW_TITLES[role])
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event, url) => {
      if (!this.allowed(url)) event.preventDefault()
    })
    win.webContents.on('will-attach-webview', (event) => event.preventDefault())
    win.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F2') {
        event.preventDefault()
        this.onEmergencyStop?.()
      }
    })
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        win.setTitle(WINDOW_TITLES[role])
        if (process.env.PROPRE_TEST_HEADLESS !== '1') win.show()
        if (role !== 'control')
          this.notify(role === 'main' ? 'output-status-changed' : 'stage-status-changed', true)
      }
    })
    win.webContents.on('render-process-gone', () => {
      if (role === 'control') this.controlReady = false
      const attempts = (this.retries.get(role) || 0) + 1
      this.retries.set(role, attempts)
      if (role !== 'control')
        this.emitHealth(role, {
          status: 'error',
          error: '화면이 중단되었습니다. 현재 상태로 다시 연결합니다.',
        })
      if (attempts <= 2 && !win.isDestroyed())
        setTimeout(() => {
          if (!win.isDestroyed()) {
            this.changing.add(role)
            win.destroy()
            this.changing.delete(role)
            this.create(role)
          }
        }, 500)
      else this.notify('operation-warning', '화면 복구에 실패했습니다. 창을 다시 열어주세요.')
    })
    win.webContents.on('did-fail-load', (_e, code) => {
      if (code !== -3 && role !== 'control')
        this.emitHealth(role, { status: 'error', error: '화면을 불러오지 못했습니다.' })
    })
    if (role === 'control') win.on('close', (event) => this.onControlClose?.(event))
    win.on('closed', () => {
      if (role === 'control') this.controlReady = false
      this.roles.delete(contentsId)
      if (this.windows.get(role) === win) this.windows.delete(role)
      if (role === 'stage') this.onStageClosed?.()
      if (role !== 'control' && !this.changing.has(role)) {
        this.emitHealth(role, { status: 'closed' })
        this.notify(role === 'main' ? 'output-status-changed' : 'stage-status-changed', false)
        void this.repo
          .transaction((s) => {
            if (role === 'main') s.wasOutputActive = false
            else s.wasStageActive = false
          })
          .catch(() => this.notify('operation-warning', '창 상태를 저장하지 못했습니다.'))
      }
    })
    const hash =
      role === 'control'
        ? 'control-panel'
        : role === 'main'
          ? 'output-display?screenId=main'
          : 'stage-display'
    void win.loadURL(
      this.devURL
        ? `${this.devURL.replace(/\/+$/, '')}/#${hash}`
        : `app://propre/index.html#${hash}`,
    )
    if (role !== 'control') this.emitHealth(role, { status: 'loading' })
    if (role === 'main') this.onMainCreated?.(win)
    return win
  }
  async toggle(role: 'main' | 'stage'): Promise<boolean> {
    const win = this.windows.get(role)
    if (win) {
      win.close()
      return false
    }
    await this.repo.transaction((s) => {
      if (role === 'main') s.wasOutputActive = true
      else s.wasStageActive = true
    })
    this.create(role)
    return true
  }
  async setDisplay(role: 'main' | 'stage', id: number): Promise<void> {
    if (!screen.getAllDisplays().some((d) => d.id === id))
      throw new Error('연결된 화면을 선택해주세요.')
    await this.repo.transaction((s) => {
      if (role === 'main') s.outputDisplayId = id
      else s.stageDisplayId = id
    })
    if (this.windows.has(role)) {
      this.changing.add(role)
      this.windows.get(role)!.destroy()
      this.changing.delete(role)
      this.create(role)
    }
  }
  async restore(): Promise<void> {
    this.create('control')
    for (const role of ['main', 'stage'] as const)
      if (role === 'main' ? this.repo.state.wasOutputActive : this.repo.state.wasStageActive) {
        const id =
          role === 'main' ? this.repo.state.outputDisplayId : this.repo.state.stageDisplayId
        if (id !== null && !screen.getAllDisplays().some((d) => d.id === id)) {
          this.repo.warnings.push(`${WINDOW_TITLES[role]}의 화면이 연결되어 있지 않습니다.`)
          await this.repo
            .transaction((s) => {
              if (role === 'main') s.wasOutputActive = false
              else s.wasStageActive = false
            })
            .catch(() => {})
        } else this.create(role)
      }
  }
  installMenu(): void {
    const entries = (['control', 'main', 'stage'] as const).map((role) => ({
      label: WINDOW_TITLES[role],
      click: () => {
        if (role === 'control') this.create(role)
        else if (this.windows.has(role)) this.create(role)
        else void this.toggle(role)
      },
    }))
    if (app.dock) app.dock.setMenu(Menu.buildFromTemplate(entries))
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        {
          label: '편집',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
          ],
        },
        {
          label: '창',
          submenu: [...entries, { type: 'separator' }, { role: 'minimize' }, { role: 'front' }],
        },
      ]),
    )
    const changed = () => {
      this.notify('displays-changed', this.displays())
      for (const role of ['main', 'stage'] as const) {
        const win = this.windows.get(role)
        if (!win) continue
        const target =
          role === 'main' ? this.repo.state.outputDisplayId : this.repo.state.stageDisplayId
        if (target !== null && !screen.getAllDisplays().some((d) => d.id === target)) {
          win.close()
          this.notify(
            'operation-warning',
            `${WINDOW_TITLES[role]}의 화면 연결이 해제되어 송출을 중지했습니다.`,
          )
        } else if (role === 'main') {
          const d = this.display(role)
          win.setBounds(d.bounds)
          this.deliver(role)
        }
      }
    }
    screen.on('display-added', changed)
    screen.on('display-removed', changed)
    screen.on('display-metrics-changed', changed)
  }
  displays() {
    return screen.getAllDisplays().map((d) => ({
      id: d.id,
      label: d.label || `화면 ${d.id}`,
      bounds: d.bounds,
      isPrimary: d.id === screen.getPrimaryDisplay().id,
    }))
  }
}
