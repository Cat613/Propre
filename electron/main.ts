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
let outputWindow: BrowserWindow | null
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

function createOutputWindow() {
  const targetDisplay = getTargetDisplay('outputDisplayId')

  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.close()
  }

  outputWindow = new BrowserWindow({
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
    },
  })

  if (VITE_DEV_SERVER_URL) {
    outputWindow.loadURL(`${VITE_DEV_SERVER_URL}#output-display`)
  } else {
    outputWindow.loadFile(path.join(process.env.DIST!, 'index.html'), { hash: 'output-display' })
  }
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
    createOutputWindow()
    createStageWindow()
  }
})

app.whenReady().then(() => {
  createMainWindow()
  createOutputWindow()
  createStageWindow()

  // IPC: Update Output
  ipcMain.on('update-output', (_event, text: string) => {
    if (outputWindow && !outputWindow.isDestroyed()) {
      outputWindow.webContents.send('update-output', text)
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

  // IPC: Toggle Output
  ipcMain.handle('toggle-output', () => {
    if (outputWindow && !outputWindow.isDestroyed()) {
      // If it exists, we turn it off completely so the screen returns to normal desktop
      outputWindow.close()
      outputWindow = null
      return false
    } else {
      // If it doesn't exist, we turn it on
      createOutputWindow()
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
    createOutputWindow()
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
