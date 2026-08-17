import { useState } from 'react'
import { X } from 'lucide-react'
import { useInFlight } from '../../hooks/useInFlight'
import { REMINDER_SOUND_FILES, type ReminderSoundFile } from '../../../../shared/reminder-sounds'
import type {
  AppPreferences,
  ReminderFreq,
  ReminderInput,
  ReminderIntensity,
  ReminderWithMeta
} from '../../../../shared/types'

interface Props {
  reminder?: ReminderWithMeta | null
  prefs: AppPreferences | null
  /** Awaited, so the submit button can stay disabled until the write finishes. */
  onSave: (input: ReminderInput) => void | Promise<void>
  onClose: () => void
}

const FREQ_OPTIONS: { value: '' | ReminderFreq; label: string }[] = [
  { value: '', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' }
]

const INTENSITY_OPTIONS: { value: ReminderIntensity; label: string }[] = [
  { value: 'toast', label: 'Toast — a notification' },
  { value: 'popup', label: 'Popup — always-on-top window' },
  { value: 'blackout', label: 'Blackout — covers every screen' }
]

/**
 * Built from the shared allowlist, so the picker cannot offer a value the main
 * process would reject. `sound` is a synced field and is validated again at the
 * database boundary, on import and at read time — see shared/reminder-sounds.ts.
 */
const SOUND_LABELS: Record<ReminderSoundFile, string> = {
  'reminder-chime.wav': 'Chime (gentle)',
  'reminder-alert.wav': 'Alert (insistent)'
}

const SOUND_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Default for the tier' },
  ...REMINDER_SOUND_FILES.map((file) => ({ value: file as string, label: SOUND_LABELS[file] }))
]

/** 0 = Sunday, matching the stored `byweekday` convention. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const pad = (n: number): string => String(n).padStart(2, '0')

/** ISO instant → the value a `datetime-local` input expects (local wall clock). */
function isoToLocalInput(iso: string | undefined): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000)
  const safe = Number.isNaN(d.getTime()) ? new Date(Date.now() + 60 * 60 * 1000) : d
  return `${safe.getFullYear()}-${pad(safe.getMonth() + 1)}-${pad(safe.getDate())}T${pad(safe.getHours())}:${pad(safe.getMinutes())}`
}

/**
 * `datetime-local` has no timezone, so `new Date(value)` reads it as local wall
 * clock — which is exactly right: the user picked a wall-clock time, and the
 * absolute instant is derived from it here, once.
 */
function localInputToIso(value: string): string | null {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export default function ReminderModal({ reminder, prefs, onSave, onClose }: Props) {
  // Fixed when the modal opens: a value that moved under the user mid-edit would
  // invalidate a time they had already picked.
  const [nowLocalInput] = useState(() => isoToLocalInput(new Date().toISOString()))
  const [title, setTitle] = useState(reminder?.title ?? '')
  const [body, setBody] = useState(reminder?.body ?? '')
  const [when, setWhen] = useState(() => isoToLocalInput(reminder?.fire_at))
  const [freq, setFreq] = useState<'' | ReminderFreq>(reminder?.freq ?? '')
  const [intervalValue, setIntervalValue] = useState(String(reminder?.interval ?? 1))
  const [weekdays, setWeekdays] = useState<Set<number>>(
    () =>
      new Set(
        (reminder?.byweekday ?? '')
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      )
  )
  const [intensity, setIntensity] = useState<ReminderIntensity>(
    reminder?.intensity ?? prefs?.reminderDefaultIntensity ?? 'toast'
  )
  const [escalateEnabled, setEscalateEnabled] = useState(
    reminder ? reminder.escalate_after_min !== null : prefs?.reminderDefaultEscalateMin !== null
  )
  const [escalateAfter, setEscalateAfter] = useState(
    String(reminder?.escalate_after_min ?? prefs?.reminderDefaultEscalateMin ?? 5)
  )
  const [leadTime, setLeadTime] = useState(String(reminder?.lead_time_min ?? 0))
  const [sound, setSound] = useState(reminder?.sound ?? '')
  const [error, setError] = useState<string | null>(null)
  /**
   * This reminder currently follows its task's due date. Changing the time or the
   * repeat is what detaches it (see `editDetachesFromTask` in the main process), so
   * say so at the moment of the decision — the user who hit this had no way to know
   * the link had gone.
   */
  const followsTask = reminder?.auto_created === 1 && reminder.entity_type === 'task'
  // The parent closes this modal only after its save resolves, so without the
  // guard a double-click on Create made two reminders.
  const { inFlight: saving, run: runSave } = useInFlight('save reminder')

  const toggleWeekday = (day: number): void => {
    setWeekdays((prev) => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
  }

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!title.trim()) return

    const fireAt = localInputToIso(when)
    if (!fireAt) {
      setError('Pick a valid date and time.')
      return
    }

    // A one-off in the past can never fire: materialisation refuses to create a
    // pending occurrence with a past `fire_at`, because backfilling those is what
    // manufactured the "14 reminders were missed while you were away" flood. Say so
    // here rather than accepting a reminder that would silently do nothing.
    //
    // A REPEATING reminder is different: its first firing is an anchor the series is
    // derived from, and an anchor in the past is both legitimate and common (a daily
    // 9am reminder created last week). Only the future occurrences materialise, so
    // there is nothing to warn about.
    if (freq === '' && new Date(fireAt).getTime() <= Date.now()) {
      setError('Pick a time in the future — a one-off reminder in the past will not fire.')
      return
    }
    setError(null)

    const parsedInterval = Number(intervalValue)
    const parsedEscalate = Number(escalateAfter)

    runSave(() =>
      onSave({
        title: title.trim(),
        body: body.trim() ? body.trim() : null,
        fire_at: fireAt,
        freq: freq === '' ? null : freq,
        interval:
          Number.isFinite(parsedInterval) && parsedInterval > 0 ? Math.round(parsedInterval) : 1,
        byweekday: freq === 'weekly' && weekdays.size > 0 ? [...weekdays].sort((a, b) => a - b) : null,
        lead_time_min: Math.max(0, Number(leadTime) || 0),
        intensity,
        escalate_after_min:
          escalateEnabled && Number.isFinite(parsedEscalate) && parsedEscalate > 0
            ? Math.round(parsedEscalate)
            : null,
        sound: sound || null,
        entity_type: reminder?.entity_type ?? null,
        entity_id: reminder?.entity_id ?? null
      })
    )
  }

  const inputClass =
    'w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-accent/50'

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-800 rounded-xl shadow-2xl w-[520px] max-h-[85vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">{reminder ? 'Edit Reminder' : 'New Reminder'}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {followsTask && (
            <p className="text-[11px] text-zinc-500 bg-zinc-100 dark:bg-zinc-700/50 rounded-md px-3 py-2">
              This reminder follows{' '}
              <span className="font-medium">{reminder?.entity_title ?? 'its task'}</span>: its due
              date sets the time, minus the lead time below. Changing the first firing or the repeat
              makes the schedule yours instead, and the task will stop moving it. Everything else —
              title, details, intensity, escalation, sound, lead time — is yours already.
            </p>
          )}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Title</label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What should this remind you of?"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Details</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              placeholder="Optional"
              className={`${inputClass} resize-none`}
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">First firing</label>
            <input
              type="datetime-local"
              value={when}
              // Only for a one-off: a repeating reminder's first firing is an anchor
              // and is allowed to sit in the past (see handleSubmit).
              min={freq === '' ? nowLocalInput : undefined}
              onChange={(e) => setWhen(e.target.value)}
              className={inputClass}
            />
            <p className="text-[11px] text-zinc-400 mt-1">
              {freq === ''
                ? 'Must be in the future — a one-off firing in the past never fires.'
                : 'Repeats keep this wall-clock time, including across daylight saving changes. Only future firings are scheduled.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Repeat</label>
              <select
                value={freq}
                onChange={(e) => setFreq(e.target.value as '' | ReminderFreq)}
                className={inputClass}
              >
                {FREQ_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Every</label>
              <input
                type="number"
                min={1}
                max={365}
                value={intervalValue}
                disabled={freq === ''}
                onChange={(e) => setIntervalValue(e.target.value)}
                className={`${inputClass} disabled:opacity-50`}
              />
            </div>
          </div>

          {freq === 'weekly' && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1">On these days</label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((label, day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleWeekday(day)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      weekdays.has(day)
                        ? 'bg-accent text-white'
                        : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-zinc-400 mt-1">
                None selected means the same weekday as the first firing.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Starting intensity</label>
            <select
              value={intensity}
              onChange={(e) => setIntensity(e.target.value as ReminderIntensity)}
              className={inputClass}
            >
              {INTENSITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Escalate after (min)</label>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={escalateEnabled}
                  onChange={(e) => setEscalateEnabled(e.target.checked)}
                  className="accent-[var(--color-accent)]"
                  aria-label="Escalate if unacknowledged"
                />
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={escalateAfter}
                  disabled={!escalateEnabled}
                  onChange={(e) => setEscalateAfter(e.target.value)}
                  className={`${inputClass} disabled:opacity-50`}
                />
              </div>
              <p className="text-[11px] text-zinc-400 mt-1">
                One rung per interval, stopping at blackout.
              </p>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Lead time (min)</label>
              <input
                type="number"
                min={0}
                max={43200}
                value={leadTime}
                onChange={(e) => setLeadTime(e.target.value)}
                className={inputClass}
              />
              <p className="text-[11px] text-zinc-400 mt-1">
                {followsTask
                  ? "How far before the task's due date this fires — kept when the due date moves."
                  : 'How early a task reminder fires. Recorded for reference on a standalone one.'}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Sound</label>
            <select value={sound} onChange={(e) => setSound(e.target.value)} className={inputClass}>
              {SOUND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-zinc-400 mt-1">
              Toasts use the Windows notification sound; popups and blackouts play this.
            </p>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || saving}
              className="px-3 py-1.5 text-sm rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {reminder ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
