import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import * as favoritesRepo from '../db/repositories/favorites.repo'

export function registerFavoriteHandlers(): void {
  ipcMain.handle(IPC.TOGGLE_FAVORITE, async (_event, fileId: number) => {
    return favoritesRepo.toggleFavorite(fileId)
  })

  ipcMain.handle(IPC.IS_FAVORITE, async (_event, fileId: number) => {
    return favoritesRepo.isFavorite(fileId)
  })
}
