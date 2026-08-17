import { BrowserWindow, screen } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC } from '../../shared/ipc-channels'
import type { ReminderAlertPayload } from '../../shared/types'

/**
 * The tier-2 (popup) and tier-3 (blackout) alert surfaces.
 *
 * ONE alert window exists at a time — the scheduler queues everything else and
 * advances as each is actioned. Ten simultaneous popups would be dismissed as a
 * batch, which defeats the point of having louder tiers at all.
 *
 * There is no second renderer build entry. electron-vite has a single
 * `index.html`, so the alert window loads that same bundle with a
 * `#/alert/<occurrenceId>` hash and `App.tsx` branches on it before any of the
 * main UI's state is initialised.
 */

let alertWindow: BrowserWindow | null = null
/** Opaque covers for the non-primary displays at tier 3. */
let dimWindows: BrowserWindow[] = []
/**
 * The display layout the covers were built for. Compared as a whole rather than
 * counted: swapping one monitor for another keeps the count identical while every
 * cover is now in the wrong place.
 */
let dimSignature = ''
let currentPayload: ReminderAlertPayload | null = null
/** Which occurrence (or 'digest') the live window was created for. */
let currentKey: string | null = null
let onDismissed: (() => void) | null = null
let displayListenersBound = false

const POPUP_WIDTH = 460
const POPUP_HEIGHT = 340

function rendererTarget(hash: string): { url?: string; file?: string; hash: string } {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return { url: `${process.env['ELECTRON_RENDERER_URL']}#${hash}`, hash }
  }
  return { file: path.join(__dirname, '../renderer/index.html'), hash }
}

function loadRenderer(win: BrowserWindow, hash: string): void {
  const target = rendererTarget(hash)
  if (target.url) {
    win.loadURL(target.url)
  } else {
    win.loadFile(target.file!, { hash })
  }
}

function payloadKey(payload: ReminderAlertPayload): string {
  return payload.kind === 'digest' ? 'digest' : String(payload.occurrence_id ?? 'unknown')
}

export function isAlertWindowOpen(): boolean {
  return alertWindow !== null && !alertWindow.isDestroyed()
}

export function getCurrentAlertPayload(): ReminderAlertPayload | null {
  return currentPayload
}

/** True when the live window is already showing this occurrence/digest. */
export function isShowing(payload: ReminderAlertPayload): boolean {
  return isAlertWindowOpen() && currentKey === payloadKey(payload)
}

// ─── Blackout covers ──────────────────────────────────────────────────────────

function destroyDimWindows(): void {
  for (const win of dimWindows) {
    if (!win.isDestroyed()) win.destroy()
  }
  dimWindows = []
  dimSignature = ''
}

function layoutSignature(displays: Electron.Display[]): string {
  return displays
    .map((d) => `${d.id}@${d.bounds.x},${d.bounds.y},${d.bounds.width},${d.bounds.height}`)
    .join('|')
}

/**
 * Tier 3 covers every display. The primary carries the controls (the alert window
 * itself is resized to fill it), so only the other displays need a cover.
 */
function ensureDimWindows(): void {
  const primaryId = screen.getPrimaryDisplay().id
  const wanted = screen.getAllDisplays().filter((d) => d.id !== primaryId)
  const signature = layoutSignature(wanted)

  // Counting was not enough: unplug a monitor and plug in a different one and the
  // count matches while the cover sits at the old monitor's coordinates — which,
  // once that monitor is gone, is the primary display. An opaque always-on-top
  // window over the primary is a black screen covering the taskbar and the tray,
  // with the controls underneath it.
  if (
    signature === dimSignature &&
    dimWindows.length === wanted.length &&
    dimWindows.every((w) => !w.isDestroyed())
  ) {
    return
  }
  destroyDimWindows()

  for (const display of wanted) {
    const win = new BrowserWindow({
      ...display.bounds,
      frame: false,
      show: false,
      closable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      backgroundColor: '#000000',
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })
    // TRACKED BEFORE IT IS CONFIGURED, and this ordering is the whole point: the
    // window is `closable: false`, so if any of the calls below throws, a window
    // that only `destroy()` can remove would never be in `dimWindows` and
    // `closeAlert()` could not take it down — leaving an untrackable black cover
    // that also stops `app.quit()` from completing.
    dimWindows.push(win)

    try {
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setVisibleOnAllWorkspaces(true)
      win.once('ready-to-show', () => {
        if (!win.isDestroyed()) win.showInactive()
      })
      loadRenderer(win, '/alert-dim')
    } catch (err) {
      // A cover is best effort — the controls on the primary display are what
      // actually delivers the reminder. Keep it tracked so it is destroyed with
      // the rest.
      console.error(`[reminders] could not set up a blackout cover: ${(err as Error).message}`)
    }
  }

  dimSignature = signature
}

/**
 * Re-seat the alert surfaces when the display layout changes.
 *
 * A blackout that started with two monitors and then loses one leaves its cover
 * pinned to coordinates that now belong to the primary display, blacking out the
 * taskbar and the tray with no way to reach the controls. The popup tier has the
 * milder version of the same problem: a window centred on a monitor that has just
 * been unplugged is offscreen. `applyTier` already re-derives both from the live
 * layout, so reconciling is a matter of running it again.
 */
function bindDisplayListeners(): void {
  if (displayListenersBound) return
  displayListenersBound = true

  const reconcile = (): void => {
    if (!isAlertWindowOpen() || !currentPayload) return
    try {
      console.log('[reminders] display layout changed — re-seating the alert surfaces')
      applyTier(currentPayload)
    } catch (err) {
      console.error(`[reminders] could not re-seat alert surfaces: ${(err as Error).message}`)
    }
  }

  // Bound on first use rather than at module scope: `screen` is unusable before the
  // app is ready, and this module is imported during startup.
  screen.on('display-removed', reconcile)
  screen.on('display-added', reconcile)
  screen.on('display-metrics-changed', reconcile)
}

// ─── Tier geometry ────────────────────────────────────────────────────────────

function applyTier(payload: ReminderAlertPayload): void {
  if (!alertWindow || alertWindow.isDestroyed()) return

  if (payload.tier === 'blackout') {
    ensureDimWindows()
    // Fill the primary display rather than using the fullscreen flag: a frameless
    // window at the display's bounds gets there instantly, with no fullscreen
    // transition animation to sit through and no way for the OS to animate it
    // back out from under us.
    alertWindow.setBounds(screen.getPrimaryDisplay().bounds)
  } else {
    destroyDimWindows()
    const area = screen.getPrimaryDisplay().workArea
    alertWindow.setBounds({
      x: Math.round(area.x + (area.width - POPUP_WIDTH) / 2),
      y: Math.round(area.y + (area.height - POPUP_HEIGHT) / 2),
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT
    })
  }

  // Re-assert: the dim covers were created after the alert window, so on Windows
  // they would otherwise sit on top of the controls.
  alertWindow.setAlwaysOnTop(true, 'screen-saver')
  alertWindow.moveTop()
}

// ─── Show / update / close ────────────────────────────────────────────────────

/**
 * Show `payload`, creating the window if the occurrence changed.
 *
 * A tier escalation on the *same* occurrence deliberately reuses the window: a
 * recreate would restart the sound from the top and steal focus a second time.
 *
 * @param onWindowGone Called if the window disappears without an action having
 *   been taken, so the scheduler can advance rather than wait forever on a window
 *   that no longer exists. A crash does NOT make the window disappear by itself —
 *   see `treatAsGone` below.
 */
export function showAlert(payload: ReminderAlertPayload, onWindowGone: () => void): void {
  bindDisplayListeners()
  const key = payloadKey(payload)

  if (isAlertWindowOpen() && currentKey === key) {
    currentPayload = payload
    onDismissed = onWindowGone
    applyTier(payload)
    pushPayload()
    return
  }

  // Replacing, not losing: closeAlert() clears `onDismissed` and nulls
  // `alertWindow` before destroying, so the outgoing window's 'closed' handler
  // cannot fire the previous "window vanished" callback and make the scheduler
  // advance twice.
  closeAlert()
  currentKey = key
  currentPayload = payload
  onDismissed = onWindowGone

  const area = screen.getPrimaryDisplay().workArea
  alertWindow = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    x: Math.round(area.x + (area.width - POPUP_WIDTH) / 2),
    y: Math.round(area.y + (area.height - POPUP_HEIGHT) / 2),
    frame: false,
    show: false,
    title: 'Reminder',
    // Dismissable only through its own controls. `closable: false` also means
    // Alt+F4 and any stray close() do nothing — teardown must use destroy(),
    // which is why runTeardown destroys these explicitly before quitting.
    closable: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    movable: true,
    // Reachable on purpose: a window that is always on top, cannot be closed and
    // is not in the taskbar is a trap if it ever loses focus.
    skipTaskbar: false,
    backgroundColor: '#18181b',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  alertWindow.setAlwaysOnTop(true, 'screen-saver')
  alertWindow.setVisibleOnAllWorkspaces(true)

  const win = alertWindow
  win.once('ready-to-show', () => {
    // Electron invokes this from its own emitter, so an escaping throw becomes an
    // uncaught exception in the main process — and `applyTier` touches `screen` and
    // creates windows, both of which can fail. The alert being slightly wrong is
    // survivable; taking the process down with it is not.
    try {
      if (win.isDestroyed()) return
      win.show()
      win.focus()
      applyTier(currentPayload ?? payload)
    } catch (err) {
      console.error(`[reminders] presenting the alert window failed: ${(err as Error).message}`)
    }
  })

  win.on('closed', () => {
    if (alertWindow === win) {
      alertWindow = null
      currentKey = null
      currentPayload = null
      destroyDimWindows()
      const cb = onDismissed
      onDismissed = null
      cb?.()
    }
  })

  /**
   * Treat this surface as gone, whatever state Electron left it in.
   *
   * FALSIFIED ASSUMPTION: the previous code assumed a crashed renderer made the
   * window vanish, so `onWindowGone` would fire and the queue would advance. In
   * real Electron it does not. `render-process-gone` fires, `closed` does NOT, and
   * `isDestroyed()` stays false — so `isAlertWindowOpen()` kept returning true,
   * `pumpQueue()`'s only recovery could never trigger, and the user was left with a
   * blank, frameless, always-on-top, `closable: false` window and no further alerts
   * for the rest of the session. At blackout tier that is a full-screen blank
   * whose only exit is quitting the app.
   *
   * So the crash signals are wired explicitly: destroy the window, then let the
   * ordinary `closed` path report it. Nulling `alertWindow` before `destroy()`
   * would suppress that callback, so the handle is left in place and the
   * `alertWindow === win` check does the work.
   */
  const treatAsGone = (reason: string): void => {
    if (alertWindow !== win) return
    console.error(`[reminders] alert window ${reason} — destroying it and advancing the queue`)
    if (win.isDestroyed()) {
      // No 'closed' event will come; drive the same bookkeeping by hand.
      alertWindow = null
      currentKey = null
      currentPayload = null
      destroyDimWindows()
      const cb = onDismissed
      onDismissed = null
      cb?.()
      return
    }
    win.destroy()
  }

  win.webContents.on('render-process-gone', (_e, details) => {
    treatAsGone(`renderer process is gone (${details?.reason ?? 'unknown'})`)
  })
  win.on('unresponsive', () => treatAsGone('stopped responding'))
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, _url, isMainFrame) => {
    // -3 is ERR_ABORTED, which is what a superseded navigation looks like — our own
    // reload of the same window, for instance. Only a main-frame failure means the
    // alert has no UI.
    if (!isMainFrame || errorCode === -3) return
    treatAsGone(`failed to load (${errorCode} ${errorDescription})`)
  })

  loadRenderer(win, `/alert/${key}`)
}

/** Push a changed payload (new tier, new queue count) into the live window. */
export function updateAlert(payload: ReminderAlertPayload): void {
  if (!isAlertWindowOpen() || currentKey !== payloadKey(payload)) return
  currentPayload = payload
  applyTier(payload)
  pushPayload()
}

function pushPayload(): void {
  if (!alertWindow || alertWindow.isDestroyed() || !currentPayload) return
  alertWindow.webContents.send(IPC.REMINDER_ALERT_CHANGED, currentPayload)
}

/**
 * Take down the alert surfaces.
 *
 * `destroy()` rather than `close()`: the window is `closable: false`, so close()
 * is a no-op on Windows — and a non-closable window left standing would stop
 * `app.quit()` from ever completing.
 */
export function closeAlert(): void {
  destroyDimWindows()
  // Order matters: clear the callback and the handle BEFORE destroying, so the
  // 'closed' listener's `alertWindow === win` check fails and it does not report
  // an unexpected disappearance for a window we took down deliberately.
  onDismissed = null
  currentPayload = null
  currentKey = null
  const win = alertWindow
  alertWindow = null
  if (win && !win.isDestroyed()) win.destroy()
}
