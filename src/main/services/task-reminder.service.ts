import * as repo from '../db/repositories/reminders.repo'
import { dueDateToInstant } from '../utils/recurrence'
import { getAppPrefs } from './app-prefs.service'
import type { Task, TaskPriority, ReminderInput } from '../../shared/types'

/**
 * Automatic reminders derived from task priority.
 *
 * THE RULE THAT MATTERS MOST: this only ever touches `auto_created = 1` rows. A
 * reminder the user set by hand on a task survives every priority change, due
 * date edit and even the task's deletion path here — see
 * `deleteAutoRemindersForEntity`, whose predicate is the guard. Editing a reminder
 * in the Reminders tab clears `auto_created`, so a customised reminder becomes the
 * user's and this stops rewriting it.
 *
 * ONE REMINDER PER TASK, and identity is preserved for sync:
 *
 *  - When the task stops qualifying, the auto reminder is DISABLED IN PLACE, not
 *    deleted. Deleting it minted a new `sync_id` on the next qualification, and
 *    since the importer never deletes local-only rows (deliberately — no machine
 *    may silently cancel another's reminders), raising and lowering a task's
 *    priority N times left the other machine with N enabled reminders for one
 *    task, all firing. Disabling travels over sync as a field; deleting does not
 *    travel at all.
 *  - It creates only when the task has NO reminder of any kind. Otherwise the
 *    user's own reminder would be joined by a second one for the same task.
 *
 * NO BACKFILL. Only a due date in the *future* qualifies, and the decision is
 * only ever made when a task is created or updated. Shipping this must not greet
 * the user with a wall of missed alerts derived from last year's tasks, and a
 * reconcile-everything pass would do exactly that.
 */

const PRIORITY_RANK: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3
}

function rank(priority: string): number {
  return PRIORITY_RANK[priority as TaskPriority] ?? 0
}

export function meetsThreshold(priority: string, threshold: TaskPriority): boolean {
  return rank(priority) >= rank(threshold)
}

/**
 * The instant an auto reminder for this task should fire, or null if it should
 * not exist: no due date, a due date already past, or the lead time pushing the
 * firing into the past.
 *
 * A date-only `due_date` (which is all `<input type="date">` produces) is read as
 * 9am local on that day — see `dueDateToInstant`. Midnight would be a hostile
 * moment to be reminded of anything.
 */
export function computeAutoFireAt(
  dueDate: string | null,
  leadMinutes: number,
  nowMs: number = Date.now()
): Date | null {
  const due = dueDateToInstant(dueDate)
  if (!due) return null
  if (due.getTime() <= nowMs) return null

  const fireAt = new Date(due.getTime() - Math.max(0, leadMinutes) * 60_000)
  // The due date is in the future but the lead time overshoots into the past:
  // fire now-ish rather than never, since the task genuinely is nearly due.
  if (fireAt.getTime() <= nowMs) return new Date(nowMs + 1_000)
  return fireAt
}

export interface AutoReminderOutcome {
  action: 'created' | 'updated' | 'removed' | 'none'
  reminderId: number | null
}

/**
 * Bring a task's automatic reminder into line with its current priority and due
 * date. Safe to call on every create/update — it is a reconcile, not a toggle.
 */
export function syncTaskAutoReminder(
  task: Pick<Task, 'id' | 'title' | 'priority' | 'due_date' | 'status'>,
  nowMs: number = Date.now()
): AutoReminderOutcome {
  const prefs = getAppPrefs()

  // Collapse any duplicates a previous build (or an import) left behind, so the row
  // reconciled below is the only auto reminder this task has.
  const dupesRemoved = repo.dedupeAutoRemindersForEntity('task', task.id)
  const existing = repo.findAutoReminderForEntity('task', task.id)

  // `status` was missing from this decision entirely, so a task marked Done kept
  // its reminder and still fired — at blackout tier if that was the default. A
  // completed task is not owed a reminder whatever its priority says.
  const qualifies =
    task.status !== 'done' && meetsThreshold(task.priority, prefs.reminderPriorityThreshold)
  const fireAt = qualifies
    ? computeAutoFireAt(task.due_date, prefs.reminderDefaultLeadMin, nowMs)
    : null

  if (!fireAt) {
    // Completed, dropped below the threshold, lost its due date, or the due date has
    // passed. Disable rather than delete: the row (and its `sync_id`) is how the
    // other machine learns to stop firing it too.
    if (existing) {
      if (existing.enabled) {
        repo.setReminderEnabled(existing.id, false)
        return { action: 'removed', reminderId: existing.id }
      }
      return { action: dupesRemoved > 0 ? 'updated' : 'none', reminderId: existing.id }
    }
    return { action: dupesRemoved > 0 ? 'updated' : 'none', reminderId: null }
  }

  const input: ReminderInput = {
    title: `Task due: ${task.title}`,
    body: null,
    fire_at: fireAt.toISOString(),
    freq: null,
    interval: 1,
    byweekday: null,
    lead_time_min: prefs.reminderDefaultLeadMin,
    intensity: prefs.reminderDefaultIntensity,
    escalate_after_min: prefs.reminderDefaultEscalateMin,
    sound: null,
    entity_type: 'task',
    entity_id: task.id
  }

  if (existing) {
    // Nothing meaningful changed — don't rewrite the row (and don't discard its
    // pending occurrence) just because the task was saved again.
    if (
      existing.enabled === 1 &&
      existing.fire_at === input.fire_at &&
      existing.title === input.title &&
      existing.intensity === input.intensity &&
      existing.escalate_after_min === input.escalate_after_min &&
      existing.lead_time_min === input.lead_time_min
    ) {
      return { action: dupesRemoved > 0 ? 'updated' : 'none', reminderId: existing.id }
    }
    // In place, so the row keeps its `sync_id` and both machines go on agreeing
    // about which reminder this is. No takeOwnership: this row belongs to the
    // automation.
    repo.updateReminder(existing.id, input)
    // Re-arms one the automation had disabled. Ordered after the update so the
    // occurrences are materialised from the new fire_at, not the old one.
    if (!existing.enabled) repo.setReminderEnabled(existing.id, true)
    return { action: 'updated', reminderId: existing.id }
  }

  // No auto reminder for this task. If the user already has one here — hand-made,
  // or an auto reminder they edited and thereby took ownership of — leave it alone
  // rather than adding a second reminder for one task.
  if (repo.countRemindersForEntity('task', task.id) > 0) {
    return { action: dupesRemoved > 0 ? 'updated' : 'none', reminderId: null }
  }

  const created = repo.createReminder(input, { autoCreated: true })
  return { action: 'created', reminderId: created.id }
}

/** Called when a task is deleted. Hand-made reminders for it are NOT removed. */
export function removeTaskAutoReminder(taskId: number): number {
  return repo.deleteAutoRemindersForEntity('task', taskId)
}

/**
 * A task's own opt-in reminder ("Remind me" in the task modal), which is always
 * `auto_created = 0` so the priority automation will never touch it.
 *
 * Ticking the box on a task that already has an automatic reminder ADOPTS that row
 * rather than adding a second reminder for the same task: an explicit opt-in is a
 * user decision, and one task should have one reminder. The row keeps its `sync_id`
 * (so the other machine updates rather than accumulates) and loses `auto_created`,
 * which is what stops the automation reverting the user's lead time on the next
 * task save.
 *
 * @param enabled false removes the manual reminder (and only the manual one).
 */
export function setTaskManualReminder(
  task: Pick<Task, 'id' | 'title' | 'due_date'>,
  enabled: boolean,
  leadMinutes: number,
  nowMs: number = Date.now()
): { ok: boolean; message?: string; reminderId: number | null } {
  const manual = repo.findManualReminderForEntity('task', task.id)

  if (!enabled) {
    // Only ever the hand-made row. An automatic reminder is the automation's to
    // manage, and unticking this box is not a statement about the task's priority.
    if (manual) repo.deleteReminder(manual.id)
    return { ok: true, reminderId: null }
  }

  const existing = manual ?? repo.findAutoReminderForEntity('task', task.id)

  const due = dueDateToInstant(task.due_date)
  if (!due) {
    return { ok: false, message: 'Give the task a due date first.', reminderId: existing?.id ?? null }
  }

  const lead = Math.max(0, Math.round(leadMinutes))
  let fireAt = new Date(due.getTime() - lead * 60_000)
  // Unlike the automation, an explicit opt-in on an already-due task is honoured:
  // the user asked for it. It fires on the next tick as a normal (not missed)
  // firing.
  if (fireAt.getTime() <= nowMs) fireAt = new Date(nowMs + 1_000)

  const prefs = getAppPrefs()
  const input: ReminderInput = {
    title: `Task due: ${task.title}`,
    body: null,
    fire_at: fireAt.toISOString(),
    freq: null,
    interval: 1,
    byweekday: null,
    lead_time_min: lead,
    intensity: prefs.reminderDefaultIntensity,
    escalate_after_min: prefs.reminderDefaultEscalateMin,
    sound: null,
    entity_type: 'task',
    entity_id: task.id
  }

  if (existing) {
    // takeOwnership: for the hand-made row this is already true and costs nothing;
    // for an adopted automatic one it is the point of the call.
    repo.updateReminder(existing.id, input, { takeOwnership: true })
    if (!existing.enabled) repo.setReminderEnabled(existing.id, true)
    return { ok: true, reminderId: existing.id }
  }
  const created = repo.createReminder(input, { autoCreated: false })
  return { ok: true, reminderId: created.id }
}

export function getTaskManualReminder(taskId: number) {
  return repo.findManualReminderForEntity('task', taskId) ?? null
}

export function getTaskAutoReminder(taskId: number) {
  return repo.findAutoReminderForEntity('task', taskId) ?? null
}
