import { app, BrowserWindow, ipcMain, screen, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import Store from 'electron-store'

// ES module compatibility
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Initialize Electron Store
const store = new Store()

// The built directory structure
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
  // We use different settings keys for different screens
  const storeKey = id === 'main' ? 'outputDisplayId' : `outputDisplayId_${id}`
  const targetDisplay = getTargetDisplay(storeKey)

  let win = outputWindows.get(id)

  if (win && !win.isDestroyed()) {
    win.close()
  }

  win = new BrowserWindow({
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
      additionalArguments: [`--screen-id=${id}`] // Pass ID to renderer
    },
  })

  // Append screenId to URL hash
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(`${VITE_DEV_SERVER_URL}#output-display?screenId=${id}`)
  } else {
    // Note: loadFile with query params in hash requires simple encoding
    win.loadFile(path.join(process.env.DIST!, 'index.html'), { hash: `output-display?screenId=${id}` })
  }

  win.on('closed', () => {
    outputWindows.delete(id)
  })

  outputWindows.set(id, win)
}

function createStageWindow() {
  const targetDisplay = getTargetDisplay('stageDisplayId')
  const wasVisible = stageWindow && !stageWindow.isDestroyed() ? stageWindow.isVisible() : false

  if (stageWindow && !stageWindow.isDestroyed()) {
    stageWindow.close()
  }

  stageWindow = new BrowserWindow({
    x: targetDisplay.bounds.x + 100,
    y: targetDisplay.bounds.y + 100,
    width: 800,
    height: 600,
    show: wasVisible, // Keep previous visibility state
    frame: true, // Stage window might need move/resize
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      webSecurity: false,
    },
    title: 'Stage Display (Confidence Monitor)'
  })

  if (VITE_DEV_SERVER_URL) {
    stageWindow.loadURL(`${VITE_DEV_SERVER_URL}#stage-display`)
  } else {
    stageWindow.loadFile(path.join(process.env.DIST!, 'index.html'), { hash: 'stage-display' })
  }

  stageWindow.on('closed', () => {
    stageWindow = null
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
    // Restore previously active screens later
    createOutputWindow('main')
    createStageWindow()
  }
})

app.whenReady().then(() => {
  createMainWindow()
  createOutputWindow('main')
  createStageWindow()

  // IPC: Update Specific Screen (Phase 2 Routing)
  // Listen for dynamically created channels (e.g. update-screen-main, update-screen-chroma)
  ipcMain.on('update-output', (_event, text: string) => {
    // Legacy fallback: broadcast to all output windows
    outputWindows.forEach(win => {
      if (!win.isDestroyed()) win.webContents.send('update-output', text)
    })
  })

  // Since we construct channel dynamically in frontend: `window.ipcRenderer.send('update-screen-main', ...)`
  // We need to listen dynamically, or intercept. A better approach is an explicit routing event:
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

  // IPC: Update Stage
  ipcMain.on('update-stage', (_event, data: string) => {
    if (stageWindow && !stageWindow.isDestroyed()) {
      stageWindow.webContents.send('update-stage', data)
    }
  })

  // IPC: Toggle Stage
  ipcMain.handle('toggle-stage', () => {
    if (!stageWindow || stageWindow.isDestroyed()) {
      createStageWindow()
    }

    if (stageWindow) { // Check again after potential creation
      if (stageWindow.isVisible()) {
        stageWindow.hide()
        return false
      } else {
        stageWindow.show()
        // Ensure it's fullscreen or positioned correctly if needed, but stage is usually just a window
        return true
      }
    }
    return false
  })

  // IPC: Toggle Output (Toggles the physical 'main' output window)
  ipcMain.handle('toggle-output', () => {
    const mainWin = outputWindows.get('main')
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.close()
      outputWindows.delete('main')

      return false
    } else {
      createOutputWindow('main')
      return true
    }
  })

  // IPC: Display Management
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
    createOutputWindow('main') // Reboot main on same ID
    return true
  })

  ipcMain.handle('set-stage-display', (_event, displayId) => {
    store.set('stageDisplayId', displayId)
    createStageWindow()
    return true
  })

  // IPC: File Dialog & Copy Media
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media Files', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'webm', 'mp3', 'wav'] },
      ],
    })

    if (result.canceled || result.filePaths.length === 0) return []

    // Ensure media directory exists in userData
    const userDataPath = app.getPath('userData')
    const mediaDir = path.join(userDataPath, 'media')
    try {
      await fs.mkdir(mediaDir, { recursive: true })
    } catch (e) {
      console.error('Failed to create media directory', e)
    }

    const copiedPaths: string[] = []

    // Copy selected files to app's media directory
    for (const filePath of result.filePaths) {
      try {
        const fileName = path.basename(filePath)
        const timestamp = Date.now()
        // Prevent name collisions by prefixing timestamp
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

  // IPC: Save Project (File)
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

  // IPC: Load Project (File)
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

  // IPC: Library & Playlist Management
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
  ipcMain.handle('get-playlist', () => store.get('playlist', []))
  ipcMain.handle('save-playlist', (_event, playlist) => {
    store.set('playlist', playlist)
    return true
  })
})
