import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  startOfWeek,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  differenceInCalendarWeeks,
  differenceInCalendarYears
} from 'date-fns'
import type { ReminderFreq } from '../../shared/types'

/**
 * Recurrence expansion for reminders. Pure date maths — no database, no
 * Electron — so it can be exercised directly by a script.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY EVERY STEP IS LOCAL-TIME ARITHMETIC
 *
 * A 9am daily reminder has to stay 9am *local* forever, including across a DST
 * transition. The tempting implementation — take the stored UTC instant and add
 * 86_400_000 ms — is wrong: it drifts by an hour twice a year, so the reminder
 * silently becomes 8am (or 10am) for half the year.
 *
 * So every step here is done on a local `Date` with date-fns' `addDays` /
 * `addWeeks` / `addMonths` / `addYears`, which mutate the calendar fields
 * (`setDate`, `setMonth`) and therefore preserve wall-clock time by
 * construction. Only at the very end does the caller turn the result back into
 * an absolute instant with `toISOString()`.
 *
 * EVERY OCCURRENCE IS COMPUTED FROM THE ANCHOR, NOT FROM ITS PREDECESSOR.
 * Chaining (`next = addMonths(previous, 1)`) accumulates clamping damage: a
 * 31st-of-the-month reminder would go Jan 31 → Feb 28 → Mar 28 and stay stuck
 * on the 28th. Deriving occurrence k as `addMonths(anchor, k * interval)` gives
 * the correct Jan 31 → Feb 28 → Mar 31 → Apr 30.
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface RecurrenceSpec {
  /** The first firing. Also supplies the time-of-day for every later firing. */
  fireAt: Date
  /** null = one-off. */
  freq: ReminderFreq | null
  /** Every N days/weeks/months/years. Values < 1 are treated as 1. */
  interval: number
  /** Weekly only: 0-6, 0 = Sunday. Empty/null means "same weekday as anchor". */
  byweekday: number[] | null
}

export interface GenerateOptions {
  /** Inclusive lower bound. Occurrences before this are not returned. */
  from: Date
  /** Inclusive upper bound — the rolling horizon. Generation is never open-ended. */
  until: Date
  /** Hard ceiling on returned occurrences. */
  maxCount?: number
}

/**
 * Belt-and-braces stop for the stepping loops. Reached only if `until` is
 * absurdly far out; the horizon (60 days) keeps real use orders of magnitude
 * below it.
 */
const MAX_STEPS = 20_000

const DEFAULT_MAX_COUNT = 2_000

export function parseByWeekday(raw: string | null | undefined): number[] | null {
  if (!raw) return null
  const days = raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
  const unique = [...new Set(days)].sort((a, b) => a - b)
  return unique.length > 0 ? unique : null
}

export function formatByWeekday(days: number[] | null | undefined): string | null {
  if (!days || days.length === 0) return null
  const clean = [...new Set(days.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort(
    (a, b) => a - b
  )
  return clean.length > 0 ? clean.join(',') : null
}

/**
 * Copy the anchor's wall-clock time onto `day`'s calendar date.
 *
 * Built through the local-time `Date` constructor rather than `setHours`, so the
 * result is "this calendar day at this local time" whatever the offset happens
 * to be on that day.
 */
function withTimeOf(day: Date, anchor: Date): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    anchor.getHours(),
    anchor.getMinutes(),
    anchor.getSeconds(),
    anchor.getMilliseconds()
  )
}

/**
 * How many whole steps to skip before `from`, so a reminder anchored years ago
 * doesn't cost one loop iteration per day since. Deliberately conservative
 * (one step back, floored at zero): overshooting would drop a live occurrence,
 * while undershooting only costs a couple of cheap iterations.
 */
function fastForward(unitsBetween: number, interval: number): number {
  if (!Number.isFinite(unitsBetween) || unitsBetween <= 0) return 0
  return Math.max(0, Math.floor(unitsBetween / interval) - 1)
}

/**
 * Expand a recurrence into absolute `Date`s inside [from, until].
 *
 * Bounded by construction: the caller always passes a finite `until` (the
 * rolling horizon), and both MAX_STEPS and `maxCount` cap the work.
 */
export function generateOccurrences(spec: RecurrenceSpec, opts: GenerateOptions): Date[] {
  const anchor = spec.fireAt
  if (Number.isNaN(anchor.getTime())) return []

  const { from, until } = opts
  const maxCount = opts.maxCount ?? DEFAULT_MAX_COUNT
  if (until.getTime() < from.getTime()) return []

  const interval = Number.isInteger(spec.interval) && spec.interval > 0 ? spec.interval : 1
  const out: Date[] = []

  const push = (d: Date): boolean => {
    if (d.getTime() < from.getTime()) return true
    if (d.getTime() > until.getTime()) return true
    out.push(d)
    return out.length < maxCount
  }

  // One-off: exactly one firing, at the anchor.
  if (!spec.freq) {
    push(anchor)
    return out
  }

  if (spec.freq === 'weekly') {
    const weekdays = spec.byweekday && spec.byweekday.length > 0 ? [...spec.byweekday].sort((a, b) => a - b) : null

    if (weekdays) {
      // Multiple weekdays per week: walk whole weeks from the anchor's week, and
      // inside each one emit the selected days at the anchor's time of day.
      const weekAnchor = startOfWeek(anchor, { weekStartsOn: 0 })
      let k = fastForward(
        differenceInCalendarWeeks(from, weekAnchor, { weekStartsOn: 0 }),
        interval
      )
      for (let steps = 0; steps < MAX_STEPS; steps++, k++) {
        const base = addWeeks(weekAnchor, k * interval)
        // The whole week is past the horizon — nothing later can qualify.
        if (base.getTime() > until.getTime() + 7 * 86_400_000) break
        for (const wd of weekdays) {
          const candidate = withTimeOf(addDays(base, wd), anchor)
          // Never emit before the anchor: the reminder does not exist yet.
          if (candidate.getTime() < anchor.getTime()) continue
          if (candidate.getTime() > until.getTime()) continue
          if (!push(candidate)) return out
        }
        if (base.getTime() > until.getTime()) break
      }
      return out
    }

    let k = fastForward(differenceInCalendarWeeks(from, anchor, { weekStartsOn: 0 }), interval)
    for (let steps = 0; steps < MAX_STEPS; steps++, k++) {
      const candidate = addWeeks(anchor, k * interval)
      if (candidate.getTime() > until.getTime()) break
      if (!push(candidate)) return out
    }
    return out
  }

  const stepper: { add: (d: Date, n: number) => Date; between: (a: Date, b: Date) => number } =
    spec.freq === 'daily'
      ? { add: addDays, between: differenceInCalendarDays }
      : spec.freq === 'monthly'
        ? { add: addMonths, between: differenceInCalendarMonths }
        : { add: addYears, between: differenceInCalendarYears }

  let k = fastForward(stepper.between(from, anchor), interval)
  for (let steps = 0; steps < MAX_STEPS; steps++, k++) {
    const candidate = stepper.add(anchor, k * interval)
    if (candidate.getTime() > until.getTime()) break
    if (!push(candidate)) return out
  }
  return out
}

/**
 * A task's `due_date` is a date-only string from an `<input type="date">`, so it
 * carries no time. Midnight is a hostile moment for a reminder, so a bare date
 * is read as 9am local on that day. A due date that does carry a time is
 * respected exactly.
 */
export const DUE_DATE_DEFAULT_HOUR = 9

export function dueDateToInstant(dueDate: string | null): Date | null {
  if (!dueDate) return null
  const trimmed = dueDate.trim()
  if (!trimmed) return null

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    // Local constructor, not Date.parse: 'YYYY-MM-DD' parses as UTC midnight,
    // which lands on the previous day for anyone west of Greenwich.
    return new Date(Number(y), Number(m) - 1, Number(d), DUE_DATE_DEFAULT_HOUR, 0, 0, 0)
  }

  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
