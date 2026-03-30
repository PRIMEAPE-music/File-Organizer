import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import * as categoriesRepo from '../db/repositories/categories.repo'

export function registerCategoryHandlers(): void {
  ipcMain.handle(IPC.GET_CATEGORIES, async () => {
    return categoriesRepo.getAllCategories()
  })

  ipcMain.handle(IPC.CREATE_CATEGORY, async (_event, name: string, color: string) => {
    return categoriesRepo.createCategory(name, color)
  })

  ipcMain.handle(IPC.UPDATE_CATEGORY, async (_event, id: number, name: string, color: string) => {
    return categoriesRepo.updateCategory(id, name, color)
  })

  ipcMain.handle(IPC.DELETE_CATEGORY, async (_event, id: number) => {
    categoriesRepo.deleteCategory(id)
  })
}
