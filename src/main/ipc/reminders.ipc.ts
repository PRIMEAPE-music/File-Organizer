import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import * as remindersRepo from '../db/repositories/reminders.repo'
import * as reminderService from '../services/reminder.service'
import {
  editDetachesFromTask,
  getTaskAutoReminder,
  getTaskManualReminder,
  resetTaskReminderToAutomatic,
  setTaskManualReminder
} from '../services/task-reminder.service'
import type {
  Reminder,
  ReminderAlertPayload,
  ReminderInput,
  ReminderIntensity,
  ReminderResetResult,
  ReminderSnoozeChoice,
  ReminderWithMeta,
  Task
} from '../../shared/types'
import { getDb } from '../db/database'

/**
 * Thin handlers, per the convention here: the repository owns enrichment and the
 * service owns timing, so these mostly translate and forward. The one thing they
 * add is calling `rescheduleNow()` after any write that changes what is owed, so
 * an edit takes effect immediately rather than on the next heartbeat.
 */
export function registerReminderHandlers(): void {
  ipcMain.handle(IPC.GET_REMINDERS, (): ReminderWithMeta[] => remindersRepo.getReminders())

  ipcMain.handle(IPC.GET_REMINDER, (_e, id: number) => remindersRepo.getReminderById(id))

  ipcMain.handle(IPC.CREATE_REMINDER, (_e, input: ReminderInput): ReminderWithMeta => {
    const created = remindersRepo.createReminder(input)
    reminderService.rescheduleNow()
    return created
  })

  ipcMain.handle(IPC.UPDATE_REMINDER, (_e, id: number, input: ReminderInput) => {
    // THE TASK OWNS *WHEN*, THE USER OWNS *HOW*. An edit from the Reminders tab used
    // to detach the reminder from its task unconditionally, so changing only the
    // tier silently stopped the task's due date from ever moving it again — with
    // nothing in the UI to say the link was gone.
    //
    // Now only a timing edit detaches, and the decision is made by comparing what
    // was submitted against the stored row rather than trusting anything the
    // renderer says about its own intent. See `editDetachesFromTask`.
    const current = remindersRepo.getRawReminder(id)
    const detaches = current ? editDetachesFromTask(current, input) : false
    const updated = remindersRepo.updateReminder(id, input, { takeOwnership: detaches })
    reminderService.rescheduleNow()
    return updated
  })

  ipcMain.handle(IPC.RESET_REMINDER_TO_AUTO, (_e, id: number): ReminderResetResult => {
    // The way back from a timing edit. Without it a detach is a one-way door, and a
    // reminder that has quietly stopped following its task is exactly the state the
    // user got stuck in before.
    const result = resetTaskReminderToAutomatic(id)
    reminderService.rescheduleNow()
    return result
  })

  ipcMain.handle(IPC.DELETE_REMINDER, (_e, id: number): void => {
    remindersRepo.deleteReminder(id)
    reminderService.dropAlertsForReminder(id)
    reminderService.rescheduleNow()
  })

  ipcMain.handle(IPC.SET_REMINDER_ENABLED, (_e, id: number, enabled: boolean) => {
    const updated = remindersRepo.setReminderEnabled(id, enabled)
    // Disabling settles any firing occurrence in the database; this takes the
    // alert window down with it rather than leaving an orphaned popup on screen.
    if (!enabled) reminderService.dropAlertsForReminder(id)
    reminderService.rescheduleNow()
    return updated
  })

  ipcMain.handle(
    IPC.SNOOZE_OCCURRENCE,
    (_e, occurrenceId: number, choice: ReminderSnoozeChoice): void => {
      reminderService.snooze(occurrenceId, choice)
    }
  )

  ipcMain.handle(IPC.DISMISS_OCCURRENCE, (_e, occurrenceId: number): void => {
    reminderService.acknowledge(occurrenceId)
  })

  ipcMain.handle(IPC.SNOOZE_ALL_REMINDERS, (_e, minutes?: number): number =>
    reminderService.snoozeAllFiring(minutes ?? 15)
  )

  ipcMain.handle(
    IPC.TEST_FIRE_REMINDER,
    (_e, reminderId: number, tier?: ReminderIntensity): boolean =>
      reminderService.testFire(reminderId, tier)
  )

  // ─── Task integration ───

  ipcMain.handle(
    IPC.GET_TASK_REMINDER,
    (_e, taskId: number): { manual: Reminder | null; auto: Reminder | null } => ({
      manual: getTaskManualReminder(taskId),
      auto: getTaskAutoReminder(taskId)
    })
  )

  ipcMain.handle(
    IPC.SET_TASK_REMINDER,
    (_e, taskId: number, enabled: boolean, leadMinutes: number) => {
      const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as
        | Task
        | undefined
      if (!task) return { ok: false, message: 'Task no longer exists.', reminderId: null }
      const result = setTaskManualReminder(task, enabled, leadMinutes)
      reminderService.rescheduleNow()
      return result
    }
  )

  // ─── Alert window ───

  ipcMain.handle(IPC.REMINDER_ALERT_GET, (): ReminderAlertPayload | null =>
    reminderService.getActiveAlertPayload()
  )

  ipcMain.handle(IPC.REMINDER_ALERT_ACK, (_e, occurrenceId: number | null): void => {
    if (occurrenceId === null) {
      // The digest stands in for rows already recorded as missed; dismissing it
      // acknowledges nothing individually.
      reminderService.dismissActiveDigest()
      return
    }
    reminderService.acknowledge(occurrenceId)
  })

  ipcMain.handle(
    IPC.REMINDER_ALERT_SNOOZE,
    (_e, occurrenceId: number | null, choice: ReminderSnoozeChoice): void => {
      if (occurrenceId === null) {
        reminderService.dismissActiveDigest()
        return
      }
      reminderService.snooze(occurrenceId, choice)
    }
  )
}
