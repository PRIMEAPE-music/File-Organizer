/**
 * The complete set of sounds a reminder may name.
 *
 * WHY AN ALLOWLIST AND NOT A PATH CHECK: `reminders.sound` is a *synced* field. It
 * arrives from a JSON payload on a network share that any machine (or anything
 * that can write to that share) can author, and the main process turns it into a
 * filename it then reads synchronously and base64-encodes. A value like
 * `../../../../Windows/System32/config/SAM` was therefore an arbitrary file read,
 * plus a hang or an OOM if the target was large — and the result was cached for
 * the life of the process.
 *
 * Containment checks ("does it contain ..") are the weaker form of this and are
 * easy to get subtly wrong across platforms. A closed set of known resource
 * filenames cannot be wrong: anything not on it is rejected, and the tier's
 * default sound is used instead.
 *
 * Lives in shared/ so the renderer's picker, the database boundary and the sync
 * importer all validate against one list rather than three copies of it.
 */
export const REMINDER_SOUND_FILES = ['reminder-chime.wav', 'reminder-alert.wav'] as const

export type ReminderSoundFile = (typeof REMINDER_SOUND_FILES)[number]

/** Empty/absent means "the default for the tier" and is always acceptable. */
export function isAllowedReminderSound(value: unknown): value is ReminderSoundFile {
  return typeof value === 'string' && (REMINDER_SOUND_FILES as readonly string[]).includes(value)
}

/**
 * Coerce an untrusted `sound` to something safe to store: a known filename, or
 * null meaning "use the tier default". Never returns the input unchanged unless
 * it is on the list.
 */
export function sanitizeReminderSound(value: unknown): ReminderSoundFile | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return isAllowedReminderSound(trimmed) ? trimmed : null
}
