import { app, BrowserWindow, ipcMain, screen, globalShortcut } from 'electron'
import path from 'path'
import fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { getDb, closeDb } from './db/database'
import { registerFolderHandlers } from './ipc/folders.ipc'
import { registerFileHandlers } from './ipc/files.ipc'
import { registerCategoryHandlers } from './ipc/categories.ipc'
import { registerTagHandlers } from './ipc/tags.ipc'
import { registerFavoriteHandlers } from './ipc/favorites.ipc'
import { registerPreviewHandlers } from './ipc/preview.ipc'
import { registerNoteHandlers } from './ipc/notes.ipc'
import { registerTaskHandlers } from './ipc/tasks.ipc'
import { registerDragHandlers } from './ipc/drag.ipc'
import { registerSyncHandlers } from './ipc/sync.ipc'
import { shouldAutoImport, importData, exportData, getCurrentPrefs } from './services/sync.service'
import { startWatching, stopWatching, setChangeCallback } from './services/watcher.service'
import { getAllFolders } from './db/repositories/folders.repo'
import { IPC } from '../shared/ipc-channels'
import type { WindowMode, WidgetState } from '../shared/types'

let mainWindow: BrowserWindow | null = null

// ─── Window mode state ───
let currentMode: WindowMode = 'normal'
let widgetState: WidgetState = 'collapsed'
let normalBounds: Electron.Rectangle = { x: 100, y: 100, width: 1280, height: 800 }
let lastExpandedWidth = 480

const WIDGET_COLLAPSED_WIDTH = 20
const WIDGET_EXPANDED_WIDTH = 480

// ─── Settings persistence ───
const settingsPath = (): string => path.join(app.getPath('userData'), 'window-settings.json')

function loadSettings(): { mode: WindowMode; bounds: Electron.Rectangle } {
  try {
    const data = fs.readFileSync(settingsPath(), 'utf-8')
    const parsed = JSON.parse(data)
    return {
      mode: parsed.mode === 'widget' ? 'widget' : 'normal',
      bounds: parsed.bounds || { x: 100, y: 100, width: 1280, height: 800 }
    }
  } catch {
    return { mode: 'normal', bounds: { x: 100, y: 100, width: 1280, height: 800 } }
  }
}

function saveSettings(): void {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify({ mode: currentMode, bounds: normalBounds }))
  } catch {
    // Silently ignore write errors
  }
}

// ─── Mode application ───

function applyNormalMode(): void {
  if (!mainWindow) return
  currentMode = 'normal'
  widgetState = 'collapsed'

  mainWindow.setAlwaysOnTop(false)
  mainWindow.setSkipTaskbar(false)
  mainWindow.setResizable(true)
  mainWindow.setMinimumSize(900, 600)
  mainWindow.setBounds(normalBounds)

  mainWindow.webContents.send(IPC.WINDOW_MODE_CHANGED, 'normal')
  mainWindow.webContents.send(IPC.WIDGET_STATE_CHANGED, 'collapsed')
  saveSettings()
}

function applyWidgetMode(): void {
  if (!mainWindow) return

  // Save current bounds before switching
  normalBounds = mainWindow.getBounds()
  currentMode = 'widget'
  widgetState = 'collapsed'

  const workArea = screen.getPrimaryDisplay().workArea

  mainWindow.setResizable(false)
  mainWindow.setMinimumSize(WIDGET_COLLAPSED_WIDTH, 0)
  mainWindow.setAlwaysOnTop(true)
  mainWindow.setSkipTaskbar(true)
  mainWindow.setBounds({
    x: workArea.x,
    y: workArea.y,
    width: WIDGET_COLLAPSED_WIDTH,
    height: workArea.height
  })

  mainWindow.webContents.send(IPC.WINDOW_MODE_CHANGED, 'widget')
  mainWindow.webContents.send(IPC.WIDGET_STATE_CHANGED, 'collapsed')
  saveSettings()
}

function toggleWidgetState(): void {
  if (!mainWindow || currentMode !== 'widget') return

  const workArea = screen.getPrimaryDisplay().workArea
  const newState: WidgetState = widgetState === 'collapsed' ? 'expanded' : 'collapsed'

  // Save current width before collapsing
  if (newState === 'collapsed') {
    lastExpandedWidth = mainWindow.getBounds().width
  }

  const width = newState === 'collapsed' ? WIDGET_COLLAPSED_WIDTH : lastExpandedWidth

  widgetState = newState
  mainWindow.setBounds({
    x: workArea.x,
    y: workArea.y,
    width,
    height: workArea.height
  })

  mainWindow.webContents.send(IPC.WIDGET_STATE_CHANGED, newState)
}

function setWidgetWidth(width: number): void {
  if (!mainWindow || currentMode !== 'widget') return

  const workArea = screen.getPrimaryDisplay().workArea
  const clamped = Math.max(WIDGET_COLLAPSED_WIDTH, Math.min(width, workArea.width))

  // Update state based on width
  const newState: WidgetState = clamped > WIDGET_COLLAPSED_WIDTH ? 'expanded' : 'collapsed'
  if (newState !== widgetState) {
    widgetState = newState
    mainWindow.webContents.send(IPC.WIDGET_STATE_CHANGED, newState)
  }

  // Track last expanded width for toggle restore
  if (clamped > WIDGET_COLLAPSED_WIDTH) {
    lastExpandedWidth = clamped
  }

  mainWindow.setBounds({
    x: workArea.x,
    y: workArea.y,
    width: clamped,
    height: workArea.height
  })
}

// ─── Window creation ───

function createWindow(): void {
  const settings = loadSettings()
  currentMode = settings.mode
  normalBounds = settings.bounds

  mainWindow = new BrowserWindow({
    width: currentMode === 'normal' ? normalBounds.width : WIDGET_COLLAPSED_WIDTH,
    height: currentMode === 'normal' ? normalBounds.height : screen.getPrimaryDisplay().workArea.height,
    x: currentMode === 'normal' ? normalBounds.x : screen.getPrimaryDisplay().workArea.x,
    y: currentMode === 'normal' ? normalBounds.y : screen.getPrimaryDisplay().workArea.y,
    minWidth: currentMode === 'normal' ? 900 : WIDGET_COLLAPSED_WIDTH,
    minHeight: currentMode === 'normal' ? 600 : 0,
    frame: false,
    show: false,
    title: 'File Organizer',
    alwaysOnTop: currentMode === 'widget',
    skipTaskbar: currentMode === 'widget',
    resizable: currentMode === 'normal',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Widget always starts collapsed
  if (currentMode === 'widget') {
    widgetState = 'collapsed'
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  // Track normal bounds when user moves/resizes in normal mode
  const saveBoundsIfNormal = (): void => {
    if (currentMode === 'normal' && mainWindow && !mainWindow.isMinimized()) {
      normalBounds = mainWindow.getBounds()
    }
  }
  mainWindow.on('moved', saveBoundsIfNormal)
  mainWindow.on('resized', saveBoundsIfNormal)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// ─── IPC handlers for window management ───

function registerWindowHandlers(): void {
  ipcMain.handle(IPC.GET_WINDOW_MODE, () => currentMode)
  ipcMain.handle(IPC.GET_WIDGET_STATE, () => widgetState)

  ipcMain.handle(IPC.SET_WINDOW_MODE, (_e, mode: WindowMode) => {
    if (mode === 'widget') {
      applyWidgetMode()
    } else {
      applyNormalMode()
    }
  })

  ipcMain.handle(IPC.TOGGLE_WIDGET, () => {
    toggleWidgetState()
  })

  ipcMain.handle(IPC.SET_WIDGET_WIDTH, (_e, width: number) => {
    setWidgetWidth(width)
  })

  ipcMain.handle(IPC.MINIMIZE_WINDOW, () => {
    mainWindow?.minimize()
  })

  ipcMain.handle(IPC.MAXIMIZE_WINDOW, () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })

  ipcMain.handle(IPC.CLOSE_WINDOW, () => {
    mainWindow?.close()
  })
}

// ─── Global Hotkey ───

function registerGlobalHotkey(): void {
  globalShortcut.register('Ctrl+Shift+Space', () => {
    if (!mainWindow) return

    if (currentMode === 'widget') {
      // Widget mode: toggle expand/collapse, show + focus if hidden
      if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
      toggleWidgetState()
      mainWindow.focus()
    } else {
      // Normal mode: restore if minimized, show + focus
      if (mainWindow.isMinimized()) {
        mainWindow.restore()
      }
      if (!mainWindow.isVisible()) {
        mainWindow.show()
      }
      mainWindow.focus()
    }
  })
}

// ─── App lifecycle ───

// Separate dev and prod userData so cache files don't conflict
if (is.dev) {
  app.setPath('userData', app.getPath('userData') + '-dev')
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.fileorganizer')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize database
  getDb()

  // Register all IPC handlers
  registerFolderHandlers()
  registerFileHandlers()
  registerCategoryHandlers()
  registerTagHandlers()
  registerFavoriteHandlers()
  registerPreviewHandlers()
  registerNoteHandlers()
  registerTaskHandlers()
  registerWindowHandlers()
  registerDragHandlers()
  registerSyncHandlers()

  // Auto-import on startup if remote sync file is newer
  if (shouldAutoImport()) {
    importData()
  }

  createWindow()
  registerGlobalHotkey()

  // Start watching all previously added folders
  const folders = getAllFolders()
  if (folders.length > 0) {
    startWatching(folders.map(f => f.path))

    setChangeCallback(() => {
      mainWindow?.webContents.send('event:files-changed')
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  saveSettings()
  stopWatching()
  // Auto-export on close if sync is configured
  exportData(getCurrentPrefs())
  closeDb()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
