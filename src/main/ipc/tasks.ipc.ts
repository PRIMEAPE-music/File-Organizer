import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type { TaskFilterState, TaskStatus, TaskWithMeta } from '../../shared/types'
import * as tasksRepo from '../db/repositories/tasks.repo'
import * as taskCatsRepo from '../db/repositories/task-categories.repo'
import { removeTaskAutoReminder, syncTaskAutoReminder } from '../services/task-reminder.service'
import { rescheduleNow } from '../services/reminder.service'

/**
 * The priority automation is driven from here rather than from tasks.repo,
 * because deciding whether a task deserves a reminder needs app preferences
 * (threshold, lead time) — a dependency the repository layer has no business
 * carrying. It runs only on these create/update/delete paths, which is what makes
 * "no backfill" true: nothing ever sweeps the existing task table.
 *
 * A failure here must not lose the user's task edit, so the reminder side effect
 * is isolated: the task write has already committed by the time it runs.
 */
function reconcileTaskReminder(task: TaskWithMeta): void {
  try {
    const outcome = syncTaskAutoReminder(task)
    if (outcome.action !== 'none') rescheduleNow()
  } catch (err) {
    console.error(`[reminders] task automation failed for task ${task.id}: ${(err as Error).message}`)
  }
}

export function registerTaskHandlers(): void {
  // Tasks
  ipcMain.handle(IPC.GET_TASKS, async (_event, filter: TaskFilterState) => {
    return tasksRepo.getTasks(filter)
  })

  ipcMain.handle(IPC.GET_TASK, async (_event, id: number) => {
    return tasksRepo.getTaskById(id)
  })

  ipcMain.handle(IPC.CREATE_TASK, async (_event, data: { title: string; description?: string; status?: string; priority?: string; due_date?: string | null; category_id?: number | null }) => {
    const task = tasksRepo.createTask(data)
    reconcileTaskReminder(task)
    return task
  })

  ipcMain.handle(IPC.UPDATE_TASK, async (_event, id: number, data: { title?: string; description?: string; status?: string; priority?: string; due_date?: string | null; category_id?: number | null }) => {
    const task = tasksRepo.updateTask(id, data)
    reconcileTaskReminder(task)
    return task
  })

  ipcMain.handle(IPC.DELETE_TASK, async (_event, id: number) => {
    tasksRepo.deleteTask(id)
    // Only the auto-created reminder goes. A reminder the user set by hand on this
    // task is theirs; `entity_id` simply stops resolving to a title.
    try {
      if (removeTaskAutoReminder(id) > 0) rescheduleNow()
    } catch (err) {
      console.error(`[reminders] could not clean up reminders for task ${id}: ${(err as Error).message}`)
    }
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
