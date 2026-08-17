import { app } from 'electron'
import path from 'path'
import { loadJson, writeJsonAtomic } from '../utils/safe-fs'
import { guardWrite, reportPersistenceIssue } from '../utils/error-reporter'
import type { AppPreferences } from '../../shared/types'

/**
 * App-level behaviour preferences that the main process needs before (and
 * without) a renderer: whether closing the window hides to the tray, and
 * whether to launch at login.
 */

/** Passed to the login-item launcher so an autostarted app goes straight to tray. */
export const HIDDEN_ARG = '--hidden'

const DEFAULTS: AppPreferences = {
  closeToTray: true,
  openAtLogin: false
}

const prefsPath = (): string => path.join(app.getPath('userData'), 'app-prefs.json')

let cached: AppPreferences | null = null

export function getAppPrefs(): AppPreferences {
  if (!cached) {
    // ownership 'local': app-prefs.json lives in userData and this app is its
    // only writer, so quarantine + .bak restore is the correct recovery.
    const { data, issue } = loadJson<Partial<AppPreferences>>(prefsPath(), {}, {
      ownership: 'local'
    })
    if (issue) reportPersistenceIssue('corrupt', issue.file, issue.detail)
    cached = {
      closeToTray: typeof data.closeToTray === 'boolean' ? data.closeToTray : DEFAULTS.closeToTray,
      openAtLogin: typeof data.openAtLogin === 'boolean' ? data.openAtLogin : DEFAULTS.openAtLogin
    }
  }
  return cached
}

export function setAppPrefs(patch: Partial<AppPreferences>): AppPreferences {
  const previous = getAppPrefs()
  // Compare against the *observable* login-item state, not the cached pref. If
  // the two have drifted (reinstall, entry removed by hand) we still want to
  // re-assert; if they agree, toggling an unrelated pref like closeToTray must
  // not rewrite the OS login item for nothing.
  const wasEnabled = isOpenAtLoginEnabled()

  const merged: AppPreferences = { ...previous, ...patch }
  cached = merged
  guardWrite(prefsPath(), () => writeJsonAtomic(prefsPath(), merged))

  if (merged.openAtLogin !== wasEnabled) applyOpenAtLogin(merged.openAtLogin)
  return merged
}

/**
 * Registers/unregisters the OS login item.
 *
 * Guarded on `app.isPackaged`: unpackaged, `process.execPath` is the raw
 * electron.exe from node_modules, so registering it would add a meaningless
 * (and confusing) startup entry. In dev we persist the preference only.
 */
export function applyOpenAtLogin(enabled: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: [HIDDEN_ARG]
  })
}

/**
 * The real, observable autostart state — what the tray checkbox must reflect.
 * Packaged: ask the OS. Unpackaged: there is no OS entry, so the stored
 * preference *is* the truth.
 */
export function isOpenAtLoginEnabled(): boolean {
  if (!app.isPackaged) return getAppPrefs().openAtLogin
  try {
    return app.getLoginItemSettings({ path: process.execPath, args: [HIDDEN_ARG] }).openAtLogin
  } catch {
    return getAppPrefs().openAtLogin
  }
}

/**
 * Re-assert the stored preference against the OS at startup, so a reinstall or
 * an externally removed startup entry doesn't leave the two disagreeing.
 */
export function reconcileOpenAtLogin(): void {
  if (!app.isPackaged) return
  const wanted = getAppPrefs().openAtLogin
  if (isOpenAtLoginEnabled() !== wanted) applyOpenAtLogin(wanted)
}

/** True when this launch should go straight to the tray without showing a window. */
export function launchedHidden(): boolean {
  return process.argv.includes(HIDDEN_ARG)
}
