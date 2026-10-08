import { beforeEach, describe, it, expect, vi } from 'vitest'
const fake = vi.hoisted(() => {
  let id = 0
  class Window {
    webContents = {
      id: ++id,
      mainFrame: { url: 'app://propre/index.html' },
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      reload: vi.fn(),
    }
    handlers = new Map<string, ((...args: any[]) => void)[]>()
    destroyed = false
    visible = false
    options: any
    constructor(options: any) {
      this.options = options
    }
    on(name: string, callback: (...args: any[]) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) || []), callback])
    }
    once(name: string, callback: (...args: any[]) => void) {
      this.on(name, callback)
    }
    emit(name: string, ...args: any[]) {
      this.handlers.get(name)?.forEach((f) => f(...args))
    }
    isDestroyed() {
      return this.destroyed
    }
    isVisible() {
      return this.visible
    }
    show() {
      this.visible = true
    }
    focus() {}
    setTitle() {}
    setBounds() {}
    close() {
      this.destroy()
    }
    destroy() {
      this.destroyed = true
      this.emit('closed')
    }
    loadURL = vi.fn(async () => {})
  }
  const displays = [
    { id: 1, label: 'primary', bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 2, label: 'external', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
  ]
  return { Window, displays }
})
vi.mock('electron', () => ({
  app: { dock: { setMenu: vi.fn() } },
  BrowserWindow: fake.Window,
  Menu: { buildFromTemplate: vi.fn((x) => x), setApplicationMenu: vi.fn() },
  screen: {
    getAllDisplays: () => fake.displays,
    getPrimaryDisplay: () => fake.displays[0],
    on: vi.fn(),
  },
}))
import { WindowManager, WINDOW_TITLES } from '../electron/services/windows'
import type { Repository } from '../electron/services/repository'
let manager: WindowManager, repo: Repository
beforeEach(() => {
  repo = {
    state: { outputDisplayId: 2, stageDisplayId: 2, wasStageActive: true, wasOutputActive: false },
    warnings: [],
    assertAssets: vi.fn(),
    transaction: vi.fn(async (fn) => fn(repo.state)),
  } as unknown as Repository
  manager = new WindowManager(repo, '/fixture', undefined)
})
const output = {
  type: 'state-update',
  layers: {
    audio: null,
    background: { type: 'none' },
    slide: { id: 's', type: 'text', content: 'current' },
    announcement: null,
    props: [],
    message: null,
  },
}
describe('window coordination and IPC permissions', () => {
  it('tracks control initialization separately from merely creating a window', () => {
    const win = manager.create('control')
    expect(manager.isControlReady()).toBe(false)
    manager.ready('control')
    expect(manager.isControlReady()).toBe(true)
    win.destroy()
    expect(manager.isControlReady()).toBe(false)
    manager.create('control')
    expect(manager.isControlReady()).toBe(false)
  })
  it('sets distinct native titles with sandbox and web security', () => {
    for (const role of ['control', 'main', 'stage'] as const) {
      const win = manager.create(role) as unknown as InstanceType<typeof fake.Window>
      expect(win.options.title).toBe(WINDOW_TITLES[role])
      expect(win.options.webPreferences).toMatchObject({
        sandbox: true,
        webSecurity: true,
        contextIsolation: true,
        nodeIntegration: false,
      })
    }
    expect(new Set(Object.values(WINDOW_TITLES)).size).toBe(3)
  })
  it('restores the stage visibly after renderer readiness', async () => {
    await manager.restore()
    const stage = manager.windows.get('stage') as unknown as InstanceType<typeof fake.Window>
    stage.emit('ready-to-show')
    expect(stage.visible).toBe(true)
  })
  it('replays the cached whole state when an output opens late and after replacement', async () => {
    manager.publishOutput(output)
    manager.create('main')
    manager.ready('main')
    let win = manager.windows.get('main')!
    expect(win.webContents.send).toHaveBeenCalledWith(
      'update-screen',
      expect.stringContaining('current'),
    )
    await manager.setDisplay('main', 1)
    win = manager.windows.get('main')!
    manager.ready('main')
    expect(win.webContents.send).toHaveBeenCalledWith(
      'update-screen',
      expect.stringContaining('current'),
    )
  })
  it('reports applied only for the latest version', () => {
    manager.publishOutput(output)
    manager.publishOutput({ ...output, layers: { ...output.layers, slide: null } })
    const latest = manager.allHealth().find((h) => h.screen === 'main')!.version
    manager.acknowledge('main', latest - 1)
    expect(manager.allHealth().find((h) => h.screen === 'main')!.status).not.toBe('applied')
    manager.acknowledge('main', latest)
    expect(manager.allHealth().find((h) => h.screen === 'main')!.status).toBe('applied')
  })
  it('reopens control even if output still exists', () => {
    manager.create('main')
    manager.create('control')
    const control = manager.windows.get('control')!
    control.destroy()
    expect(manager.windows.has('main')).toBe(true)
    manager.create('control')
    expect(manager.windows.get('control')).not.toBe(control)
  })
  it('rejects output mutation requests and subframe impersonation', () => {
    const win = manager.create('main')
    expect(() =>
      manager.authorize(
        { sender: win.webContents, senderFrame: win.webContents.mainFrame } as any,
        ['control'],
      ),
    ).toThrow()
    const control = manager.create('control')
    expect(() =>
      manager.authorize(
        { sender: control.webContents, senderFrame: { url: 'app://propre/index.html' } } as any,
        ['control'],
      ),
    ).toThrow()
    expect(
      manager.authorize(
        { sender: control.webContents, senderFrame: control.webContents.mainFrame } as any,
        ['control'],
      ),
    ).toBe('control')
  })
  it('blocks external navigation and missing displays', async () => {
    expect(manager.allowed('https://evil.example')).toBe(false)
    await expect(manager.setDisplay('main', 999)).rejects.toThrow()
  })
})
