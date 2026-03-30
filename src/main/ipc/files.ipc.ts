import { ipcMain, shell } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import * as filesRepo from '../db/repositories/files.repo'
import { addRecent } from '../db/repositories/recents.repo'
import type { FilterState } from '../../shared/types'

export function registerFileHandlers(): void {
  ipcMain.handle(IPC.GET_FILES, async (_event, filter: FilterState) => {
    return filesRepo.getFiles(filter)
  })

  ipcMain.handle(IPC.SEARCH_FILES, async (_event, query: string) => {
    return filesRepo.searchFiles(query)
  })

  ipcMain.handle(IPC.GET_FILE, async (_event, id: number) => {
    return filesRepo.getFileById(id)
  })

  ipcMain.handle(IPC.OPEN_FILE, async (_event, fileId: number) => {
    const file = filesRepo.getFileById(fileId)
    if (!file) return false
    addRecent(fileId)
    await shell.openPath(file.path)
    return true
  })

  ipcMain.handle(IPC.OPEN_FILE_LOCATION, async (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle(IPC.SET_FILE_CATEGORY, async (_event, fileId: number, categoryId: number | null) => {
    filesRepo.setFileCategory(fileId, categoryId)
  })
}
