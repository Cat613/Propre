import { app, BrowserWindow, ipcMain, screen, dialog, safeStorage } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import Store from 'electron-store'

// ES module compatibility
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Initialize Electron Store with Schema Validation
const store = new Store({
  schema: {
    library: { type: 'array', default: [] },
    playlist: { type: 'array', default: [] },
    outputDisplayId: { type: ['number', 'null'], default: null },
    stageDisplayId: { type: ['number', 'null'], default: null },
    wasOutputActive: { type: 'boolean', default: false },
    wasStageActive: { type: 'boolean', default: false },
    geminiKeyEncrypted: { type: ['string', 'null'] },
    geminiKeyFallback: { type: ['string', 'null'] }
  }
})
process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(__dirname, '../public')

let mainWindow: BrowserWindow | null
const outputWindows: Map<string, BrowserWindow> = new Map() // ID -> Window
let stageWindow: BrowserWindow | null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(`${VITE_DEV_SERVER_URL}#control-panel`)
  } else {
    mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'), { hash: 'control-panel' })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function getTargetDisplay(storeKey: string) {
  const displays = screen.getAllDisplays()
  const savedId = store.get(storeKey)
  if (savedId) {
    const found = displays.find(d => d.id === savedId)
    if (found) return found
  }
  const externalDisplay = displays.find((display) => display.bounds.x !== 0 || display.bounds.y !== 0)
  return externalDisplay || screen.getPrimaryDisplay()
}

// Create a specific output window (e.g. 'main', 'chroma')
function createOutputWindow(id: string = 'main') {
  const storeKey = id === 'main' ? 'outputDisplayId' : `outputDisplayId_${id}`
  const targetDisplay = getTargetDisplay(storeKey)

  const existingWin = outputWindows.get(id)
  if (existingWin && !existingWin.isDestroyed()) {
    existingWin.removeAllListeners('closed')
    existingWin.close()
  }
  outputWindows.delete(id)

  const win = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
    fullscreen: true,
    frame: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: false,
      additionalArguments: [`--screen-id=${id}`]
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(`${VITE_DEV_SERVER_URL}#output-display?screenId=${id}`)
  } else {
    win.loadFile(path.join(process.env.DIST!, 'index.html'), { hash: `output-display?screenId=${id}` })
  }

  win.on('closed', () => {
    if (outputWindows.get(id) === win) {
      outputWindows.delete(id)
      if (id === 'main') {
        store.set('wasOutputActive', false)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('output-status-changed', false)
        }
      }
    }
  })

  outputWindows.set(id, win)

  if (id === 'main') {
    store.set('wasOutputActive', true)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('output-status-changed', true)
    }
  }
}

function createStageWindow() {
  const targetDisplay = getTargetDisplay('stageDisplayId')
  const wasVisible = stageWindow && !stageWindow.isDestroyed() ? stageWindow.isVisible() : false

  if (stageWindow && !stageWindow.isDestroyed()) {
    stageWindow.removeAllListeners('closed')
    stageWindow.close()
  }
  stageWindow = null

  const win = new BrowserWindow({
    x: targetDisplay.bounds.x + 100,
    y: targetDisplay.bounds.y + 100,
    width: 800,
    height: 600,
    show: wasVisible,
    frame: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: false,
    },
    title: 'Stage Display (Confidence Monitor)'
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(`${VITE_DEV_SERVER_URL}#stage-display`)
  } else {
    win.loadFile(path.join(process.env.DIST!, 'index.html'), { hash: 'stage-display' })
  }

  win.on('closed', () => {
    if (stageWindow === win) {
      stageWindow = null
      store.set('wasStageActive', false)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('stage-status-changed', false)
      }
    }
  })

  stageWindow = win
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
    if (store.get('wasOutputActive', false)) {
      createOutputWindow('main')
    }
    if (store.get('wasStageActive', false)) {
      createStageWindow()
    }
  }
})

app.whenReady().then(() => {
  createMainWindow()

  if (store.get('wasOutputActive', false)) {
    createOutputWindow('main')
  }
  if (store.get('wasStageActive', false)) {
    createStageWindow()
  }

  ipcMain.on('update-output', (_event, text: string) => {
    outputWindows.forEach(win => {
      if (!win.isDestroyed()) win.webContents.send('update-output', text)
    })
  })

  ipcMain.on('route-screen-update', (_event, payloadStr: string) => {
    try {
      const payload = JSON.parse(payloadStr)
      const screenId = payload.screenId
      const win = outputWindows.get(screenId)
      if (win && !win.isDestroyed()) {
        win.webContents.send('update-screen', payload.data)
      }
    } catch (e) {
      console.error("Routing error:", e)
    }
  })

  ipcMain.on('update-stage', (_event, data: string) => {
    if (stageWindow && !stageWindow.isDestroyed()) {
      stageWindow.webContents.send('update-stage', data)
    }
  })

  ipcMain.handle('toggle-stage', () => {
    if (!stageWindow || stageWindow.isDestroyed()) {
      createStageWindow()
    }

    if (stageWindow) {
      if (stageWindow.isVisible()) {
        stageWindow.hide()
        store.set('wasStageActive', false)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('stage-status-changed', false)
        }
        return false
      } else {
        stageWindow.show()
        store.set('wasStageActive', true)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('stage-status-changed', true)
        }
        return true
      }
    }
    store.set('wasStageActive', false)
    return false
  })

  ipcMain.handle('toggle-output', () => {
    const mainWin = outputWindows.get('main')
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.removeAllListeners('closed')
      mainWin.close()
      outputWindows.delete('main')
      store.set('wasOutputActive', false)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('output-status-changed', false)
      }
      return false
    } else {
      createOutputWindow('main')
      return true
    }
  })

  ipcMain.handle('get-output-status', () => {
    const mainWin = outputWindows.get('main')
    return Boolean(mainWin && !mainWin.isDestroyed())
  })

  ipcMain.handle('get-stage-status', () => {
    return Boolean(stageWindow && !stageWindow.isDestroyed() && stageWindow.isVisible())
  })

  ipcMain.handle('get-displays', () => {
    return screen.getAllDisplays().map(d => ({
      id: d.id,
      label: d.label || `Display ${d.id}`,
      bounds: d.bounds
    }))
  })

  ipcMain.handle('get-active-displays', () => {
    return {
      output: store.get('outputDisplayId'),
      stage: store.get('stageDisplayId')
    }
  })

  ipcMain.handle('set-output-display', (_event, displayId) => {
    store.set('outputDisplayId', displayId)
    const mainWin = outputWindows.get('main')
    if (mainWin && !mainWin.isDestroyed()) {
      createOutputWindow('main') // Reposition only if active
    }
    return true
  })

  ipcMain.handle('set-stage-display', (_event, displayId) => {
    store.set('stageDisplayId', displayId)
    if (stageWindow && !stageWindow.isDestroyed() && stageWindow.isVisible()) {
      createStageWindow() // Reposition only if active
    }
    return true
  })

  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media Files', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm', 'mp3', 'wav'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) return []

    const userDataPath = app.getPath('userData')
    const mediaDir = path.join(userDataPath, 'media')
    try {
      await fs.mkdir(mediaDir, { recursive: true })
    } catch (e) {
      console.error('Failed to create media directory', e)
    }

    const copiedPaths: string[] = []

    for (const filePath of result.filePaths) {
      try {
        const fileName = path.basename(filePath)
        const timestamp = Date.now()
        const destFileName = `${timestamp}_${fileName}`
        const destPath = path.join(mediaDir, destFileName)

        await fs.copyFile(filePath, destPath)
        copiedPaths.push(destPath)
      } catch (err) {
        console.error(`Failed to copy file from ${filePath}`, err)
      }
    }

    return copiedPaths
  })

  ipcMain.handle('save-project', async (_event, data: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '프로젝트 저장',
      defaultPath: 'presentation.ppros',
      filters: [{ name: 'ProPresenter Project', extensions: ['ppros', 'json'] }],
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    try {
      await fs.writeFile(result.filePath, data, 'utf-8')
      return { success: true, filePath: result.filePath }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('load-project', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '프로젝트 열기',
      properties: ['openFile'],
      filters: [{ name: 'ProPresenter Project', extensions: ['ppros', 'json'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true }
    try {
      const data = await fs.readFile(result.filePaths[0], 'utf-8')
      return { success: true, data, filePath: result.filePaths[0] }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('get-library', () => store.get('library', []))
  ipcMain.handle('save-to-library', (_event, presentation) => {
    const library = (store.get('library', []) as any[])
    const index = library.findIndex((p) => p.id === presentation.id)
    if (index !== -1) library[index] = presentation
    else library.push(presentation)
    store.set('library', library)
    return true
  })
  ipcMain.handle('delete-from-library', (_event, id) => {
    const library = (store.get('library', []) as any[])
    const newLibrary = library.filter((p) => p.id !== id)
    store.set('library', newLibrary)
    return newLibrary
  })
  ipcMain.handle('merge-to-library', (_event, presentations: any[]) => {
    const library = (store.get('library', []) as any[])
    for (const p of presentations) {
      const index = library.findIndex((ext) => ext.id === p.id)
      if (index !== -1) library[index] = p
      else library.push(p)
    }
    store.set('library', library)
    return library
  })
  ipcMain.handle('get-playlist', () => store.get('playlist', []))
  ipcMain.handle('save-playlist', (_event, playlist) => {
    store.set('playlist', playlist)
    return true
  })

  ipcMain.handle('set-api-key', (_event, key: string | null) => {
    if (!key) {
      store.delete('geminiKeyEncrypted')
      store.delete('geminiKeyFallback')
      return
    }
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(key)
      store.set('geminiKeyEncrypted', encrypted.toString('base64'))
    } else {
      console.warn('[safeStorage] Encryption not available, storing key as plain text.')
      store.set('geminiKeyFallback', key)
    }
  })

  ipcMain.handle('get-api-key', (): string | null => {
    if (safeStorage.isEncryptionAvailable()) {
      const b64 = store.get('geminiKeyEncrypted') as string | undefined
      if (!b64) return null
      try {
        return safeStorage.decryptString(Buffer.from(b64, 'base64'))
      } catch {
        return null
      }
    } else {
      return (store.get('geminiKeyFallback') as string | undefined) ?? null
    }
  })
})
