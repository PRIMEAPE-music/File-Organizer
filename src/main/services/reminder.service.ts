import { Notification, powerMonitor } from 'electron'
import * as repo from '../db/repositories/reminders.repo'
import { readResourceDataUri } from '../utils/resources'
import { isAllowedReminderSound } from '../../shared/reminder-sounds'
import {
  DIGEST_MAX_ITEMS,
  computeTimerDelay,
  escalatedTier,
  highestTier,
  planDue,
  snoozeUntil,
  tierIndex
} from './reminder-schedule'
import type {
  ReminderAlertItem,
  ReminderAlertPayload,
  ReminderIntensity,
  ReminderSnoozeChoice
} from '../../shared/types'
import {
  closeAlert,
  getCurrentAlertPayload,
  isAlertWindowOpen,
  showAlert,
  updateAlert
} from './alert-window.service'

/**
 * The reminder scheduler.
 *
 * TIMER DISCIPLINE (the invariant this whole module is built around):
 * there is exactly ONE timer, it is re-armed from `computeTimerDelay()`, and that
 * function can never return more than 60s. A reminder set for next year does not
 * get a `setTimeout` for next year — Node would clamp anything past ~24.8 days
 * and fire it immediately, and no long timer survives a suspend anyway. Instead
 * every wake re-derives what is owed from the database, which also makes the
 * scheduler correct across sleep, hibernate, clock changes and a plain crash.
 *
 * The single self-re-arming timer plays both roles the design calls for: it is
 * the coarse 30s heartbeat, shortened to land exactly on the next firing when
 * that is less than a heartbeat away. See computeTimerDelay.
 */

const CHIME_SOUND = 'reminder-chime.wav'
const ALERT_SOUND = 'reminder-alert.wav'

/** Top up the 60-day horizon this often; it does not need to be every tick. */
const TOP_UP_INTERVAL_MS = 10 * 60_000

interface QueuedAlert {
  payload: ReminderAlertPayload
  /** Occurrence id, or null for a digest. */
  occurrenceId: number | null
}

export interface ReminderServiceHooks {
  /** Bring the main window back — the tray/hotkey implementation in index.ts. */
  reveal: () => void
  /** Fired whenever the count of firing/unacknowledged occurrences changes. */
  onFiringCountChanged: (count: number) => void
  /** Fired when reminder rows change, so an open Reminders tab can refresh. */
  onRemindersChanged: () => void
}

let hooks: ReminderServiceHooks | null = null
let running = false
let timer: NodeJS.Timeout | null = null
let lastTopUpMs = 0
let lastPublishedCount = -1
/**
 * The startup recovery pass runs at most once per process — which is what makes it
 * impossible for a row it re-fires to be mistaken for a leftover from a previous
 * process and recovered again. `start()` is guarded by `running`, but a
 * stop()/start() pair in one process would otherwise get a second pass.
 */
let recoveryDone = false

/**
 * Queued window-tier alerts. Only popup/blackout firings queue: a toast does not
 * occupy the single alert window, so ten toasts must not serialise behind each
 * other.
 */
const queue: QueuedAlert[] = []
let active: QueuedAlert | null = null

/** Occurrences already queued or on screen, so an escalation pass can't re-add. */
const inFlight = new Set<number>()

let powerListenersBound = false

// ─── Wiring ───────────────────────────────────────────────────────────────────

export function initReminderService(next: ReminderServiceHooks): void {
  hooks = next
}

function notifyChanged(): void {
  try {
    hooks?.onRemindersChanged()
  } catch (err) {
    console.error(`[reminders] change notification failed: ${(err as Error).message}`)
  }
}

function publishFiringCount(force = false): void {
  let count = 0
  try {
    count = repo.getFiringCount()
  } catch (err) {
    console.error(`[reminders] could not count firing occurrences: ${(err as Error).message}`)
    return
  }
  if (!force && count === lastPublishedCount) return
  lastPublishedCount = count
  try {
    hooks?.onFiringCountChanged(count)
  } catch (err) {
    console.error(`[reminders] tray update failed: ${(err as Error).message}`)
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export function start(): void {
  if (running) return
  running = true

  runStartupRecovery()

  if (!powerListenersBound) {
    powerListenersBound = true
    // A closed laptop lid must not eat reminders. Long timers do not survive
    // suspend, so on every wake we throw away whatever was pending and re-derive
    // the whole picture from the database.
    powerMonitor.on('resume', () => {
      console.log('[reminders] system resumed — re-deriving schedule')
      rescheduleNow()
    })
    powerMonitor.on('unlock-screen', () => {
      console.log('[reminders] screen unlocked — re-deriving schedule')
      rescheduleNow()
    })
  }

  console.log('[reminders] scheduler started')
  runTick(true)
}

/**
 * Stop the scheduler and take down any alert surfaces.
 *
 * Called from `runTeardown()` through `teardownStep()`, so a throw in here cannot
 * break the rest of shutdown — but it also must not need that safety net.
 * Destroying the alert windows is not optional: they are `closable: false`, and a
 * non-closable window left standing prevents `app.quit()` from completing.
 */
export function stop(): void {
  running = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  queue.length = 0
  active = null
  inFlight.clear()
  closeAlert()
  console.log('[reminders] scheduler stopped')
}

/**
 * Put anything the previous process left mid-flight back on the schedule.
 *
 * A firing that was on screen when the app quit or crashed sat in `fired` forever:
 * `processDue` only reads pending/snoozed, and escalation — the sole consumer of
 * `fired` — declines when escalation is off or the row is already at blackout. So
 * the loudest tier was also the one that could never recover, and the tray stayed
 * amber for a firing nothing would ever deliver again.
 *
 * Deliberately at the *start* of the run, before the first tick: those rows become
 * `pending` with a past `fire_at`, so the very next tick treats them as the
 * catch-up set — delivered individually when there are a few, collapsed into one
 * digest when there are many. Both of those behaviours already existed and are
 * exactly right for "you were away and these are owed".
 *
 * Never throws: a database problem here must cost the recovery, not the scheduler.
 */
function runStartupRecovery(): void {
  if (recoveryDone) return
  recoveryDone = true

  try {
    const repaired = repo.repairUnschedulableSnoozes()
    if (repaired > 0) {
      console.log(`[reminders] repaired ${repaired} snoozed occurrence(s) with no snooze time`)
    }
  } catch (err) {
    console.error(`[reminders] snooze repair failed: ${(err as Error).message}`)
  }

  try {
    const recovered = repo.recoverStrandedFiringOccurrences()
    if (recovered > 0) {
      console.log(
        `[reminders] ${recovered} occurrence(s) were still firing when the app last stopped — ` +
          're-queued for delivery'
      )
    }
  } catch (err) {
    console.error(`[reminders] recovery of unacknowledged firings failed: ${(err as Error).message}`)
  }
}

/** Re-derive immediately: after a wake, a sync import, or any reminder edit. */
export function rescheduleNow(): void {
  if (!running) return
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  runTick(true)
}

export function isRunning(): boolean {
  return running
}

// ─── The tick ─────────────────────────────────────────────────────────────────

function runTick(forceTopUp = false): void {
  if (!running) return

  try {
    const now = Date.now()

    if (forceTopUp || now - lastTopUpMs > TOP_UP_INTERVAL_MS) {
      lastTopUpMs = now
      const created = repo.materialiseAll(now)
      if (created > 0) console.log(`[reminders] materialised ${created} occurrence(s)`)
    }

    processDue(now)
    processEscalation(now)
    pumpQueue()
    publishFiringCount()
  } catch (err) {
    // A failing tick must never kill the loop: the `finally` below re-arms
    // regardless, so a transient database error costs one cycle, not the feature.
    console.error(`[reminders] tick failed: ${(err as Error)?.message ?? String(err)}`)
  } finally {
    if (running) {
      let nextDue: number | null = null
      try {
        nextDue = repo.getNextDueAtMs()
      } catch {
        nextDue = null
      }
      timer = setTimeout(() => runTick(), computeTimerDelay(nextDue, Date.now()))
    }
  }
}

// ─── Firing ───────────────────────────────────────────────────────────────────

function processDue(nowMs: number): void {
  const nowIso = new Date(nowMs).toISOString()
  const rows = repo.getDueOccurrences(nowIso)
  if (rows.length === 0) return

  const plan = planDue(rows, nowMs)

  for (const row of plan.fresh) {
    fireOccurrence(row, nowIso, false)
  }

  if (plan.stale.length === 0) return

  if (plan.mode === 'individual') {
    // A handful of missed firings are worth delivering one at a time — the user
    // can still act on each. They are marked late so the window says so.
    for (const row of plan.stale) fireOccurrence(row, nowIso, true)
    notifyChanged()
    return
  }

  // Flood: collapse into one digest. Every collapsed occurrence is recorded as
  // 'missed' (not silently dropped) so the Reminders tab can still show it.
  const items: ReminderAlertItem[] = []
  const tiers: ReminderIntensity[] = []
  let collapsed = 0

  for (const row of plan.stale) {
    if (!repo.claimAsMissed(row.occurrence_id, nowIso)) continue
    collapsed++
    tiers.push(row.intensity)
    if (items.length < DIGEST_MAX_ITEMS) items.push({ title: row.title, fire_at: row.fire_at })
  }

  if (collapsed === 0) return
  console.log(`[reminders] catch-up digest for ${collapsed} missed occurrence(s)`)

  // At least a popup: a toast digest is exactly the thing Windows Focus Assist
  // swallows, and "you missed 12 reminders" is the one message that must land.
  const tier = tierIndex(highestTier(tiers)) >= tierIndex('popup') ? highestTier(tiers) : 'popup'

  enqueue({
    occurrenceId: null,
    payload: {
      kind: 'digest',
      occurrence_id: null,
      reminder_id: null,
      title:
        collapsed === 1
          ? '1 reminder was missed while you were away'
          : `${collapsed} reminders were missed while you were away`,
      body: null,
      tier,
      fire_at: nowIso,
      late: true,
      queued_count: 0,
      items,
      sound_data_uri: soundFor(tier, null),
      loop_sound: tier === 'blackout'
    }
  })
  notifyChanged()
}

function fireOccurrence(row: repo.DueOccurrenceRow, nowIso: string, late: boolean): void {
  const startTier = row.intensity
  // The claim IS the update. If it changes no row, something else already fired
  // this occurrence and we must not deliver a second alert for it.
  if (!repo.claimOccurrence(row.occurrence_id, startTier, nowIso)) return

  deliver(row, startTier, nowIso, late)
}

function deliver(
  row: repo.DueOccurrenceRow,
  tier: ReminderIntensity,
  firedAtIso: string,
  late: boolean
): void {
  if (tier === 'toast') {
    showToast(row, late)
    return
  }
  if (inFlight.has(row.occurrence_id)) return
  enqueue({
    occurrenceId: row.occurrence_id,
    payload: buildPayload(row, tier, firedAtIso, late)
  })
}

function buildPayload(
  row: repo.DueOccurrenceRow,
  tier: ReminderIntensity,
  fireAtIso: string,
  late: boolean
): ReminderAlertPayload {
  return {
    kind: 'single',
    occurrence_id: row.occurrence_id,
    reminder_id: row.reminder_id,
    title: row.title,
    body: row.body,
    tier,
    fire_at: row.fire_at || fireAtIso,
    late,
    queued_count: 0,
    items: [],
    sound_data_uri: soundFor(tier, row.sound),
    loop_sound: tier === 'blackout'
  }
}

/**
 * Tier 1.
 *
 * Note what a toast is NOT: a delivery guarantee. Windows Focus Assist swallows
 * native notifications silently, with no error and no callback — which is exactly
 * why tiers 2 and 3 exist and why escalation is measured from `fired_at` rather
 * than from any acknowledgement the OS might give us.
 */
function showToast(row: repo.DueOccurrenceRow, late: boolean): void {
  if (!Notification.isSupported()) {
    console.warn('[reminders] native notifications unsupported — escalation will carry this one')
    return
  }
  try {
    const notification = new Notification({
      title: late ? `${row.title} (missed)` : row.title,
      body: row.body ?? (late ? `Was due ${formatLocal(row.fire_at)}` : ''),
      silent: false
    })
    notification.on('click', () => {
      // A toast outlives the scheduler: Windows keeps it in the Action Center, so
      // this can fire during or after teardown, when the database is closing and
      // `reveal` would build a window for an app that is leaving.
      if (!running) return
      // Clicking is an acknowledgement: the user has seen it, so stop the climb.
      acknowledge(row.occurrence_id)
      try {
        hooks?.reveal()
      } catch (err) {
        console.error(`[reminders] reveal on toast click failed: ${(err as Error).message}`)
      }
    })
    notification.show()
  } catch (err) {
    console.error(`[reminders] toast failed: ${(err as Error).message}`)
  }
}

function formatLocal(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/**
 * Resolve the clip for a firing.
 *
 * The override is `reminders.sound`, and it is only trustworthy if it is on the
 * allowlist. It is a SYNCED field: a payload on the shared folder can set it to
 * anything, and it used to be joined straight onto the resources path and read
 * synchronously — `../../../../<anything>` was an arbitrary file read, cached for
 * the life of the process, with a hang or an OOM if the target was big. The
 * database and the sync importer both reject bad values before they are stored;
 * this is the read-time check, because the payload is untrusted input either way
 * and a stored row could predate the validation.
 *
 * Anything unrecognised falls back to the tier's own sound rather than to a path.
 */
function soundFor(tier: ReminderIntensity, override: string | null): string | null {
  if (tier === 'toast') return null
  if (override && !isAllowedReminderSound(override.trim())) {
    console.error(`[reminders] refusing unrecognised sound "${override}" — using the tier default`)
  }
  const chosen = isAllowedReminderSound(override?.trim())
    ? override!.trim()
    : tier === 'blackout'
      ? ALERT_SOUND
      : CHIME_SOUND
  return readResourceDataUri(chosen, 'audio/wav')
}

// ─── Escalation ───────────────────────────────────────────────────────────────

/**
 * Walk the ladder for everything delivered but not yet acknowledged.
 *
 * The target tier is derived from elapsed time (see `escalatedTier`), so this is
 * correct even if the process was asleep through several escalation intervals —
 * it lands on the right rung directly instead of needing one tick per rung. It
 * stops at blackout; there is nothing above it.
 */
function processEscalation(nowMs: number): void {
  const firing = repo.getFiringOccurrences()
  if (firing.length === 0) return

  for (const row of firing) {
    if (row.escalate_after_min === null) continue
    const firedAt = row.fired_at ? Date.parse(row.fired_at) : NaN
    if (!Number.isFinite(firedAt)) continue

    const target = escalatedTier(row.intensity, firedAt, row.escalate_after_min, nowMs)
    const current = row.current_tier ?? row.intensity
    if (tierIndex(target) <= tierIndex(current)) continue

    repo.setOccurrenceTier(row.occurrence_id, target)
    console.log(
      `[reminders] occurrence ${row.occurrence_id} escalated ${current} → ${target}`
    )

    const payload = buildPayload(row, target, new Date(nowMs).toISOString(), false)

    if (active?.occurrenceId === row.occurrence_id) {
      active.payload = { ...payload, queued_count: queue.length }
      updateAlert(active.payload)
      continue
    }

    const queued = queue.find((q) => q.occurrenceId === row.occurrence_id)
    if (queued) {
      queued.payload = payload
      continue
    }

    // A toast that has now escalated to a window tier: this is the moment it
    // joins the queue.
    enqueue({ occurrenceId: row.occurrence_id, payload })
  }
}

// ─── Queue ────────────────────────────────────────────────────────────────────

function enqueue(item: QueuedAlert): void {
  // Nothing joins the queue after teardown. It would never be pumped (see
  // pumpQueue), so this only stops the array growing for a process that is leaving.
  if (!running) return

  if (item.occurrenceId !== null) {
    if (inFlight.has(item.occurrenceId)) return
    inFlight.add(item.occurrenceId)
  } else if (item.payload.kind === 'digest') {
    // `inFlight` is keyed on occurrence id, and a digest has none — so it had no
    // duplicate protection at all, and two catch-up passes could queue two "N
    // reminders were missed" windows for overlapping sets of rows. There is only
    // ever one digest worth showing.
    if (active?.payload.kind === 'digest' || queue.some((q) => q.payload.kind === 'digest')) {
      console.log('[reminders] a digest is already queued — not adding a second')
      return
    }
  }
  queue.push(item)
}

/**
 * Show the next queued alert, or keep the live one's queue count honest.
 *
 * THE `running` GUARD IS LOAD-BEARING — it is the single chokepoint through which
 * an alert surface can be created, and without it the app could be made
 * permanently unquittable:
 *
 *   "Test now" is clicked and the tray's Quit chosen in the same moment →
 *   `before-quit` runs `runTeardown()` → `stop()` finds nothing to destroy →
 *   `runAutoExport('quit')` blocks for seconds on a network share → the queued
 *   `reminders:test-fire` invoke drains AFTER teardown (renderer IPC draining
 *   post-`before-quit` is exactly why `closeDb()` lives on `will-quit`) → a fresh
 *   `closable: false`, always-on-top window is created. `will-quit` never fires
 *   because that window will not close, and quitting again returns immediately on
 *   `teardownDone`. Task Manager was the only way out.
 *
 * Every other caller was already guarded; `testFire` was not. Guarding here rather
 * than only there means no future caller can reopen the hole.
 */
function pumpQueue(): void {
  if (!running) return

  // The window vanished without an action (crashed renderer, forced destroy):
  // drop it and move on rather than blocking the queue forever.
  if (active && !isAlertWindowOpen()) {
    releaseActive()
  }

  if (!active) {
    const next = queue.shift()
    if (!next) return
    active = next
    active.payload = { ...active.payload, queued_count: queue.length }
    showAlert(active.payload, onAlertWindowGone)
    return
  }

  // Keep the "N more waiting" affordance honest as the queue grows.
  if (active.payload.queued_count !== queue.length) {
    active.payload = { ...active.payload, queued_count: queue.length }
    updateAlert(active.payload)
  }
}

function releaseActive(): void {
  if (active && active.occurrenceId !== null) inFlight.delete(active.occurrenceId)
  active = null
}

function onAlertWindowGone(): void {
  releaseActive()
  if (!running) return
  pumpQueue()
  publishFiringCount()
}

/** Close the live alert and show whatever is next. */
function advance(): void {
  releaseActive()
  closeAlert()
  if (!running) return
  pumpQueue()
  publishFiringCount(true)
  notifyChanged()
}

// ─── Actions (IPC surface) ────────────────────────────────────────────────────

export function getActiveAlertPayload(): ReminderAlertPayload | null {
  return getCurrentAlertPayload()
}

export function acknowledge(occurrenceId: number): void {
  repo.acknowledgeOccurrence(occurrenceId, new Date().toISOString())
  if (active?.occurrenceId === occurrenceId) {
    advance()
  } else {
    const idx = queue.findIndex((q) => q.occurrenceId === occurrenceId)
    if (idx >= 0) {
      inFlight.delete(occurrenceId)
      queue.splice(idx, 1)
    }
    publishFiringCount(true)
    notifyChanged()
  }
}

export function snooze(occurrenceId: number, choice: ReminderSnoozeChoice): void {
  const until = snoozeUntil(choice, Date.now())
  repo.snoozeOccurrence(occurrenceId, until.toISOString())
  if (active?.occurrenceId === occurrenceId) {
    advance()
  } else {
    const idx = queue.findIndex((q) => q.occurrenceId === occurrenceId)
    if (idx >= 0) {
      inFlight.delete(occurrenceId)
      queue.splice(idx, 1)
    }
    publishFiringCount(true)
    notifyChanged()
  }
  if (running) rescheduleNow()
}

/** Dismiss the digest window (it stands in for rows already marked missed). */
export function dismissActiveDigest(): void {
  if (active?.occurrenceId === null) advance()
}

/**
 * Drop any queued or on-screen alert belonging to one reminder.
 *
 * Called when a reminder is disabled or deleted: the database rows are settled by
 * then, but a popup already on screen would otherwise sit there with no row
 * behind it, and its Done button would silently do nothing.
 */
export function dropAlertsForReminder(reminderId: number): void {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].payload.reminder_id === reminderId) {
      const occId = queue[i].occurrenceId
      if (occId !== null) inFlight.delete(occId)
      queue.splice(i, 1)
    }
  }
  if (active?.payload.reminder_id === reminderId) {
    advance()
    return
  }
  publishFiringCount(true)
}

/** The tray's "Snooze all reminders (15m)". Returns how many were moved. */
export function snoozeAllFiring(minutes = 15): number {
  const until = new Date(Date.now() + minutes * 60_000).toISOString()
  const moved = repo.snoozeAllFiring(until)
  queue.length = 0
  inFlight.clear()
  active = null
  closeAlert()
  publishFiringCount(true)
  notifyChanged()
  if (running) rescheduleNow()
  return moved
}

export function getFiringCount(): number {
  try {
    return repo.getFiringCount()
  } catch {
    return 0
  }
}

/**
 * Fire an occurrence right now, whatever its scheduled time — the manual-test
 * path ("Test now" in the Reminders tab), so a tier can be seen without waiting
 * for a real firing.
 */
export function testFire(reminderId: number, tier?: ReminderIntensity): boolean {
  // A no-op after teardown. This handler is reachable from a renderer invoke that
  // was in flight when the quit began and drains once the (synchronous, possibly
  // multi-second) final export has finished — at which point the database may
  // already be closing and a new alert window would block the quit outright. See
  // pumpQueue for the full sequence.
  if (!running) {
    console.log('[reminders] test-fire ignored — the scheduler has stopped')
    return false
  }

  const reminder = repo.getRawReminder(reminderId)
  if (!reminder) return false

  const nowIso = new Date().toISOString()
  const row: repo.DueOccurrenceRow = {
    occurrence_id: -reminderId, // negative: never collides with a real row id
    reminder_id: reminder.id,
    fire_at: nowIso,
    effective_at: nowIso,
    state: 'fired',
    current_tier: null,
    fired_at: nowIso,
    snooze_count: 0,
    title: reminder.title,
    body: reminder.body,
    intensity: tier ?? reminder.intensity,
    escalate_after_min: null,
    sound: reminder.sound,
    entity_type: reminder.entity_type,
    entity_id: reminder.entity_id
  }

  const effective = tier ?? reminder.intensity
  if (effective === 'toast') {
    showToast(row, false)
    return true
  }
  // A synthetic occurrence id: acknowledging it hits no row (the conditional
  // update simply changes nothing), which is exactly what a test should do.
  enqueue({ occurrenceId: row.occurrence_id, payload: buildPayload(row, effective, nowIso, false) })
  pumpQueue()
  return true
}
