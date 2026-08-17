/**
 * The timestamp expression notes and tasks write.
 *
 * WHY MILLISECONDS: `created_at` is part of the sync merge key (the fallback for
 * payloads from a build that predates `sync_id`), and `updated_at` decides
 * last-write-wins. At the column defaults' one-second resolution, two rows created
 * in the same second were indistinguishable and two edits in the same second could
 * not be ordered.
 *
 * WHY NOT ISO 8601 WITH 'T' AND 'Z', like `reminders` uses:
 *
 *   Every row already in the database, and every payload from a machine still on
 *   the older build, carries SQLite's `datetime('now')` shape —
 *   `2026-08-17 09:30:00`. These values are compared as STRINGS (`note.updated_at >
 *   existing.updated_at`). Switching to `2026-08-17T09:30:00.123Z` would break that
 *   ordering across the upgrade boundary: ' ' (0x20) sorts before 'T' (0x54), so any
 *   T-format timestamp compares as newer than ANY space-format one from the same
 *   date, regardless of the actual time. Mid-rollout, an older machine's 23:00 edit
 *   would lose to a newer machine's 01:00 edit.
 *
 *   Keeping SQLite's separator and appending the fraction is prefix-compatible with
 *   the existing values, so ordering stays monotone through the upgrade and in both
 *   directions between builds: `2026-08-17 09:30:00.123` > `2026-08-17 09:30:00`,
 *   which is exactly right.
 *
 * Both forms are UTC, so nothing about the meaning of the value changes.
 * `reminders` keeps its own ISO instants: they are the column defaults declared in
 * migration 2 and are never compared against legacy values.
 */
export const NOW_MS_EXPR = "strftime('%Y-%m-%d %H:%M:%f', 'now')"
