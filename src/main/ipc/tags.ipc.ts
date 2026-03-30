import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import * as tagsRepo from '../db/repositories/tags.repo'

export function registerTagHandlers(): void {
  ipcMain.handle(IPC.GET_TAGS, async () => {
    return tagsRepo.getAllTags()
  })

  ipcMain.handle(IPC.CREATE_TAG, async (_event, name: string, color: string) => {
    return tagsRepo.createTag(name, color)
  })

  ipcMain.handle(IPC.UPDATE_TAG, async (_event, id: number, name: string, color: string) => {
    return tagsRepo.updateTag(id, name, color)
  })

  ipcMain.handle(IPC.DELETE_TAG, async (_event, id: number) => {
    tagsRepo.deleteTag(id)
  })

  ipcMain.handle(IPC.ADD_FILE_TAG, async (_event, fileId: number, tagId: number) => {
    tagsRepo.addFileTag(fileId, tagId)
  })

  ipcMain.handle(IPC.REMOVE_FILE_TAG, async (_event, fileId: number, tagId: number) => {
    tagsRepo.removeFileTag(fileId, tagId)
  })

  ipcMain.handle(IPC.GET_FILE_TAGS, async (_event, fileId: number) => {
    return tagsRepo.getFileTags(fileId)
  })
}
