import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import * as remindersRepo from '../db/repositories/reminders.repo'
import * as reminderService from '../services/reminder.service'
import {
  getTaskAutoReminder,
  getTaskManualReminder,
  setTaskManualReminder
} from '../services/task-reminder.service'
import type {
  Reminder,
  ReminderAlertPayload,
  ReminderInput,
  ReminderIntensity,
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
    // An edit from the Reminders tab is a person editing a reminder, so it takes
    // ownership: `auto_created` is cleared and the task automation stops rewriting
    // the row from preference defaults. The entity link stays, so the reminder still
    // names the task it belongs to. Without this, switching a task reminder to
    // blackout with a custom escalation was silently reverted the next time that
    // task was saved.
    const updated = remindersRepo.updateReminder(id, input, { takeOwnership: true })
    reminderService.rescheduleNow()
    return updated
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
