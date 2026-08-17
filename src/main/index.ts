import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  dialog
} from 'electron'
import path from 'path'
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
import { registerAppPrefsHandlers } from './ipc/app-prefs.ipc'
import { registerReminderHandlers } from './ipc/reminders.ipc'
import * as reminderService from './services/reminder.service'
import { pruneOrphanedAutoReminders } from './db/repositories/reminders.repo'
import { shouldAutoImport, importData, exportData, getCurrentPrefs } from './services/sync.service'
import { startWatching, stopWatching, setChangeCallback } from './services/watcher.service'
import {
  getAppPrefs,
  setAppPrefs,
  isOpenAtLoginEnabled,
  reconcileOpenAtLogin,
  launchedHidden,
  HIDDEN_ARG
} from './services/app-prefs.service'
import { getAllFolders } from './db/repositories/folders.repo'
import { loadJson, writeJsonAtomic } from './utils/safe-fs'
import { resolveResourcePath } from './utils/resources'
import {
  guardWrite,
  registerPersistenceHandlers,
  reportPersistenceIssue
} from './utils/error-reporter'
import { IPC } from '../shared/ipc-channels'
import type { WindowMode, WidgetState } from '../shared/types'

let mainWindow: BrowserWindow | null = null

// Held at module level on purpose: a garbage-collected Tray silently disappears
// from the notification area.
let tray: Tray | null = null

// ─── Window geometry constants ───
const WIDGET_COLLAPSED_WIDTH = 20
const NORMAL_MIN_WIDTH = 900
const NORMAL_MIN_HEIGHT = 600
const DEFAULT_BOUNDS: Electron.Rectangle = { x: 100, y: 100, width: 1280, height: 800 }

// ─── Window mode state ───
let currentMode: WindowMode = 'normal'
let widgetState: WidgetState = 'collapsed'
let normalBounds: Electron.Rectangle = { ...DEFAULT_BOUNDS }
let lastExpandedWidth = 480

// ─── Lifecycle state ───

/** True once a real quit is under way, so the close handler stops intercepting. */
let isQuitting = false
/** `before-quit` can fire more than once; teardown must not. */
let teardownDone = false
/** Set for an autostart (`--hidden`) launch: first window is created but not shown. */
let suppressInitialShow = false

// ─── Display-relative geometry ───

/**
 * How much of the window has to land on a live display's work area before we
 * accept the saved position. Enough to grab with the mouse, not more.
 */
const MIN_VISIBLE_WIDTH = 120
const MIN_VISIBLE_HEIGHT = 60

function isRealNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** Coerce whatever came out of the settings file into a usable rectangle. */
function sanitizeBounds(raw: unknown): Electron.Rectangle {
  const r = (raw ?? {}) as Partial<Electron.Rectangle>
  if (typeof r !== 'object') return { ...DEFAULT_BOUNDS }
  return {
    x: isRealNumber(r.x) ? Math.round(r.x) : DEFAULT_BOUNDS.x,
    y: isRealNumber(r.y) ? Math.round(r.y) : DEFAULT_BOUNDS.y,
    width: Math.max(NORMAL_MIN_WIDTH, isRealNumber(r.width) ? Math.round(r.width) : DEFAULT_BOUNDS.width),
    height: Math.max(NORMAL_MIN_HEIGHT, isRealNumber(r.height) ? Math.round(r.height) : DEFAULT_BOUNDS.height)
  }
}

function overlap(a: Electron.Rectangle, b: Electron.Rectangle): { w: number; h: number } {
  return {
    w: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    h: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  }
}

/**
 * Reseat a rectangle into the displays that exist *right now*.
 *
 * Persisted window coordinates are monitor-relative, and the monitor they were
 * relative to may be gone — saved on an external screen, then undocked. The old
 * code passed `x`/`y` straight through, so the window was created fully
 * offscreen while tray "Show", the hotkey and second-instance reveal all
 * reported success and the user saw nothing.
 *
 * Rule (recorded lesson): never treat persisted monitor-relative coordinates as
 * authoritative — clamp into live bounds on load, and again on reveal, because
 * the layout can change while the window is hidden.
 */
function clampToVisibleDisplay(raw: unknown): Electron.Rectangle {
  const bounds = sanitizeBounds(raw)

  let displays: Electron.Display[] = []
  try {
    displays = screen.getAllDisplays()
  } catch {
    // `screen` is only usable after app ready; if it isn't, the sanitised rect
    // is still better than the raw one.
    return bounds
  }
  if (displays.length === 0) return bounds

  for (const display of displays) {
    const { w, h } = overlap(bounds, display.workArea)
    if (w >= MIN_VISIBLE_WIDTH && h >= MIN_VISIBLE_HEIGHT) return bounds
  }

  // Nothing substantial on any connected display: centre it on the display
  // nearest where it used to be (primary, if that can't be determined).
  const centre = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2)
  }
  let target: Electron.Display
  try {
    target = screen.getDisplayNearestPoint(centre)
  } catch {
    target = screen.getPrimaryDisplay()
  }

  const area = target.workArea
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  const reseated = {
    x: Math.round(area.x + Math.max(0, (area.width - width) / 2)),
    y: Math.round(area.y + Math.max(0, (area.height - height) / 2)),
    width,
    height
  }
  console.warn(
    `[window] saved bounds ${JSON.stringify(bounds)} are not on any connected display — ` +
      `reseated to ${JSON.stringify(reseated)}`
  )
  return reseated
}

/** Reseat the live window if the display layout moved out from under it. */
function reseatIfOffscreen(): void {
  if (!mainWindow || mainWindow.isDestroyed() || currentMode !== 'normal') return
  const current = mainWindow.getBounds()
  const seated = clampToVisibleDisplay(current)
  if (
    seated.x === current.x &&
    seated.y === current.y &&
    seated.width === current.width &&
    seated.height === current.height
  ) {
    return
  }
  normalBounds = seated
  mainWindow.setBounds(seated)
}

// ─── Settings persistence ───
const settingsPath = (): string => path.join(app.getPath('userData'), 'window-settings.json')

function loadSettings(): { mode: WindowMode; bounds: Electron.Rectangle } {
  // ownership 'local': window-settings.json lives in userData, written only here.
  const { data, issue } = loadJson<{ mode?: unknown; bounds?: unknown }>(
    settingsPath(),
    {},
    { ownership: 'local' }
  )
  if (issue) reportPersistenceIssue('corrupt', issue.file, issue.detail)

  // Validate rather than trust: this runs inside createWindow, so a throw here
  // means no window gets created at all.
  return {
    mode: data.mode === 'widget' ? 'widget' : 'normal',
    bounds: clampToVisibleDisplay(data.bounds)
  }
}

function saveSettings(): void {
  // backup:false — window bounds are trivially regenerable, not worth a .bak.
  guardWrite(settingsPath(), () =>
    writeJsonAtomic(settingsPath(), { mode: currentMode, bounds: normalBounds }, { backup: false })
  )
}

// ─── Renderer messaging ───

/**
 * Guarded send. The app now outlives its window (tray mode), and with
 * close-to-tray disabled `mainWindow` can be destroyed while background work —
 * the file watcher especially — is still running.
 */
function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

// ─── Mode application ───

function applyNormalMode(): void {
  if (!mainWindow) return
  currentMode = 'normal'
  widgetState = 'collapsed'

  // The saved normal bounds may predate a monitor change (widget mode always
  // re-derives its geometry from the live workArea, so only this path needs it).
  normalBounds = clampToVisibleDisplay(normalBounds)

  mainWindow.setAlwaysOnTop(false)
  mainWindow.setSkipTaskbar(false)
  mainWindow.setResizable(true)
  mainWindow.setMinimumSize(NORMAL_MIN_WIDTH, NORMAL_MIN_HEIGHT)
  mainWindow.setBounds(normalBounds)

  sendToRenderer(IPC.WINDOW_MODE_CHANGED, 'normal')
  sendToRenderer(IPC.WIDGET_STATE_CHANGED, 'collapsed')
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

  sendToRenderer(IPC.WINDOW_MODE_CHANGED, 'widget')
  sendToRenderer(IPC.WIDGET_STATE_CHANGED, 'collapsed')
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

  sendToRenderer(IPC.WIDGET_STATE_CHANGED, newState)
}

function setWidgetWidth(width: number): void {
  if (!mainWindow || currentMode !== 'widget') return

  const workArea = screen.getPrimaryDisplay().workArea
  const clamped = Math.max(WIDGET_COLLAPSED_WIDTH, Math.min(width, workArea.width))

  // Update state based on width
  const newState: WidgetState = clamped > WIDGET_COLLAPSED_WIDTH ? 'expanded' : 'collapsed'
  if (newState !== widgetState) {
    widgetState = newState
    sendToRenderer(IPC.WIDGET_STATE_CHANGED, newState)
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

// ─── Automatic sync export ───

/**
 * Floor between hide-triggered exports. The export is synchronous and writes to
 * a network share, so toggling the window off and on repeatedly must not turn
 * into a write storm.
 */
const HIDE_EXPORT_MIN_INTERVAL_MS = 60_000
let lastHideExportAt = 0

/**
 * The automatic export, from both places a session can effectively end.
 *
 * `'hide'` restores what used to happen on `window-all-closed`: with
 * close-to-tray on by default, a user who closes the window every evening
 * otherwise never publishes, and the sync feature quietly stops working. Rate
 * limited by HIDE_EXPORT_MIN_INTERVAL_MS.
 *
 * `'quit'` runs from runTeardown, which is guarded by `teardownDone`, so it
 * happens exactly once per quit — and is never rate limited, because the last
 * changes of the session have to get out.
 */
function runAutoExport(reason: 'hide' | 'quit'): void {
  if (reason === 'hide') {
    const now = Date.now()
    if (now - lastHideExportAt < HIDE_EXPORT_MIN_INTERVAL_MS) return
    lastHideExportAt = now
  }
  // exportData reports write failures through the persistence channel itself, so
  // a failed background export lands in the banner instead of disappearing.
  const result = exportData(getCurrentPrefs())
  if (!result.success) {
    console.warn(`[sync] auto-export (${reason}) did not run: ${result.message}`)
  }
}

// ─── Window visibility (shared by hotkey, tray and second-instance) ───

/** Bring the window back from hidden/minimized and focus it. */
function revealWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  // Displays can be added or removed while the window sits hidden in the tray.
  // Without this, "Show" happily reveals the window onto a monitor that is no
  // longer there and reports success. After restore(), before show(), so the
  // bounds land on a normal window and the user never sees it in the wrong place.
  reseatIfOffscreen()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

function toggleWindowVisibility(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide()
  } else {
    revealWindow()
  }
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
    minWidth: currentMode === 'normal' ? NORMAL_MIN_WIDTH : WIDGET_COLLAPSED_WIDTH,
    minHeight: currentMode === 'normal' ? NORMAL_MIN_HEIGHT : 0,
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
    // An autostart launch loads the renderer (so background work is live) but
    // never shows the window. Applies to the first window only.
    if (suppressInitialShow) {
      suppressInitialShow = false
      return
    }
    mainWindow?.show()
  })

  // Close-to-tray. The window is frameless, so the renderer's own close button
  // arrives here too via the CLOSE_WINDOW handler → close() → this listener.
  mainWindow.on('close', (e) => {
    if (isQuitting) return
    // `canHideToTray()` is not redundant with the preference: with no tray icon
    // and no window there is no way to show the app and no way to quit it.
    if (getAppPrefs().closeToTray && canHideToTray()) {
      e.preventDefault()
      mainWindow?.hide()
      return
    }
    // User opted out of close-to-tray (or there is no tray): closing means quit.
    isQuitting = true
    app.quit()
  })

  // Hiding to the tray is how a session now ends for the user, so it is also
  // when we publish to the share. See runAutoExport.
  mainWindow.on('hide', () => {
    if (isQuitting || teardownDone) return
    // Deferred so the window vanishes immediately: exportData is synchronous and
    // can block for seconds on a slow share.
    setTimeout(() => {
      if (isQuitting || teardownDone) return
      runAutoExport('hide')
    }, 0)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
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

// ─── Tray ───

/**
 * How many occurrences are firing or overdue-unacknowledged right now.
 *
 * Mirrored here (rather than queried on demand) because both the tray icon and
 * the tray menu need it, and the menu is rebuilt from a synchronous callback.
 */
let reminderFiringCount = 0

/**
 * Built fresh each time so the "Start with Windows" checkbox reflects real state
 * and the snooze item appears only when there is something to snooze.
 */
function buildTrayMenu(): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Show File Organizer',
      click: () => revealWindow()
    }
  ]

  if (reminderFiringCount > 0) {
    template.push(
      { type: 'separator' },
      {
        label: `Snooze all reminders (15m)${reminderFiringCount > 1 ? ` — ${reminderFiringCount}` : ''}`,
        click: () => {
          reminderService.snoozeAllFiring(15)
        }
      }
    )
  }

  template.push(
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: isOpenAtLoginEnabled(),
      click: (item) => {
        setAppPrefs({ openAtLogin: item.checked })
        refreshTrayMenu()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  )

  return Menu.buildFromTemplate(template)
}

function refreshTrayMenu(): void {
  tray?.setContextMenu(buildTrayMenu())
}

/** Icons are read once each: nativeImage decoding on every state flip is waste. */
const trayIconCache = new Map<string, Electron.NativeImage | null>()

function trayIcon(fileName: string): Electron.NativeImage | null {
  const cached = trayIconCache.get(fileName)
  if (cached !== undefined) return cached

  let image: Electron.NativeImage | null = null
  const iconPath = resolveResourcePath(fileName)
  if (iconPath) {
    const candidate = nativeImage.createFromPath(iconPath)
    if (candidate.isEmpty()) {
      console.error(`[tray] icon at ${iconPath} could not be decoded`)
    } else {
      image = candidate
    }
  }
  trayIconCache.set(fileName, image)
  return image
}

/**
 * Reflect reminder state in the notification area: amber icon plus a count in the
 * tooltip while anything is unacknowledged, back to normal once it is clear.
 *
 * This is the only always-visible signal that a reminder fired while the window
 * was hidden — a toast that Focus Assist swallowed leaves no other trace.
 */
function applyReminderTrayState(count: number): void {
  reminderFiringCount = count
  if (!tray || tray.isDestroyed()) return

  const icon = trayIcon(count > 0 ? 'tray-icon-alert.png' : 'tray-icon.png')
  if (icon) tray.setImage(icon)

  tray.setToolTip(
    count === 0
      ? 'File Organizer'
      : `File Organizer — ${count} reminder${count === 1 ? '' : 's'} waiting`
  )
  refreshTrayMenu()
}

/**
 * True only if there really is a tray icon to fall back to. Close-to-tray with
 * no tray leaves the app unreachable — no window, no menu, no way to quit — so
 * every consumer of the preference has to check this too.
 */
function canHideToTray(): boolean {
  return tray !== null && !tray.isDestroyed()
}

/** Returns false if no tray icon could be created; the caller must react. */
function createTray(): boolean {
  const icon = trayIcon(reminderFiringCount > 0 ? 'tray-icon-alert.png' : 'tray-icon.png')
  if (!icon) return false

  try {
    tray = new Tray(icon)
  } catch (err) {
    console.error(`[tray] could not create tray icon: ${(err as Error).message}`)
    tray = null
    return false
  }

  // Seeds icon, tooltip and menu from whatever reminder state already exists —
  // the scheduler may have started (and fired) before the tray was created.
  applyReminderTrayState(reminderFiringCount)

  // A Windows double-click emits click, click, double-click. Collapse that
  // storm so the window doesn't flap.
  let clickCooldown: NodeJS.Timeout | null = null
  const onActivate = (): void => {
    if (clickCooldown) return
    clickCooldown = setTimeout(() => {
      clickCooldown = null
    }, 250)
    toggleWindowVisibility()
  }
  tray.on('click', onActivate)
  tray.on('double-click', onActivate)
  return true
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
    // Goes through the 'close' listener above, so it hides to tray unless the
    // user turned that off.
    mainWindow?.close()
  })
}

// ─── Global Hotkey ───

const HOTKEY = 'Ctrl+Shift+Space'

/**
 * Returns false when the accelerator could not be claimed — almost always
 * because another running app already owns it. Silently ignoring the return
 * value left the user pressing a dead key combination with no explanation.
 */
function registerGlobalHotkey(): boolean {
  let registered = false
  try {
    registered = globalShortcut.register(HOTKEY, () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow()
        return
      }

      if (currentMode === 'widget') {
        // Widget mode: show/focus, then toggle expand/collapse
        revealWindow()
        toggleWidgetState()
      } else {
        revealWindow()
      }
    })
  } catch (err) {
    console.error(`[hotkey] registering ${HOTKEY} threw: ${(err as Error).message}`)
    return false
  }

  if (!registered) {
    console.error(`[hotkey] ${HOTKEY} was refused — another application already owns it`)
  }
  return registered
}

// ─── Teardown ───

/**
 * One shutdown step. Each is isolated because `teardownDone` is set before any
 * of them run: a step that threw used to abort the whole sequence permanently,
 * so `closeDb()` was never reached for the rest of the process lifetime. Nothing
 * in here propagates, so `runTeardown()` cannot throw.
 */
function teardownStep(name: string, step: () => void): void {
  try {
    step()
  } catch (err) {
    console.error(`[teardown] ${name} failed: ${(err as Error)?.message ?? String(err)}`)
  }
}

/**
 * All shutdown work lives here rather than on window close, because the window
 * closing no longer means the app is exiting. Guarded by `teardownDone`:
 * `before-quit` can fire more than once and a second export would rewrite the
 * shared sync file for nothing.
 *
 * `closeDb()` is deliberately NOT here — see the `will-quit` handler.
 */
function runTeardown(): void {
  if (teardownDone) return
  teardownDone = true

  teardownStep('unregister global shortcuts', () => globalShortcut.unregisterAll())
  teardownStep('save window settings', () => saveSettings())
  teardownStep('stop file watcher', () => stopWatching())
  // First among the stoppers, and not optional: alert windows are
  // `closable: false`, so one left standing would stop `app.quit()` from ever
  // completing. stop() destroys them. Wrapped like every other step, so a throw
  // in the scheduler cannot cost us closeDb() or the final export.
  teardownStep('stop reminder scheduler', () => reminderService.stop())
  // The final automatic export. Exactly once per quit, courtesy of teardownDone.
  teardownStep('final sync export', () => runAutoExport('quit'))
}

// ─── App lifecycle ───

// Separate dev and prod userData so cache files don't conflict.
// MUST come before requestSingleInstanceLock(): the lock is keyed on the
// userData directory, so setting it later would make a dev instance collide
// with an installed one.
if (is.dev) {
  app.setPath('userData', app.getPath('userData') + '-dev')
}

// Reminder sounds are played by the alert window, and Chromium's default autoplay
// policy requires a user gesture in the page first — which an alert that appears
// on its own can never have. Without this the blackout tier would be silent,
// which is most of what makes it a blackout. Must be set before app ready. The app
// plays no other media, so this widens nothing else.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// One instance only. Two would mean duplicate notifications and two writers on
// a single SQLite file.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  bootstrap()
}

function bootstrap(): void {
  suppressInitialShow = launchedHidden()

  app.on('second-instance', (_event, argv) => {
    // A second launch that carries --hidden is the autostart entry firing while
    // we're already running; don't pop the window for it.
    if (argv.includes(HIDDEN_ARG)) return
    revealWindow()
  })

  app.whenReady().then(() => {
    // Must match package.json build.appId. On Windows the AppUserModelId is the
    // app's notification identity — if it doesn't match the installed app,
    // toasts get misattributed or never appear, which would silently break the
    // whole reminders feature. Keep these two in sync.
    electronApp.setAppUserModelId('com.fileorganizer.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Initialize database (runs pending migrations)
    try {
      getDb()
    } catch (err) {
      dialog.showErrorBox(
        'File Organizer — database error',
        `The database could not be opened or migrated:\n\n${(err as Error).message}`
      )
      app.exit(1)
      return
    }

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
    registerReminderHandlers()
    registerPersistenceHandlers()
    // Tray checkbox mirrors these prefs, so rebuild the menu when they change.
    registerAppPrefsHandlers(() => refreshTrayMenu())

    // Keep the OS login item in step with the stored preference
    reconcileOpenAtLogin()

    // Auto-import on startup if remote sync file is newer
    if (shouldAutoImport()) {
      importData()
    }

    createWindow()

    // A missing tray is not cosmetic: with close-to-tray on by default it would
    // leave the app with no window and no way to reach it. canHideToTray() makes
    // the close handler quit instead; tell the user why the behaviour changed.
    if (!createTray()) {
      reportPersistenceIssue(
        'unavailable',
        'The system tray icon',
        'The tray icon could not be created, so closing the window will quit File Organizer ' +
          'for this session instead of hiding it.'
      )
    }

    if (!registerGlobalHotkey()) {
      reportPersistenceIssue(
        'unavailable',
        `The ${HOTKEY} shortcut`,
        `${HOTKEY} is already taken by another application, so it will not bring up ` +
          'File Organizer. Use the tray icon instead.'
      )
    }

    // ─── Reminders ───
    //
    // Started after the window exists, because the very first tick can fire a
    // catch-up alert and `reveal` has to have something to reveal.
    reminderService.initReminderService({
      reveal: () => revealWindow(),
      onFiringCountChanged: (count) => applyReminderTrayState(count),
      onRemindersChanged: () => sendToRenderer(IPC.REMINDERS_CHANGED)
    })

    // Auto-created reminders whose task is gone — deleted on this machine, or
    // arriving from sync for a task that never existed here. Hand-made reminders
    // are never touched.
    try {
      const pruned = pruneOrphanedAutoReminders()
      if (pruned > 0) console.log(`[reminders] pruned ${pruned} orphaned auto reminder(s)`)
    } catch (err) {
      console.error(`[reminders] prune failed: ${(err as Error).message}`)
    }

    reminderService.start()

    // Start watching all previously added folders. This deliberately keeps
    // running while the app sits in the tray — background file tracking is the
    // point now, not a leak.
    const folders = getAllFolders()
    if (folders.length > 0) {
      startWatching(folders.map((f) => f.path))

      setChangeCallback(() => {
        sendToRenderer(IPC.FILES_CHANGED)
      })
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      } else {
        revealWindow()
      }
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
    runTeardown()
  })

  // `before-quit` fires BEFORE Electron closes any window, so renderer IPC calls
  // queued during the (synchronous, possibly multi-second) export above can still
  // drain afterwards. Closing the database there threw those writes away —
  // NoteEditor's debounced autosave losing an edit, for instance. `will-quit`
  // runs once every window is gone, which is the earliest safe moment.
  app.on('will-quit', () => {
    teardownStep('close database', () => closeDb())
  })

  // Intentionally a no-op: the app lives on in the tray after its window
  // closes. Quit-on-close (when the user opts out of close-to-tray) is handled
  // explicitly in the window's 'close' listener.
  app.on('window-all-closed', () => {
    /* no-op — see comment above */
  })
}
