import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type { AppPreferences } from '../../shared/types'
import { getAppPrefs, setAppPrefs } from '../services/app-prefs.service'

/**
 * @param onChange Called after a successful write so the caller can refresh
 *   anything that mirrors these prefs (the tray menu's checkbox state).
 */
export function registerAppPrefsHandlers(onChange: (prefs: AppPreferences) => void): void {
  ipcMain.handle(IPC.APP_PREFS_GET, (): AppPreferences => getAppPrefs())

  ipcMain.handle(IPC.APP_PREFS_SET, (_e, patch: Partial<AppPreferences>): AppPreferences => {
    const next = setAppPrefs(patch)
    onChange(next)
    return next
  })
}
