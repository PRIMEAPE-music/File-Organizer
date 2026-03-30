import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type { TaskFilterState, TaskStatus } from '../../shared/types'
import * as tasksRepo from '../db/repositories/tasks.repo'
import * as taskCatsRepo from '../db/repositories/task-categories.repo'

export function registerTaskHandlers(): void {
  // Tasks
  ipcMain.handle(IPC.GET_TASKS, async (_event, filter: TaskFilterState) => {
    return tasksRepo.getTasks(filter)
  })

  ipcMain.handle(IPC.GET_TASK, async (_event, id: number) => {
    return tasksRepo.getTaskById(id)
  })

  ipcMain.handle(IPC.CREATE_TASK, async (_event, data: { title: string; description?: string; status?: string; priority?: string; due_date?: string | null; category_id?: number | null }) => {
    return tasksRepo.createTask(data)
  })

  ipcMain.handle(IPC.UPDATE_TASK, async (_event, id: number, data: { title?: string; description?: string; status?: string; priority?: string; due_date?: string | null; category_id?: number | null }) => {
    return tasksRepo.updateTask(id, data)
  })

  ipcMain.handle(IPC.DELETE_TASK, async (_event, id: number) => {
    tasksRepo.deleteTask(id)
  })

  ipcMain.handle(IPC.REORDER_TASK, async (_event, id: number, status: TaskStatus, sortOrder: number) => {
    tasksRepo.reorderTask(id, status, sortOrder)
  })

  ipcMain.handle(IPC.SET_TASK_CATEGORY, async (_event, taskId: number, categoryId: number | null) => {
    tasksRepo.setTaskCategory(taskId, categoryId)
  })

  ipcMain.handle(IPC.ADD_TASK_TAG, async (_event, taskId: number, tagId: number) => {
    taskCatsRepo.addTaskTag(taskId, tagId)
  })

  ipcMain.handle(IPC.REMOVE_TASK_TAG, async (_event, taskId: number, tagId: number) => {
    taskCatsRepo.removeTaskTag(taskId, tagId)
  })

  // Task Categories
  ipcMain.handle(IPC.GET_TASK_CATEGORIES, async () => {
    return taskCatsRepo.getAllTaskCategories()
  })

  ipcMain.handle(IPC.CREATE_TASK_CATEGORY, async (_event, name: string, color: string) => {
    return taskCatsRepo.createTaskCategory(name, color)
  })

  ipcMain.handle(IPC.UPDATE_TASK_CATEGORY, async (_event, id: number, name: string, color: string) => {
    return taskCatsRepo.updateTaskCategory(id, name, color)
  })

  ipcMain.handle(IPC.DELETE_TASK_CATEGORY, async (_event, id: number) => {
    taskCatsRepo.deleteTaskCategory(id)
  })

  // Task Tags
  ipcMain.handle(IPC.GET_TASK_TAGS, async () => {
    return taskCatsRepo.getAllTaskTags()
  })

  ipcMain.handle(IPC.CREATE_TASK_TAG, async (_event, name: string, color: string) => {
    return taskCatsRepo.createTaskTag(name, color)
  })

  ipcMain.handle(IPC.UPDATE_TASK_TAG, async (_event, id: number, name: string, color: string) => {
    return taskCatsRepo.updateTaskTag(id, name, color)
  })

  ipcMain.handle(IPC.DELETE_TASK_TAG, async (_event, id: number) => {
    taskCatsRepo.deleteTaskTag(id)
  })
}
