import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type { TaskFilterState, TaskStatus, TaskWithMeta } from '../../shared/types'
import * as tasksRepo from '../db/repositories/tasks.repo'
import * as taskCatsRepo from '../db/repositories/task-categories.repo'
import {
  removeTaskAutoReminder,
  syncTaskAutoReminder,
  syncTaskManualReminderStatus
} from '../services/task-reminder.service'
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
 *
 * BOTH of the task's reminders are reconciled here. The automatic one follows the
 * task's priority and due date; the hand-made one follows only whether the task's
 * status CROSSED the done boundary — a task that has just been completed stops
 * reminding, unless the reminder repeats. The status rule cannot live in
 * `setTaskManualReminder`, because that is reached only when the modal's reminder
 * controls themselves changed, so a save that merely ticks the task off as done never
 * calls it.
 *
 * The two touch disjoint rows (`auto_created = 1` versus `= 0`), so the order is not
 * load-bearing; the automation goes first because it is the one that may CREATE a row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY HANDLER THAT WRITES `status`, `priority` OR `due_date` MUST CALL THIS, and
 * must read the task's previous status first. `IPC.REORDER_TASK` did not, and dragging
 * a card into the kanban Done column is probably the commonest way a task is finished
 * — so both reminder rules looked intermittent: they applied when the task was
 * completed through the modal and not when it was dragged, and only the next unrelated
 * save cleaned up after the drag.
 *
 * The rest of the task-mutating surface, for the record: `IPC.CREATE_TASK` and
 * `IPC.UPDATE_TASK` reconcile; `IPC.DELETE_TASK` runs `removeTaskAutoReminder` instead
 * (a hand-made reminder outlives its task deliberately); `IPC.SET_TASK_CATEGORY` and
 * the tag handlers touch none of the three columns a reminder is derived from.
 *
 * The sync importer is the one remaining writer of `status` that does not reconcile,
 * and deliberately so: it merges task rows and reminder rows in the SAME transaction
 * from one payload, so the exporting machine's own decision travels as the reminder
 * row's `enabled` field. That is not airtight — last-write-wins is per row, so a task
 * that went done remotely can land beside a locally-newer reminder row that stays
 * armed — but reconciling mid-import would mean deciding on behalf of the other
 * machine, from inside a transaction, without a previous status to compare against.
 * Left as a known edge rather than papered over.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @param previousStatus the status the row held BEFORE the write, or null if it could
 *   not be read (a create). Only a crossing of the done boundary is the task saying
 *   anything about the hand-made reminder; a save that leaves the status alone must
 *   leave the user's own on/off choice alone too — see `syncTaskManualReminderStatus`.
 */
function reconcileTaskReminder(task: TaskWithMeta, previousStatus: TaskStatus | null): void {
  try {
    const auto = syncTaskAutoReminder(task)
    const manual = syncTaskManualReminderStatus(task, previousStatus)
    // Either path may have changed what is owed and when. Both are 'none' whenever
    // nothing was written, which is the common case on an ordinary save.
    if (auto.action !== 'none' || manual.action !== 'none') rescheduleNow()
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
    // No previous status: the row did not exist a moment ago, so nothing has crossed
    // anything. A task created directly as done and ticked "Remind me" in the same
    // breath is settled by `setTaskManualReminder`, which the renderer calls next.
    reconcileTaskReminder(task, null)
    return task
  })

  ipcMain.handle(IPC.UPDATE_TASK, async (_event, id: number, data: { title?: string; description?: string; status?: string; priority?: string; due_date?: string | null; category_id?: number | null }) => {
    // Read BEFORE the write, or the comparison has nothing to compare against.
    const previousStatus = tasksRepo.getTaskStatus(id)
    const task = tasksRepo.updateTask(id, data)
    reconcileTaskReminder(task, previousStatus)
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

  // The kanban drag. It writes `status`, so it reconciles exactly as a modal save does
  // — dropping a card into Done is the same statement about the task as choosing Done
  // in the dropdown, and used to be the one that got away with saying nothing.
  //
  // A drag WITHIN a column changes only `sort_order`, so `previousStatus` matches and
  // the hand-made rule returns without a lookup; the automation's own recompute is
  // idempotent (see `syncTaskAutoReminder`), so reordering a column writes nothing to
  // the reminders table however many times it happens.
  ipcMain.handle(IPC.REORDER_TASK, async (_event, id: number, status: TaskStatus, sortOrder: number) => {
    const previousStatus = tasksRepo.getTaskStatus(id)
    tasksRepo.reorderTask(id, status, sortOrder)
    // Re-read rather than synthesising: the automation needs the task's title, priority
    // and due date, and `reorderTask` returns nothing. Undefined means the row was
    // deleted between the two statements — there is then no task to reconcile against.
    const task = tasksRepo.getTaskById(id)
    if (task) reconcileTaskReminder(task, previousStatus)
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
