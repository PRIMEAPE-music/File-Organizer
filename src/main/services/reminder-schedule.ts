import type { ReminderIntensity, ReminderSnoozeChoice } from '../../shared/types'

/**
 * Scheduling *policy* for reminders: how long to sleep, what counts as merely
 * due versus missed-while-away, and how the escalation ladder climbs.
 *
 * Deliberately free of Electron and of the database so it can be driven
 * directly by a verification script — the timer-length invariant below is the
 * kind of thing that must be provable, not asserted in a comment.
 */

/**
 * HARD CEILING on any timeout this feature creates.
 *
 * Two independent reasons, both of which have bitten reminder features before:
 *
 *  1. Node clamps a delay above 2^31-1 ms (~24.8 days) and fires the timer
 *     *immediately* instead. A reminder set for next year would therefore go off
 *     the moment it was created.
 *  2. A long timer does not survive suspend. The remaining delay is not
 *     re-derived on wake, so a closed laptop lid silently eats the firing.
 *
 * So the scheduler never sleeps longer than this and always re-derives what is
 * due from the database when it wakes.
 */
export const MAX_TIMER_MS = 60_000

/** The coarse heartbeat: the longest the scheduler will sit idle. */
export const TICK_INTERVAL_MS = 30_000

/**
 * How far past its fire time an occurrence has to be before it counts as
 * "missed while we were away" rather than "just came due".
 *
 * Comfortably more than two heartbeats, so an occurrence that came due between
 * ticks during normal running is never mistaken for a catch-up.
 */
export const STALE_AFTER_MS = 2 * TICK_INTERVAL_MS + 60_000

/**
 * Above this many overdue occurrences, catch-up collapses into a single digest.
 * A week offline must not produce 200 popups that get dismissed blindly — which
 * trains the user to dismiss the one that mattered too.
 */
export const DIGEST_THRESHOLD = 5

/** Never list more than this many rows inside one digest. */
export const DIGEST_MAX_ITEMS = 25

/** The ladder, in climbing order. */
export const TIER_LADDER: readonly ReminderIntensity[] = ['toast', 'popup', 'blackout'] as const

export function tierIndex(tier: ReminderIntensity): number {
  const idx = TIER_LADDER.indexOf(tier)
  return idx < 0 ? 0 : idx
}

export function isTierAtLeast(tier: ReminderIntensity, floor: ReminderIntensity): boolean {
  return tierIndex(tier) >= tierIndex(floor)
}

export function highestTier(tiers: ReminderIntensity[]): ReminderIntensity {
  return tiers.reduce<ReminderIntensity>(
    (best, t) => (tierIndex(t) > tierIndex(best) ? t : best),
    'toast'
  )
}

/**
 * The tier an unacknowledged firing should currently be displaying.
 *
 * Derived from elapsed time rather than stored per-rung, so it is correct after
 * a sleep/wake with no bookkeeping to lose: one rung per `escalateAfterMin`,
 * capped at the top of the ladder. Returns `startTier` when escalation is off.
 */
export function escalatedTier(
  startTier: ReminderIntensity,
  firedAtMs: number,
  escalateAfterMin: number | null,
  nowMs: number
): ReminderIntensity {
  if (escalateAfterMin === null || !Number.isFinite(escalateAfterMin) || escalateAfterMin <= 0) {
    return startTier
  }
  const stepMs = escalateAfterMin * 60_000
  const elapsed = Math.max(0, nowMs - firedAtMs)
  const climbed = Math.floor(elapsed / stepMs)
  const target = Math.min(tierIndex(startTier) + climbed, TIER_LADDER.length - 1)
  return TIER_LADDER[target]
}

/**
 * How long to sleep before the next check.
 *
 * `nextDueMs` is the soonest moment anything is due, or null when nothing is
 * scheduled at all. The result is the heartbeat, shortened to land exactly on
 * that moment when it is closer than one heartbeat away — which is the "short
 * precise timer" — and is *never* longer than MAX_TIMER_MS whatever the input.
 * A reminder years out simply produces a heartbeat.
 */
export function computeTimerDelay(nextDueMs: number | null, nowMs: number): number {
  let delay = TICK_INTERVAL_MS
  if (nextDueMs !== null && Number.isFinite(nextDueMs)) {
    const untilDue = nextDueMs - nowMs
    if (untilDue < delay) {
      // Never zero: a due-now occurrence is handled by this very tick, and a
      // 0ms loop would spin if a row somehow could not be claimed.
      delay = Math.max(250, untilDue)
    }
  }
  // The invariant, enforced rather than assumed.
  return Math.min(Math.max(delay, 0), MAX_TIMER_MS)
}

export interface DueRow {
  occurrence_id: number
  /** fire_at for a pending row, snoozed_until for a snoozed one. */
  effective_at: string
}

export interface DuePlan<T extends DueRow> {
  /** Came due just now — deliver normally. */
  fresh: T[]
  /** Overdue beyond the grace window — the catch-up set. */
  stale: T[]
  /**
   * How to treat `stale`: one alert each, or a single digest that stands in for
   * all of them.
   */
  mode: 'individual' | 'digest'
}

/**
 * Split the due set into "just came due" and "missed while we were away", and
 * decide whether the latter is small enough to deliver one alert at a time.
 */
export function planDue<T extends DueRow>(rows: T[], nowMs: number): DuePlan<T> {
  const fresh: T[] = []
  const stale: T[] = []

  for (const row of rows) {
    const at = Date.parse(row.effective_at)
    // An unparseable timestamp is treated as due now rather than skipped: a bad
    // row must not become a reminder that never fires again.
    if (!Number.isFinite(at) || nowMs - at <= STALE_AFTER_MS) fresh.push(row)
    else stale.push(row)
  }

  return { fresh, stale, mode: stale.length > DIGEST_THRESHOLD ? 'digest' : 'individual' }
}

/** Absolute moment a snooze choice resolves to. Local time for 'tomorrow'. */
export function snoozeUntil(choice: ReminderSnoozeChoice, nowMs: number): Date {
  if (choice === 'tomorrow') {
    const now = new Date(nowMs)
    // Local constructor so "tomorrow 9am" is 9am on the wall clock even across
    // a DST boundary.
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0)
  }
  const minutes = Number(choice)
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : 10
  return new Date(nowMs + safe * 60_000)
}
