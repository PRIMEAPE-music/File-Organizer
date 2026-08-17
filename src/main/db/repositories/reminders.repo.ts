import { getDb } from '../database'
import {
  formatByWeekday,
  generateOccurrences,
  parseByWeekday
} from '../../utils/recurrence'
import { sanitizeReminderSound } from '../../../shared/reminder-sounds'
import type {
  Reminder,
  ReminderEntityType,
  ReminderInput,
  ReminderIntensity,
  ReminderOccurrence,
  ReminderWithMeta
} from '../../../shared/types'

/**
 * Reminders and their materialised occurrences.
 *
 * Occurrences exist as rows rather than being computed on read for two reasons:
 * a per-instance snooze or acknowledgement needs somewhere to live, and a cold
 * start has to be able to tell "already delivered" from "missed while the app
 * was down". Computing on read would lose both.
 */

/** How far ahead occurrences are materialised. Topped up as the app runs. */
export const HORIZON_DAYS = 60

/**
 * NO BACKFILL — materialisation never creates a `pending` row in the past.
 *
 * This used to reach back 14 days, and that was the bug. The dedupe that stops a
 * delivered firing being replayed is `UNIQUE(reminder_id, fire_at)`, and it
 * evaporates the moment `fire_at` changes: editing a daily 9am reminder to 10am
 * deletes the pending rows, re-materialises from 14 days ago at the NEW time, and
 * every one of those timestamps is unique — so 14 already-delivered mornings came
 * back as pending-and-overdue, tripped the catch-up threshold, and produced
 * "14 reminders were missed while you were away" in a forced popup. Measured: 74
 * rows created, 14 of them pending and in the past.
 *
 * The reasoning that makes the removal safe: a genuinely missed firing is an
 * occurrence that was ALREADY MATERIALISED and never delivered, and the catch-up
 * path in reminder.service handles exactly those rows. Creating new rows in the
 * past does not recover history — it fabricates it.
 *
 * Kept as a named constant because the horizon has a floor as well as a ceiling,
 * and `0` in the expression below would read like an accident.
 */
export const BACKFILL_DAYS = 0

const DAY_MS = 86_400_000

/**
 * Millisecond-precision UTC timestamp, matching the column defaults in migration
 * 2 — see the comment there for why reminders do not use `datetime('now')` like
 * the other tables. Every write to created_at/updated_at must use this, or the
 * sync merge key ends up with two different formats and string comparison of
 * `updated_at` starts lying.
 */
const NOW_EXPR = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

// ─── Row types ────────────────────────────────────────────────────────────────

/** A due (or firing) occurrence joined to everything needed to deliver it. */
export interface DueOccurrenceRow {
  occurrence_id: number
  reminder_id: number
  fire_at: string
  /** fire_at for a pending row, snoozed_until for a snoozed one. */
  effective_at: string
  state: string
  current_tier: ReminderIntensity | null
  fired_at: string | null
  snooze_count: number
  title: string
  body: string | null
  /** The reminder's STARTING tier. */
  intensity: ReminderIntensity
  escalate_after_min: number | null
  sound: string | null
  entity_type: ReminderEntityType | null
  entity_id: number | null
}

const DUE_SELECT = `
  SELECT o.id            AS occurrence_id,
         o.reminder_id   AS reminder_id,
         o.fire_at       AS fire_at,
         CASE WHEN o.state = 'snoozed' AND o.snoozed_until IS NOT NULL
              THEN o.snoozed_until ELSE o.fire_at END AS effective_at,
         o.state         AS state,
         o.current_tier  AS current_tier,
         o.fired_at      AS fired_at,
         o.snooze_count  AS snooze_count,
         r.title         AS title,
         r.body          AS body,
         r.intensity     AS intensity,
         r.escalate_after_min AS escalate_after_min,
         r.sound         AS sound,
         r.entity_type   AS entity_type,
         r.entity_id     AS entity_id
  FROM reminder_occurrences o
  INNER JOIN reminders r ON r.id = o.reminder_id
`

// ─── Enrichment ───────────────────────────────────────────────────────────────

function entityTitle(type: ReminderEntityType | null, id: number | null): string | null {
  if (!type || !id) return null
  const db = getDb()
  const table = type === 'task' ? 'tasks' : 'notes'
  const row = db.prepare(`SELECT title FROM ${table} WHERE id = ?`).get(id) as
    | { title: string }
    | undefined
  return row?.title ?? null
}

function enrichReminder(reminder: Reminder): ReminderWithMeta {
  const db = getDb()

  const next = db
    .prepare(
      `SELECT * FROM reminder_occurrences
       WHERE reminder_id = ? AND state IN ('pending', 'snoozed')
       ORDER BY CASE WHEN state = 'snoozed' AND snoozed_until IS NOT NULL
                     THEN snoozed_until ELSE fire_at END ASC
       LIMIT 1`
    )
    .get(reminder.id) as ReminderOccurrence | undefined

  // 'fired' means delivered but never acknowledged — still demanding attention.
  const active = db
    .prepare(
      `SELECT * FROM reminder_occurrences
       WHERE reminder_id = ? AND state = 'fired'
       ORDER BY fire_at ASC LIMIT 1`
    )
    .get(reminder.id) as ReminderOccurrence | undefined

  const missed = db
    .prepare(`SELECT COUNT(*) AS c FROM reminder_occurrences WHERE reminder_id = ? AND state = 'missed'`)
    .get(reminder.id) as { c: number }

  return {
    ...reminder,
    next_occurrence: next ?? null,
    active_occurrence: active ?? null,
    missed_count: missed.c,
    entity_title: entityTitle(reminder.entity_type, reminder.entity_id)
  }
}

// ─── Materialisation ──────────────────────────────────────────────────────────

/**
 * Top up one reminder's occurrence rows out to the horizon.
 *
 * Idempotent: candidates are inserted with `INSERT OR IGNORE` against
 * `UNIQUE(reminder_id, fire_at)`, so re-running never duplicates and never
 * resurrects an occurrence the user already acknowledged. That is what lets the
 * scheduler top up on a plain timer without tracking what it did last time.
 *
 * THE INVARIANT (see BACKFILL_DAYS): this never creates a `pending` occurrence
 * whose `fire_at` is in the past. Both the window start and the per-row filter
 * below enforce it — the filter is not redundant, because the generator's lower
 * bound is inclusive and `from` is computed once for a loop that can run long
 * enough for `now` to move.
 *
 * Returns how many new rows were created.
 */
export function materialiseOccurrences(reminderId: number, nowMs: number = Date.now()): number {
  const db = getDb()
  const reminder = db.prepare('SELECT * FROM reminders WHERE id = ?').get(reminderId) as
    | Reminder
    | undefined
  if (!reminder || !reminder.enabled) return 0

  const anchor = new Date(reminder.fire_at)
  if (Number.isNaN(anchor.getTime())) {
    console.error(`[reminders] reminder ${reminderId} has an unparseable fire_at: ${reminder.fire_at}`)
    return 0
  }

  // The floor is `now` (BACKFILL_DAYS is 0), so a reminder anchored in the past
  // contributes only its still-future firings.
  const floor = new Date(nowMs - BACKFILL_DAYS * DAY_MS)
  const from = anchor.getTime() > floor.getTime() ? anchor : floor
  const until = new Date(nowMs + HORIZON_DAYS * DAY_MS)

  const dates = generateOccurrences(
    {
      fireAt: anchor,
      freq: reminder.freq,
      interval: reminder.interval,
      byweekday: parseByWeekday(reminder.byweekday)
    },
    { from, until }
  )

  const insert = db.prepare(
    'INSERT OR IGNORE INTO reminder_occurrences (reminder_id, fire_at, state) VALUES (?, ?, \'pending\')'
  )
  let created = 0
  const run = db.transaction(() => {
    for (const d of dates) {
      // The invariant, enforced at the point of insert rather than trusted from
      // the window above.
      if (d.getTime() < nowMs) continue
      const info = insert.run(reminderId, d.toISOString())
      created += info.changes
    }
  })
  run()
  return created
}

/** Top up every enabled reminder. Cheap: bounded by the horizon, not by history. */
export function materialiseAll(nowMs: number = Date.now()): number {
  const ids = getDb().prepare('SELECT id FROM reminders WHERE enabled = 1').all() as {
    id: number
  }[]
  let created = 0
  for (const { id } of ids) created += materialiseOccurrences(id, nowMs)
  return created
}

// ─── Reminder CRUD ────────────────────────────────────────────────────────────

export function getReminders(): ReminderWithMeta[] {
  const rows = getDb()
    .prepare('SELECT * FROM reminders ORDER BY fire_at ASC')
    .all() as Reminder[]
  return rows.map(enrichReminder)
}

export function getReminderById(id: number): ReminderWithMeta | undefined {
  const row = getDb().prepare('SELECT * FROM reminders WHERE id = ?').get(id) as
    | Reminder
    | undefined
  return row ? enrichReminder(row) : undefined
}

export function getRawReminder(id: number): Reminder | undefined {
  return getDb().prepare('SELECT * FROM reminders WHERE id = ?').get(id) as Reminder | undefined
}

export function createReminder(
  input: ReminderInput,
  opts: { autoCreated?: boolean } = {}
): ReminderWithMeta {
  const db = getDb()
  const info = db
    .prepare(
      `INSERT INTO reminders
         (title, body, entity_type, entity_id, fire_at, freq, interval, byweekday,
          lead_time_min, intensity, escalate_after_min, sound, auto_created, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      input.title,
      input.body ?? null,
      input.entity_type ?? null,
      input.entity_id ?? null,
      input.fire_at,
      input.freq ?? null,
      Number.isInteger(input.interval) && input.interval > 0 ? input.interval : 1,
      formatByWeekday(input.byweekday),
      Number.isFinite(input.lead_time_min) ? Math.max(0, Math.round(input.lead_time_min)) : 0,
      input.intensity,
      input.escalate_after_min ?? null,
      // Never store a sound we would refuse to play. `sound` is a synced field, so
      // the database is the right boundary to normalise it at — see
      // shared/reminder-sounds.ts.
      sanitizeReminderSound(input.sound),
      opts.autoCreated ? 1 : 0
    )

  const id = Number(info.lastInsertRowid)
  materialiseOccurrences(id)
  return getReminderById(id)!
}

/**
 * Update a reminder and re-derive its future occurrences.
 *
 * Only pending/snoozed rows are discarded — fired, acknowledged and missed rows
 * are history, and deleting them would let an already-delivered firing come back
 * as a "missed" alert the next time the horizon was topped up.
 *
 * @param opts.takeOwnership Clear `auto_created`, making this the user's reminder.
 *   Set by every edit that came from a person (the Reminders tab, the task modal's
 *   "Remind me"), and never by the priority automation.
 *
 *   WHY: the automation rewrites the auto reminder it owns from preference
 *   defaults every time the task is saved. Without this, a user who switched their
 *   task reminder to blackout with a 2-minute escalation found it silently back at
 *   toast the next time they touched the task — the edit was accepted, kept, and
 *   then quietly reverted. Taking ownership keeps the entity link (so the reminder
 *   still says which task it is about) while putting the row outside the
 *   automation's reach.
 */
export function updateReminder(
  id: number,
  input: ReminderInput,
  opts: { takeOwnership?: boolean } = {}
): ReminderWithMeta | undefined {
  const db = getDb()
  const current = getRawReminder(id)
  if (!current) return undefined

  const apply = db.transaction(() => {
    db.prepare(
      `UPDATE reminders SET
         title = ?, body = ?, entity_type = ?, entity_id = ?, fire_at = ?, freq = ?,
         interval = ?, byweekday = ?, lead_time_min = ?, intensity = ?,
         escalate_after_min = ?, sound = ?, auto_created = ?, updated_at = ${NOW_EXPR}
       WHERE id = ?`
    ).run(
      input.title,
      input.body ?? null,
      input.entity_type ?? null,
      input.entity_id ?? null,
      input.fire_at,
      input.freq ?? null,
      Number.isInteger(input.interval) && input.interval > 0 ? input.interval : 1,
      formatByWeekday(input.byweekday),
      Number.isFinite(input.lead_time_min) ? Math.max(0, Math.round(input.lead_time_min)) : 0,
      input.intensity,
      input.escalate_after_min ?? null,
      sanitizeReminderSound(input.sound),
      opts.takeOwnership ? 0 : current.auto_created,
      id
    )
    db.prepare(
      "DELETE FROM reminder_occurrences WHERE reminder_id = ? AND state IN ('pending', 'snoozed')"
    ).run(id)
  })
  apply()

  materialiseOccurrences(id)
  return getReminderById(id)
}

export function deleteReminder(id: number): void {
  // Occurrences go with it via ON DELETE CASCADE (foreign_keys = ON).
  getDb().prepare('DELETE FROM reminders WHERE id = ?').run(id)
}

export function setReminderEnabled(id: number, enabled: boolean): ReminderWithMeta | undefined {
  const db = getDb()
  const apply = db.transaction(() => {
    db.prepare(`UPDATE reminders SET enabled = ?, updated_at = ${NOW_EXPR} WHERE id = ?`).run(
      enabled ? 1 : 0,
      id
    )
    if (!enabled) {
      // Drop the schedule but keep history, so re-enabling cannot dump a backlog
      // of firings the user disabled the reminder precisely to avoid.
      db.prepare(
        "DELETE FROM reminder_occurrences WHERE reminder_id = ? AND state IN ('pending', 'snoozed')"
      ).run(id)
      // And settle anything mid-flight. Turning a reminder off has to mean "stop
      // bothering me": a 'fired' row left behind would keep climbing the ladder and
      // keep the tray amber for a reminder the user just switched off.
      db.prepare(
        `UPDATE reminder_occurrences
         SET state = 'acknowledged', acknowledged_at = ?, current_tier = NULL
         WHERE reminder_id = ? AND state = 'fired'`
      ).run(new Date().toISOString(), id)
    }
  })
  apply()

  if (enabled) materialiseOccurrences(id)
  return getReminderById(id)
}

// ─── Occurrence queries ───────────────────────────────────────────────────────

/**
 * The scheduler's hot query: everything owed right now.
 *
 * A snoozed row is due at `snoozed_until`; a pending row at `fire_at`. Disabled
 * reminders are excluded here rather than filtered later, so disabling one takes
 * effect on the very next tick.
 */
export function getDueOccurrences(nowIso: string): DueOccurrenceRow[] {
  return getDb()
    .prepare(
      `${DUE_SELECT}
       WHERE r.enabled = 1
         AND o.state IN ('pending', 'snoozed')
         AND (
           (o.state = 'pending' AND o.fire_at <= ?)
           OR (o.state = 'snoozed' AND o.snoozed_until IS NOT NULL AND o.snoozed_until <= ?)
         )
       ORDER BY effective_at ASC`
    )
    .all(nowIso, nowIso) as DueOccurrenceRow[]
}

/** Delivered but unacknowledged — the set the escalation ladder walks. */
export function getFiringOccurrences(): DueOccurrenceRow[] {
  return getDb()
    .prepare(`${DUE_SELECT} WHERE o.state = 'fired' ORDER BY o.fire_at ASC`)
    .all() as DueOccurrenceRow[]
}

export function getOccurrenceRow(occurrenceId: number): DueOccurrenceRow | undefined {
  return getDb().prepare(`${DUE_SELECT} WHERE o.id = ?`).get(occurrenceId) as
    | DueOccurrenceRow
    | undefined
}

/**
 * Soonest moment anything is owed, as epoch ms — or null if nothing is.
 *
 * The `snoozed_until IS NOT NULL` clause matches `getDueOccurrences` exactly, and
 * that agreement is the point. It used to fall back to `fire_at` for a snoozed row
 * with a NULL `snoozed_until` while the due query refused to return that row at
 * all, so the scheduler saw something permanently owed that it could never claim
 * and re-armed at the 250ms floor forever — a hot loop for the rest of the
 * session. Such a row is also repaired at startup (see
 * `repairUnschedulableSnoozes`); a query that cannot lie is the belt to that
 * braces.
 */
export function getNextDueAtMs(): number | null {
  const row = getDb()
    .prepare(
      `SELECT MIN(CASE WHEN o.state = 'snoozed' THEN o.snoozed_until ELSE o.fire_at END) AS next_at
       FROM reminder_occurrences o
       INNER JOIN reminders r ON r.id = o.reminder_id
       WHERE r.enabled = 1
         AND (
           o.state = 'pending'
           OR (o.state = 'snoozed' AND o.snoozed_until IS NOT NULL)
         )`
    )
    .get() as { next_at: string | null }
  if (!row.next_at) return null
  const ms = Date.parse(row.next_at)
  return Number.isFinite(ms) ? ms : null
}

/** Occurrences firing or overdue-unacknowledged. Drives the tray icon. */
export function getFiringCount(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS c FROM reminder_occurrences WHERE state = 'fired'`)
    .get() as { c: number }
  return row.c
}

// ─── Startup recovery ─────────────────────────────────────────────────────────

/**
 * Hand every occurrence left `fired` by a previous process back to the scheduler.
 *
 * WHAT WAS BROKEN: `fired` means "delivered, never acknowledged". The only code
 * that consumed such a row again was the escalation ladder, and it declines to act
 * when `escalate_after_min` is NULL *or* when the row is already at the top of the
 * ladder. So a blackout firing — the loudest thing this feature can do — was
 * stranded permanently the moment the process ended: never re-delivered, never
 * acknowledged, and still counted by `getFiringCount()`, which left the tray amber
 * for the rest of time. Quitting or crashing while an alert was on screen simply
 * lost that firing, for a feature whose entire premise is firing while the app is
 * closed.
 *
 * Returning them to `pending` puts them back on the ordinary catch-up path, which
 * already knows how to deliver a handful individually and collapse a flood into
 * one digest. `fired_at` and `current_tier` are cleared deliberately: after a
 * reboot the climb should start again at the reminder's configured `intensity`
 * rather than resuming at whatever rung it had reached hours ago.
 *
 * WHAT IS NOT TOUCHED: `acknowledged` and `missed`. The user dealt with those, and
 * resurrecting them would be the far worse bug — an alert for something already
 * dismissed, arriving after every restart.
 *
 * Called exactly once per process, from `reminder.service.start()`. That is what
 * stops it looping: a row this pass re-fires becomes `fired` again, and nothing
 * runs this a second time inside the same run.
 */
export function recoverStrandedFiringOccurrences(): number {
  const info = getDb()
    .prepare(
      `UPDATE reminder_occurrences
       SET state = 'pending', fired_at = NULL, current_tier = NULL
       WHERE state = 'fired'`
    )
    .run()
  return info.changes
}

/**
 * Repair `snoozed` rows with no `snoozed_until`.
 *
 * No path in the app creates one, but nothing healed one either, and the shape is
 * reachable from a hand-edited or partially-written database. The row was
 * unclaimable (the due query requires a non-NULL `snoozed_until`) while still
 * counting as owed, so the timer re-armed at its 250ms floor indefinitely. Back to
 * `pending` at its original `fire_at`: the firing is recovered rather than lost,
 * and the row becomes claimable again.
 */
export function repairUnschedulableSnoozes(): number {
  const info = getDb()
    .prepare(
      `UPDATE reminder_occurrences
       SET state = 'pending', current_tier = NULL
       WHERE state = 'snoozed' AND snoozed_until IS NULL`
    )
    .run()
  return info.changes
}

// ─── Occurrence state transitions ─────────────────────────────────────────────

/**
 * Take ownership of an occurrence for delivery.
 *
 * The `state IN ('pending','snoozed')` predicate is the whole point: the update
 * is the claim. If two paths race — the heartbeat and a `rescheduleNow()` from a
 * wake event, say — exactly one of them changes a row and the loser gets
 * `changes === 0` and delivers nothing. That is what makes a double firing
 * impossible rather than merely unlikely.
 */
export function claimOccurrence(
  occurrenceId: number,
  tier: ReminderIntensity,
  firedAtIso: string
): boolean {
  const info = getDb()
    .prepare(
      `UPDATE reminder_occurrences
       SET state = 'fired', fired_at = ?, current_tier = ?
       WHERE id = ? AND state IN ('pending', 'snoozed')`
    )
    .run(firedAtIso, tier, occurrenceId)
  return info.changes === 1
}

/** Same claim semantics, but the row is recorded as missed and not delivered. */
export function claimAsMissed(occurrenceId: number, firedAtIso: string): boolean {
  const info = getDb()
    .prepare(
      `UPDATE reminder_occurrences
       SET state = 'missed', fired_at = ?, current_tier = NULL
       WHERE id = ? AND state IN ('pending', 'snoozed')`
    )
    .run(firedAtIso, occurrenceId)
  return info.changes === 1
}

export function setOccurrenceTier(occurrenceId: number, tier: ReminderIntensity): void {
  getDb()
    .prepare("UPDATE reminder_occurrences SET current_tier = ? WHERE id = ? AND state = 'fired'")
    .run(tier, occurrenceId)
}

export function acknowledgeOccurrence(occurrenceId: number, nowIso: string): boolean {
  const info = getDb()
    .prepare(
      `UPDATE reminder_occurrences
       SET state = 'acknowledged', acknowledged_at = ?, current_tier = NULL
       WHERE id = ? AND state IN ('fired', 'pending', 'snoozed', 'missed')`
    )
    .run(nowIso, occurrenceId)
  return info.changes === 1
}

/**
 * Snooze one occurrence.
 *
 * `current_tier` is cleared on purpose: a snooze resets the escalation climb, so
 * the next firing starts at the reminder's configured `intensity` again rather
 * than resuming at the rung it had reached.
 */
export function snoozeOccurrence(occurrenceId: number, untilIso: string): boolean {
  const info = getDb()
    .prepare(
      `UPDATE reminder_occurrences
       SET state = 'snoozed', snoozed_until = ?, snooze_count = snooze_count + 1,
           current_tier = NULL, fired_at = NULL
       WHERE id = ? AND state IN ('fired', 'pending', 'missed')`
    )
    .run(untilIso, occurrenceId)
  return info.changes === 1
}

/** "Snooze all reminders" from the tray. Returns how many rows moved. */
export function snoozeAllFiring(untilIso: string): number {
  const info = getDb()
    .prepare(
      `UPDATE reminder_occurrences
       SET state = 'snoozed', snoozed_until = ?, snooze_count = snooze_count + 1,
           current_tier = NULL, fired_at = NULL
       WHERE state = 'fired'`
    )
    .run(untilIso)
  return info.changes
}

// ─── Entity links (task automation) ───────────────────────────────────────────

export function findAutoReminderForEntity(
  type: ReminderEntityType,
  entityId: number
): Reminder | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM reminders
       WHERE entity_type = ? AND entity_id = ? AND auto_created = 1
       ORDER BY id ASC LIMIT 1`
    )
    .get(type, entityId) as Reminder | undefined
}

export function findManualReminderForEntity(
  type: ReminderEntityType,
  entityId: number
): Reminder | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM reminders
       WHERE entity_type = ? AND entity_id = ? AND auto_created = 0
       ORDER BY id ASC LIMIT 1`
    )
    .get(type, entityId) as Reminder | undefined
}

/**
 * Every reminder linked to an entity, auto-created or not.
 *
 * The automation uses this to answer "does this task already have a reminder of any
 * kind?", which is the question that keeps it to one reminder per task: it creates
 * only when the answer is no, and edits or removes only rows it owns.
 */
export function countRemindersForEntity(type: ReminderEntityType, entityId: number): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM reminders WHERE entity_type = ? AND entity_id = ?')
    .get(type, entityId) as { c: number }
  return row.c
}

/**
 * Collapse duplicate auto reminders for one entity down to the oldest.
 *
 * HOW DUPLICATES HAPPENED: the automation used to delete its reminder when a task
 * dropped below the threshold and create a fresh one (new `sync_id`) when it rose
 * again. The importer never deletes local-only rows — by design, so that a machine
 * cannot silently cancel another's reminders — so raising and lowering a task's
 * priority N times left the *other* machine with N enabled reminders for one task,
 * all firing, and `findAutoReminderForEntity` only ever reconciled the oldest of
 * them. The automation no longer works that way (it disables in place, keeping the
 * row and its identity), but existing databases already contain the wreckage.
 *
 * Keeping the LOWEST id is not arbitrary: it is the row `findAutoReminderForEntity`
 * has been reconciling all along, so this converges on the one the automation was
 * already treating as canonical rather than switching horses.
 */
export function dedupeAutoRemindersForEntity(type: ReminderEntityType, entityId: number): number {
  const info = getDb()
    .prepare(
      `DELETE FROM reminders
       WHERE auto_created = 1 AND entity_type = ? AND entity_id = ?
         AND id > (SELECT MIN(id) FROM reminders
                   WHERE auto_created = 1 AND entity_type = ? AND entity_id = ?)`
    )
    .run(type, entityId, type, entityId)
  return info.changes
}

/**
 * The same collapse across every entity at once — run after a sync import, which is
 * where duplicates arrive from.
 */
export function dedupeAllAutoReminders(): number {
  const info = getDb()
    .prepare(
      `DELETE FROM reminders
       WHERE auto_created = 1
         AND entity_type IS NOT NULL
         AND entity_id IS NOT NULL
         AND id NOT IN (
           SELECT MIN(id) FROM reminders
           WHERE auto_created = 1 AND entity_type IS NOT NULL AND entity_id IS NOT NULL
           GROUP BY entity_type, entity_id
         )`
    )
    .run()
  return info.changes
}

/**
 * Delete the automation's own reminders for an entity.
 *
 * `auto_created = 1` in the predicate is load-bearing, not defensive: a reminder
 * the user made by hand has to survive every priority change, due-date edit and
 * task deletion path that calls this.
 */
export function deleteAutoRemindersForEntity(type: ReminderEntityType, entityId: number): number {
  const info = getDb()
    .prepare('DELETE FROM reminders WHERE entity_type = ? AND entity_id = ? AND auto_created = 1')
    .run(type, entityId)
  return info.changes
}

export function deleteRemindersForEntity(type: ReminderEntityType, entityId: number): number {
  const info = getDb()
    .prepare('DELETE FROM reminders WHERE entity_type = ? AND entity_id = ?')
    .run(type, entityId)
  return info.changes
}

/**
 * Drop auto-created reminders whose task no longer exists.
 *
 * Needed because `entity_id` is not a foreign key (it addresses two tables), and
 * because sync can deliver a reminder for a task that was deleted on this
 * machine. Restricted to auto_created rows: an orphaned hand-made reminder is
 * still the user's reminder.
 */
export function pruneOrphanedAutoReminders(): number {
  const info = getDb()
    .prepare(
      `DELETE FROM reminders
       WHERE auto_created = 1
         AND entity_type = 'task'
         AND (entity_id IS NULL OR entity_id NOT IN (SELECT id FROM tasks))`
    )
    .run()
  return info.changes
}
