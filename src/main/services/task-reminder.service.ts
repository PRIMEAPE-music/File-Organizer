import * as repo from '../db/repositories/reminders.repo'
import { getTaskById } from '../db/repositories/tasks.repo'
import { dueDateToInstant, formatByWeekday } from '../utils/recurrence'
import { sanitizeReminderSound } from '../../shared/reminder-sounds'
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
 *    with. Both of those are stable inputs, and that is what makes the recompute
 *    idempotent — see the idempotency note on `syncTaskAutoReminder` for the one
 *    place it is not, and what stops that one re-alerting on every task save.
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

/** How far past `now` the near-due clamp aims: soon, but not already overdue. */
const CLAMP_OFFSET_MS = 1_000

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

export interface AutoFireAtPlan {
  /** The instant the reminder should fire. */
  at: Date
  /**
   * True when `at` came from the near-due clamp — i.e. it is derived from `now`
   * rather than from the task's due date, and so is a DIFFERENT INSTANT on every
   * recompute. `stickyFireAt` is the only thing that needs to know, and it needs to
   * know because a value that never repeats cannot be reconciled towards.
   */
  clamped: boolean
}

/**
 * The near-due clamp's instant: fire now-ish rather than never.
 *
 * The one output of the planning below that is a function of `now` rather than of the
 * task, and therefore the only one that moves on a recompute. Named and shared by
 * both the automatic and the manual path so that "clamped" means exactly one thing in
 * this file, and so `stickyFireAt` is the only place that has to cope with it.
 */
function clampToNow(nowMs: number): AutoFireAtPlan {
  return { at: new Date(nowMs + CLAMP_OFFSET_MS), clamped: true }
}

/**
 * When an auto reminder for this task should fire, or null if it should not exist:
 * no due date, or a due date already past.
 *
 * `leadMinutes` is the REMINDER'S OWN lead time once the row exists, and the
 * preference default only for a row being created. That is what lets "two days
 * before this deadline" survive the deadline moving.
 *
 * A date-only `due_date` (which is all `<input type="date">` produces) is read as
 * 9am local on that day — see `dueDateToInstant`. Midnight would be a hostile
 * moment to be reminded of anything.
 *
 * THE `clamped` FLAG IS NOT DECORATION. Every other output of this function is a
 * pure function of the task's due date and the reminder's lead time, so recomputing
 * it converges; the clamp alone is a function of `now`, so recomputing it moves.
 * Returning that distinction is what lets the caller treat the two cases
 * differently instead of writing a fresh timestamp on every task save.
 */
export function planAutoFireAt(
  dueDate: string | null,
  leadMinutes: number,
  nowMs: number = Date.now()
): AutoFireAtPlan | null {
  const due = dueDateToInstant(dueDate)
  if (!due) return null
  if (due.getTime() <= nowMs) return null

  const ideal = new Date(due.getTime() - Math.max(0, leadMinutes) * 60_000)
  // The due date is in the future but the lead time overshoots into the past:
  // fire now-ish rather than never, since the task genuinely is nearly due.
  if (ideal.getTime() <= nowMs) return clampToNow(nowMs)
  return { at: ideal, clamped: false }
}

/**
 * The `fire_at` to write — WITH THE CLAMP MADE STICKY.
 *
 * Used by both reminder paths a task drives, because both recompute on every save of
 * the task and both would otherwise re-alert forever. `plan.at` is a stable function
 * of the task in every case but one: the clamp resolves to `now + 1s`, a different
 * instant each time, and writing it deletes the pending occurrence, materialises a
 * fresh one and fires again — for every single save, for as long as the task stays
 * inside its lead window (or, on the manual path, for as long as it stays past due,
 * which needs no lead time at all).
 *
 * THE RULE: the clamp may move `fire_at` forward only while the reminder has not yet
 * delivered the firing it is currently holding. Once the user has been told for this
 * `fire_at`, telling them again because they saved the task adds nothing.
 *
 * Keyed on the row's CURRENT `fire_at` rather than on "has this reminder ever fired":
 * a firing delivered for an earlier time says nothing about the one now scheduled.
 * `hasDeliveredOccurrenceAtOrAfter` also counts a snooze as delivered — see its own
 * note; moving `fire_at` would delete the snoozed row and lose the deferral.
 *
 * `existing` is undefined for a row about to be created, or one whose history does not
 * belong to this reminder yet. It has nothing to have delivered, so the clamp applies
 * in full — which is what keeps a first, explicit "remind me now-ish" working.
 */
function stickyFireAt(existing: Reminder | undefined, plan: AutoFireAtPlan): string {
  if (
    existing &&
    plan.clamped &&
    repo.hasDeliveredOccurrenceAtOrAfter(existing.id, existing.fire_at)
  ) {
    return existing.fire_at
  }
  return plan.at.toISOString()
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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT MUST ALSO BE IDEMPOTENT, because it runs on EVERY task save.
 *
 * Every input to the target time is stable except one: the near-due clamp resolves
 * to `now + 1s` (see `planAutoFireAt`). Trusting it unconditionally meant a task
 * whose lead time already overshoots into the past got a *new* `fire_at` on every
 * save — and `setAutoReminderFireAt` deletes the pending occurrence and
 * materialises a fresh one, which the scheduler then delivered. So a 30-day lead on
 * a task due next week (the modal accepts up to 43200 minutes) popped its alert
 * every single time the user edited that task, at whatever tier they had chosen,
 * blackout included. A reconcile that fires an alert is not a reconcile.
 *
 * THE RULE: the clamp may move `fire_at` forward only while the reminder has not
 * yet delivered the firing it is currently holding. Once the user has been told
 * once for this `fire_at`, telling them again on a task save adds nothing, so the
 * time stays put — see `repo.hasDeliveredOccurrenceAtOrAfter`.
 *
 * WHAT DELIBERATELY STILL HAPPENS:
 *  - A reminder inside its lead window that has NEVER delivered still fires
 *    promptly. That is the clamp doing the job it exists for.
 *  - A due date that moves the ideal time back into the FUTURE still moves
 *    `fire_at` and schedules a fresh firing, delivered history or not: that value
 *    is derived from the task, it is stable, and the deadline genuinely changed.
 *    Only the past-clamped case is sticky.
 * ─────────────────────────────────────────────────────────────────────────────
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
  const plan = qualifies ? planAutoFireAt(task.due_date, leadMinutes, nowMs) : null

  if (!plan) {
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

  // THE IDEMPOTENCY GUARD (see the note above, and `stickyFireAt` itself). Keeping
  // the existing time means the comparison below writes nothing, so the pending
  // occurrence survives and no second alert is produced.
  const targetFireAt = stickyFireAt(existing, plan)

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
 * `…T14:23:47.512Z` (which the near-due clamp in `clampToNow` produces) back
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
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS RUNS ON EVERY SAVE OF THE TASK, not only when the box is touched, so it has
 * to be idempotent for the same two reasons `syncTaskAutoReminder` does — and it was
 * the easier of the two to hit, because it needs no lead time at all: a task already
 * past due sits inside the clamp permanently.
 *
 *  - THE CLAMP IS STICKY, via the same `stickyFireAt` the automation uses. An
 *    explicit opt-in on an already-due task still fires once, promptly; it does not
 *    fire again on every later save. Measured before the fix: 4 saves → 4 firings, 4
 *    distinct `fire_at`, 4 delivered occurrence rows.
 *  - THE WRITE IS CONDITIONAL. `updateReminder` deletes every pending AND SNOOZED
 *    occurrence and bumps `updated_at`, so calling it unconditionally meant saving a
 *    task silently cancelled a snooze the user had just set on that task's reminder
 *    — and with `fire_at` already past, re-materialisation put nothing back, so the
 *    deferred firing was lost outright rather than merely moved. Nothing is written
 *    when nothing would change; see `wouldChangeManualReminder`.
 *
 * There is deliberately NO "due date already past → no reminder" guard here, which
 * is what separates this from the automation. The opt-in is the user overriding that
 * judgement, and the stickiness is what makes honouring it survivable.
 * ─────────────────────────────────────────────────────────────────────────────
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

  // Normalised to exactly what the database will store, so the comparison below
  // cannot mistake a value the write path would have coerced for a change — and so a
  // non-finite lead arriving over IPC cannot make this path permanently un-idempotent
  // (`updateReminder` stores 0 for one; `Math.round(NaN)` would have compared unequal
  // to it forever).
  const lead = Number.isFinite(leadMinutes) ? Math.max(0, Math.round(leadMinutes)) : 0

  // `planAutoFireAt` returns null here only for a due date already past — the
  // unparseable case was rejected above — and that is precisely the case the manual
  // path does NOT decline: an explicit opt-in is honoured, clamped to now-ish, exactly
  // as an overshooting lead time is. Reusing the planner keeps one definition of the
  // clamp, and of the `clamped` flag the stickiness depends on.
  const plan = planAutoFireAt(task.due_date, lead, nowMs) ?? clampToNow(nowMs)

  // Sticky against `manual`, not `existing`: adopting an AUTOMATIC reminder here is
  // the first time this opt-in has been honoured, and it gets its one prompt firing
  // even though the automation's own earlier firings are in that row's history. From
  // then on the row IS the manual reminder, and every later save of the task finds
  // its firing delivered and leaves `fire_at` alone.
  const fireAt = stickyFireAt(manual, plan)

  const prefs = getAppPrefs()
  const input: ReminderInput = {
    title: `Task due: ${task.title}`,
    body: null,
    fire_at: fireAt,
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
    // NOTHING AT ALL when nothing would change — no UPDATE, no occurrence deletion,
    // no `updated_at` bump, so a snooze on this reminder survives the task being
    // saved. This lives in main rather than in the renderer on purpose: the renderer
    // declining to call is defence in depth, this is the guarantee.
    if (!wouldChangeManualReminder(existing, input)) {
      return { ok: true, reminderId: existing.id }
    }
    // takeOwnership: for the hand-made row this is already true and costs nothing;
    // for an adopted automatic one it is the point of the call.
    repo.updateReminder(existing.id, input, { takeOwnership: true })
    if (!existing.enabled) repo.setReminderEnabled(existing.id, true)
    return { ok: true, reminderId: existing.id }
  }
  const created = repo.createReminder(input, { autoCreated: false })
  return { ok: true, reminderId: created.id }
}

/**
 * Would `updateReminder(current.id, input, { takeOwnership: true })` change anything
 * the database holds?
 *
 * `false` is a licence to skip the write entirely, which matters because the write is
 * not free: it discards the reminder's pending and snoozed occurrences. See the note
 * on `setTaskManualReminder`.
 *
 * COUPLED, ON PURPOSE, TO `updateReminder`'s COLUMN LIST. Every column that UPDATE
 * names is compared here, plus the two the caller controls around it: `auto_created`,
 * which `takeOwnership` forces to 0, and `enabled`, which the caller re-arms
 * separately — so a disabled row must never be reported as up to date. A column added
 * to the write and not to this comparison would make a real edit vanish, which is why
 * the two lists are worth reading side by side.
 *
 * The coercions are the write path's own helpers rather than re-implementations, the
 * same reasoning as `editDetachesFromTask`. `interval` and `lead_time_min` need none:
 * the caller builds them already in stored form.
 */
function wouldChangeManualReminder(current: Reminder, input: ReminderInput): boolean {
  return !(
    current.auto_created === 0 &&
    current.enabled === 1 &&
    current.title === input.title &&
    current.body === (input.body ?? null) &&
    current.entity_type === (input.entity_type ?? null) &&
    current.entity_id === (input.entity_id ?? null) &&
    current.fire_at === input.fire_at &&
    current.freq === (input.freq ?? null) &&
    current.interval === input.interval &&
    current.byweekday === formatByWeekday(input.byweekday) &&
    current.lead_time_min === input.lead_time_min &&
    current.intensity === input.intensity &&
    current.escalate_after_min === (input.escalate_after_min ?? null) &&
    current.sound === sanitizeReminderSound(input.sound)
  )
}

export function getTaskManualReminder(taskId: number) {
  return repo.findManualReminderForEntity('task', taskId) ?? null
}

export function getTaskAutoReminder(taskId: number) {
  return repo.findAutoReminderForEntity('task', taskId) ?? null
}
