import { ipcMain, dialog, BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import * as foldersRepo from '../db/repositories/folders.repo'
import * as filesRepo from '../db/repositories/files.repo'
import { scanFolder } from '../services/scanner.service'
import { addWatchPath, removeWatchPath } from '../services/watcher.service'

export function registerFolderHandlers(): void {
  ipcMain.handle(IPC.SELECT_FOLDER, async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.ADD_FOLDER, async (_event, folderPath: string, recursive: boolean = true) => {
    const folder = foldersRepo.addFolder(folderPath, recursive)
    const fileCount = scanFolder(folderPath, folder.id, !!folder.recursive)
    addWatchPath(folderPath)
    return { folder, fileCount }
  })

  ipcMain.handle(IPC.REMOVE_FOLDER, async (_event, id: number) => {
    const folder = foldersRepo.getFolderById(id)
    if (folder) {
      removeWatchPath(folder.path)
      filesRepo.removeFilesByFolder(id)
    }
    foldersRepo.removeFolder(id)
  })

  ipcMain.handle(IPC.GET_FOLDERS, async () => {
    return foldersRepo.getAllFolders()
  })

  ipcMain.handle(IPC.RESCAN_FOLDER, async (_event, id: number) => {
    const folder = foldersRepo.getFolderById(id)
    if (!folder) return 0
    const count = scanFolder(folder.path, folder.id, !!folder.recursive)
    filesRepo.removeStaleFiles(folder.id)
    return count
  })
}
