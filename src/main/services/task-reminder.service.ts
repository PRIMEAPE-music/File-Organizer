import * as repo from '../db/repositories/reminders.repo'
import { getTaskById } from '../db/repositories/tasks.repo'
import { dueDateToInstant, formatByWeekday } from '../utils/recurrence'
import { getAppPrefs } from './app-prefs.service'
import type {
  Reminder,
  ReminderInput,
  ReminderResetResult,
  ReminderWithMeta,
  Task,
  TaskPriority
} from '../../shared/types'

/**
 * Automatic reminders derived from task priority.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TASK OWNS *WHEN*. THE USER OWNS *HOW*.
 *
 * That split is the whole design, and it exists because the previous rule was
 * wrong in a way the user hit within minutes of real use. Any edit to an auto
 * reminder used to clear `auto_created`, fully detaching it — so setting a task
 * reminder up from the task, then changing its tier in the Reminders tab, silently
 * stopped the task's due date from ever moving it again. Nothing said so.
 *
 * So, after the row is created:
 *
 *  - THE AUTOMATION MAY WRITE `fire_at` AND `enabled`. Nothing else. It never
 *    touches intensity, escalate_after_min, sound, body, freq, interval,
 *    byweekday, lead_time_min or title — see `repo.setAutoReminderFireAt`, whose
 *    UPDATE names exactly one column and is fenced by `auto_created = 1`. This is
 *    what makes keeping the link safe: there is no longer anything of the user's
 *    for a task save to revert.
 *
 *  - `fire_at` IS DERIVED FROM THE TASK'S DUE DATE MINUS THE REMINDER'S OWN
 *    `lead_time_min` — not the preference default. "Remind me two days before
 *    this deadline" is a per-reminder decision, and it keeps following the task
 *    when the deadline moves. The pref supplies only the value the row is created
 *    with.
 *
 *  - ONLY A TIMING EDIT DETACHES: `fire_at`, `freq`, `interval`, `byweekday` —
 *    see `editDetachesFromTask`. Everything else is style or config and keeps the
 *    link. The decision is made by comparing the submitted values against the
 *    stored row, never from a flag the renderer sends: a renderer that forgot to
 *    set it would silently detach reminders again.
 *
 *  - A DETACHED REMINDER CAN BE HANDED BACK, once, explicitly —
 *    `resetTaskReminderToAutomatic`. Nothing else re-adopts a row the user took
 *    over, on this machine or (see below) on the other one.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This still only ever touches `auto_created = 1` rows. A reminder the user set by
 * hand survives every priority change, due date edit and even the task's deletion
 * path here — see `deleteAutoRemindersForEntity`, whose predicate is the guard.
 *
 * SYNC: `auto_created` is part of the synced reminder definition, so a detach
 * travels as a field change under last-write-wins. The receiving machine then sees
 * a task whose only reminder is `auto_created = 0`, and the create path below
 * declines to add one (`countRemindersForEntity > 0`) while the update path never
 * finds it (`findAutoReminderForEntity` requires `auto_created = 1`). A reminder
 * detached on one machine therefore stays detached on both.
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

const MINUTE_MS = 60_000

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
 * not exist: no due date, or a due date already past.
 *
 * `leadMinutes` is the REMINDER'S OWN lead time once the row exists, and the
 * preference default only for a row being created. That is what lets "two days
 * before this deadline" survive the deadline moving.
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
 *
 * WHAT THIS WRITES on an existing row: `fire_at` and `enabled`, and nothing else.
 * See the ownership split at the top of this file.
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
  // The reminder's own lead time, not the preference default — a per-reminder
  // decision the automation respects rather than overwrites. The pref supplies only
  // the value a brand-new row is created with.
  const leadMinutes = existing ? existing.lead_time_min : prefs.reminderDefaultLeadMin
  const fireAt = qualifies ? computeAutoFireAt(task.due_date, leadMinutes, nowMs) : null

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

  const targetFireAt = fireAt.toISOString()

  if (existing) {
    // THE NARROW WRITE. `fire_at` and `enabled` are the only columns the automation
    // may touch on a row that already exists; the user's tier, escalation, sound,
    // body, lead time and title are theirs from the moment the row is created.
    //
    // This used to be a whole-row `updateReminder` from preference defaults, which
    // is precisely why every human edit had to detach the reminder to survive.
    let changed = false
    // Unchanged time: don't rewrite the row, and don't discard its pending
    // occurrence, just because the task was saved again.
    if (existing.fire_at !== targetFireAt) {
      // In place, so the row keeps its `sync_id` and both machines go on agreeing
      // about which reminder this is.
      changed = repo.setAutoReminderFireAt(existing.id, targetFireAt)
    }
    // Re-arms one the automation had disabled. Ordered after the time change so the
    // occurrences are materialised from the new fire_at, not the old one — while a
    // row is disabled, materialisation is a no-op.
    if (!existing.enabled) {
      repo.setReminderEnabled(existing.id, true)
      changed = true
    }
    if (!changed) {
      return { action: dupesRemoved > 0 ? 'updated' : 'none', reminderId: existing.id }
    }
    return { action: 'updated', reminderId: existing.id }
  }

  // No auto reminder for this task. If the user already has one here — hand-made,
  // or an auto reminder they detached with a timing edit — leave it alone rather
  // than adding a second reminder for one task. This is also what stops the
  // receiving machine re-adopting a reminder detached on the other one.
  if (repo.countRemindersForEntity('task', task.id) > 0) {
    return { action: dupesRemoved > 0 ? 'updated' : 'none', reminderId: null }
  }

  // CREATION is the one moment the preference defaults apply. Everything below is
  // the row's own from here on.
  const input: ReminderInput = {
    title: `Task due: ${task.title}`,
    body: null,
    fire_at: targetFireAt,
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
  const created = repo.createReminder(input, { autoCreated: true })
  return { action: 'created', reminderId: created.id }
}

/**
 * Does this edit mean "I want my own schedule"?
 *
 * The single decision that replaces the old blanket detach on IPC.UPDATE_REMINDER.
 * True for a change to an absolute time or a recurrence; false for style and
 * config, which the automation no longer overwrites and so has no reason to
 * detach.
 *
 * DERIVED FROM THE STORED ROW, never from a renderer flag: the failure mode of a
 * flag is silent detachment, which is the exact bug being fixed.
 *
 * `fire_at` is compared AT MINUTE GRANULARITY. The editor is a `datetime-local`
 * input, which cannot express seconds, so it round-trips a stored
 * `…T14:23:47.512Z` (which the near-due clamp in `computeAutoFireAt` produces) back
 * as `…T14:23:00.000Z`. Comparing exact instants would read that truncation as a
 * deliberate time change and detach a reminder the user only re-tiered — the bug,
 * in miniature. A real edit moves the time by at least a minute and is still seen.
 */
export function editDetachesFromTask(current: Reminder, input: ReminderInput): boolean {
  // Nothing to detach: already the user's, or never the automation's.
  if (current.auto_created !== 1) return false

  const storedMinute = instantMinute(current.fire_at)
  const submittedMinute = instantMinute(input.fire_at)
  // An unparseable stored time cannot be compared. Treat the submitted one as
  // deliberate rather than keeping a link whose anchor we cannot read.
  if (storedMinute === null || submittedMinute === null) return true
  if (storedMinute !== submittedMinute) return true

  if ((input.freq ?? null) !== current.freq) return true
  // Normalised exactly as the repository would store them, so a value the write
  // path would have coerced is not mistaken for a change.
  const submittedInterval =
    Number.isInteger(input.interval) && input.interval > 0 ? input.interval : 1
  if (submittedInterval !== current.interval) return true
  if (formatByWeekday(input.byweekday) !== current.byweekday) return true

  return false
}

/** Epoch minutes for an ISO instant, or null when it will not parse. */
function instantMinute(iso: string): number | null {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / MINUTE_MS) : null
}

/**
 * "Reset to automatic" — hand a detached reminder back to its task.
 *
 * The escape hatch that makes the ownership split honest: a timing edit is a
 * one-way door otherwise, and the previous build's silent detachment left users
 * with no way back at all.
 *
 * Explicit and user-initiated, which is why it may write more than the automation
 * ever does — it clears the recurrence (see `repo.adoptReminderAsAutomatic`) and
 * then reconciles, which recomputes `fire_at` from the task's due date and the
 * reminder's own lead time. The user's tier, escalation, sound, body and title are
 * still untouched: this restores *when*, not *how*.
 *
 * Refuses rather than duplicates when the task somehow already has an automatic
 * reminder — one task, one reminder, and `dedupeAutoRemindersForEntity` would
 * otherwise resolve the collision by deleting a row.
 */
export function resetTaskReminderToAutomatic(
  reminderId: number,
  nowMs: number = Date.now()
): ReminderResetResult {
  const current = repo.getRawReminder(reminderId)
  if (!current) {
    return { ok: false, message: 'That reminder no longer exists.', reminder: null }
  }

  const asMeta = (): ReminderWithMeta | null => repo.getReminderById(reminderId) ?? null

  if (current.auto_created === 1) {
    // Already following its task. Idempotent rather than an error: two clicks on
    // the same row should not produce a failure banner.
    return { ok: true, reminder: asMeta() }
  }
  if (current.entity_type !== 'task' || current.entity_id === null) {
    return {
      ok: false,
      message: 'This reminder is not linked to a task, so there is nothing to follow.',
      reminder: asMeta()
    }
  }

  const task = getTaskById(current.entity_id)
  if (!task) {
    return {
      ok: false,
      message: 'The task this reminder came from no longer exists.',
      reminder: asMeta()
    }
  }

  const rival = repo.findAutoReminderForEntity('task', task.id)
  if (rival && rival.id !== reminderId) {
    return {
      ok: false,
      message: 'That task already has an automatic reminder.',
      reminder: asMeta()
    }
  }

  if (!repo.adoptReminderAsAutomatic(reminderId)) {
    return { ok: false, message: 'This reminder could not be reset.', reminder: asMeta() }
  }

  // The reconcile is what sets the time; adopting only makes the row eligible.
  syncTaskAutoReminder(task, nowMs)

  const reminder = asMeta()
  if (reminder && reminder.enabled === 0) {
    // Honest about a reset that produced a switched-off reminder: the automation
    // disables rather than deletes when a task stops qualifying, and the user
    // deserves to know why their reminder just went quiet.
    return {
      ok: true,
      message:
        'Following the task again. It is off for now — the task is complete, below the reminder threshold, or has no future due date.',
      reminder
    }
  }
  return { ok: true, reminder }
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
 * (so the other machine updates rather than accumulates) and loses `auto_created`.
 *
 * WHY THIS STILL DETACHES, when a mere tier change in the Reminders tab does not:
 * it writes an absolute `fire_at` derived from the lead time the user just typed
 * into the task modal, and honours it even when the task is already due — a timing
 * decision, and timing is what detaches. "Reset to automatic" in the Reminders tab
 * hands it back.
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
