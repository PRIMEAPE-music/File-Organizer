import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type { SyncConfig, SyncPreferences } from '../../shared/types'
import {
  getSyncConfig,
  setSyncConfig,
  getSyncedPrefs,
  clearSyncedPrefs,
  selectSyncFolder,
  exportData,
  importData,
  updateCurrentPrefs
} from '../services/sync.service'

export function registerSyncHandlers(): void {
  ipcMain.handle(IPC.SYNC_GET_CONFIG, (): SyncConfig => {
    return getSyncConfig()
  })

  ipcMain.handle(IPC.SYNC_SET_CONFIG, (_e, config: SyncConfig): void => {
    setSyncConfig(config)
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
    return importData()
  })

  // Sync Now: import if remote is newer, then always export
  ipcMain.handle(IPC.SYNC_NOW, (_e, prefs: SyncPreferences) => {
    const { result: importResult, preferences } = importData()
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
