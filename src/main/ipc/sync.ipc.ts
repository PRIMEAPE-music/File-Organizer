import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { guardWrite } from '../utils/error-reporter'
import type { SyncConfig, SyncPreferences } from '../../shared/types'
import {
  getSyncConfig,
  getSyncConfigPath,
  setSyncConfig,
  getSyncedPrefs,
  clearSyncedPrefs,
  selectSyncFolder,
  exportData,
  importData,
  updateCurrentPrefs
} from '../services/sync.service'
import { rescheduleNow } from '../services/reminder.service'

export function registerSyncHandlers(): void {
  ipcMain.handle(IPC.SYNC_GET_CONFIG, (): SyncConfig => {
    return getSyncConfig()
  })

  ipcMain.handle(IPC.SYNC_SET_CONFIG, (_e, config: SyncConfig): void => {
    // The renderer awaits this without a catch, so a raw throw would surface as
    // an unhandled rejection. Turn it into a visible banner instead.
    // Full path, like every other guardWrite call site — the banner renders this
    // as the file's location, so a bare filename would be a lie.
    guardWrite(getSyncConfigPath(), () => setSyncConfig(config))
  })

  ipcMain.handle(IPC.SYNC_SELECT_FOLDER, (): string | null => {
    return selectSyncFolder()
  })

  ipcMain.handle(IPC.SYNC_UPDATE_PREFS, (_e, prefs: SyncPreferences): void => {
    updateCurrentPrefs(prefs)
  })

  ipcMain.handle(IPC.SYNC_GET_SYNCED_PREFS, (): SyncPreferences | null => {
    const prefs = getSyncedPrefs()
    clearSyncedPrefs()
    return prefs
  })

  ipcMain.handle(IPC.SYNC_EXPORT, (_e, prefs: SyncPreferences) => {
    return exportData(prefs)
  })

  ipcMain.handle(IPC.SYNC_IMPORT, () => {
    const result = importData()
    // Imported reminder definitions have no occurrences yet on this machine.
    // Re-deriving now means a reminder that arrived over the wire is live
    // immediately instead of waiting for the next horizon top-up.
    rescheduleNow()
    return result
  })

  // Sync Now: import if remote is newer, then export — unless the read failed.
  ipcMain.handle(IPC.SYNC_NOW, (_e, prefs: SyncPreferences) => {
    const { result: importResult, preferences } = importData()
    rescheduleNow()

    // Never publish over a payload we could not read. Our snapshot is stale
    // relative to a remote we failed to merge, so exporting would drop whatever
    // only the remote had — the same write-after-failed-read mistake that
    // corrupt-read handling exists to prevent, one level up. A *missing* payload
    // is different: there is nothing to lose, and seeding the share is the
    // first-run case, so that one falls through to the export below.
    if (importResult.skipReason === 'unreadable' || importResult.skipReason === 'unreachable') {
      return {
        success: false,
        message: importResult.message,
        importedNewData: false,
        preferences: null
      }
    }

    const exportResult = exportData(prefs)

    if (!exportResult.success) {
      return { success: false, message: exportResult.message, importedNewData: false, preferences: null }
    }

    return {
      success: true,
      message: importResult.success ? importResult.message : exportResult.message,
      importedNewData: importResult.success,
      preferences,
      exportedAt: exportResult.exportedAt
    }
  })
}
