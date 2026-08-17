import { app } from 'electron'
import path from 'path'
import { loadJson, writeJsonAtomic } from '../utils/safe-fs'
import { guardWrite, reportPersistenceIssue } from '../utils/error-reporter'
import type { AppPreferences, ReminderIntensity, TaskPriority } from '../../shared/types'

/**
 * App-level behaviour preferences that the main process needs before (and
 * without) a renderer: whether closing the window hides to the tray, and
 * whether to launch at login.
 */

/** Passed to the login-item launcher so an autostarted app goes straight to tray. */
export const HIDDEN_ARG = '--hidden'

const DEFAULTS: AppPreferences = {
  closeToTray: true,
  openAtLogin: false,
  // 'high' means high AND urgent qualify.
  reminderPriorityThreshold: 'high',
  // 0 = fire at the due moment itself. A date-only due date is read as 9am local,
  // so the out-of-the-box behaviour is "9am on the day it's due".
  reminderDefaultLeadMin: 0,
  // Matches the schema default. Starting everyone at a full-screen blackout would
  // be a hostile default; escalation is what gets louder.
  reminderDefaultIntensity: 'toast',
  reminderDefaultEscalateMin: 5
}

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
const INTENSITIES: ReminderIntensity[] = ['toast', 'popup', 'blackout']

/** Clamp so a hand-edited prefs file can't produce a nonsense schedule. */
const MAX_LEAD_MIN = 60 * 24 * 30
const MAX_ESCALATE_MIN = 60 * 24

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
      openAtLogin: typeof data.openAtLogin === 'boolean' ? data.openAtLogin : DEFAULTS.openAtLogin,
      // Field-by-field validation, same as above: these feed the scheduler, and a
      // garbage value there is a reminder that fires at the wrong time or never.
      reminderPriorityThreshold: PRIORITIES.includes(data.reminderPriorityThreshold as TaskPriority)
        ? (data.reminderPriorityThreshold as TaskPriority)
        : DEFAULTS.reminderPriorityThreshold,
      reminderDefaultLeadMin:
        typeof data.reminderDefaultLeadMin === 'number' && Number.isFinite(data.reminderDefaultLeadMin)
          ? Math.min(MAX_LEAD_MIN, Math.max(0, Math.round(data.reminderDefaultLeadMin)))
          : DEFAULTS.reminderDefaultLeadMin,
      reminderDefaultIntensity: INTENSITIES.includes(data.reminderDefaultIntensity as ReminderIntensity)
        ? (data.reminderDefaultIntensity as ReminderIntensity)
        : DEFAULTS.reminderDefaultIntensity,
      reminderDefaultEscalateMin:
        data.reminderDefaultEscalateMin === null
          ? null
          : typeof data.reminderDefaultEscalateMin === 'number' &&
              Number.isFinite(data.reminderDefaultEscalateMin) &&
              data.reminderDefaultEscalateMin > 0
            ? Math.min(MAX_ESCALATE_MIN, Math.round(data.reminderDefaultEscalateMin))
            : DEFAULTS.reminderDefaultEscalateMin
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
