import { useEffect, useMemo, useState } from 'react'
import {
  AlarmClock,
  Bell,
  BellOff,
  CheckCircle2,
  ChevronDown,
  Clock,
  Link2,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Trash2,
  Zap
} from 'lucide-react'
import type {
  AppPreferences,
  ReminderInput,
  ReminderSnoozeChoice,
  ReminderWithMeta
} from '../../../../shared/types'
import { useReminders } from '../../hooks/useReminders'
import ReminderModal from './ReminderModal'
import ConfirmDialog from '../ConfirmDialog'

interface Props {
  sidebarCollapsed?: boolean
}

const SNOOZE_OPTIONS: { value: ReminderSnoozeChoice; label: string }[] = [
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 'tomorrow', label: 'Tomorrow 9am' }
]

type Group = 'firing' | 'upcoming' | 'missed' | 'disabled' | 'completed'

const GROUP_META: { key: Group; label: string; hint: string }[] = [
  { key: 'firing', label: 'Firing now', hint: 'Waiting to be acknowledged' },
  { key: 'upcoming', label: 'Upcoming', hint: 'Scheduled and armed' },
  { key: 'missed', label: 'Missed', hint: 'Went off while you were away' },
  { key: 'completed', label: 'Completed', hint: 'Nothing further scheduled' },
  { key: 'disabled', label: 'Disabled', hint: 'Turned off, keeps its schedule' }
]

/**
 * Exactly one group per reminder, so a row never appears twice. A recurring
 * reminder that missed a firing but still has one coming stays under Upcoming
 * with a "missed" badge — burying it under Missed would hide the fact that it is
 * still armed.
 */
function groupOf(reminder: ReminderWithMeta): Group {
  if (!reminder.enabled) return 'disabled'
  if (reminder.active_occurrence) return 'firing'
  if (reminder.next_occurrence) return 'upcoming'
  if (reminder.missed_count > 0) return 'missed'
  return 'completed'
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Who decides when this reminder fires.
 *
 * 'follows' — the task's due date moves it, and the user's tier / escalation /
 *   sound / lead time are respected while it does.
 * 'yours'  — a timing edit detached it, so the task's due date no longer touches
 *   it. This state used to be invisible: the user set a reminder up from a task,
 *   changed its tier, and had no way to know the link was gone.
 * null     — never task-linked. There is nothing to follow, so no badge.
 */
function ownershipOf(reminder: ReminderWithMeta): 'follows' | 'yours' | null {
  if (reminder.entity_type !== 'task' || reminder.entity_id === null) return null
  return reminder.auto_created === 1 ? 'follows' : 'yours'
}

function describeRecurrence(reminder: ReminderWithMeta): string | null {
  if (!reminder.freq) return null
  const every = reminder.interval > 1 ? `every ${reminder.interval} ` : ''
  if (reminder.freq === 'weekly' && reminder.byweekday) {
    const days = reminder.byweekday
      .split(',')
      .map((d) => WEEKDAY_LABELS[Number(d)] ?? '')
      .filter(Boolean)
      .join(', ')
    return `${every}week${reminder.interval > 1 ? 's' : ''} on ${days}`
  }
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[reminder.freq]
  return every ? `${every}${unit}s` : `Every ${unit}`
}

export default function RemindersTab({ sidebarCollapsed = false }: Props) {
  const {
    reminders,
    createReminder,
    updateReminder,
    deleteReminder,
    setEnabled,
    resetToAutomatic,
    snoozeOccurrence,
    dismissOccurrence,
    testFire
  } = useReminders()

  const [prefs, setPrefs] = useState<AppPreferences | null>(null)
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; reminder: ReminderWithMeta } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ReminderWithMeta | null>(null)
  const [snoozeMenuFor, setSnoozeMenuFor] = useState<number | null>(null)
  // What "Reset to automatic" said, shown on the row it applies to. A reset can be
  // refused (the task is gone) or succeed with a caveat (the reminder is now
  // following the task *and* switched off), and either silently would look like the
  // button did nothing.
  const [resetNote, setResetNote] = useState<{ id: number; message: string; ok: boolean } | null>(
    null
  )

  useEffect(() => {
    window.api.getAppPrefs().then(setPrefs)
  }, [])

  const grouped = useMemo(() => {
    const out: Record<Group, ReminderWithMeta[]> = {
      firing: [],
      upcoming: [],
      missed: [],
      completed: [],
      disabled: []
    }
    for (const reminder of reminders) out[groupOf(reminder)].push(reminder)
    out.upcoming.sort((a, b) =>
      (a.next_occurrence?.fire_at ?? '').localeCompare(b.next_occurrence?.fire_at ?? '')
    )
    return out
  }, [reminders])

  const handleSave = async (input: ReminderInput): Promise<void> => {
    if (modal?.mode === 'edit') {
      setResetNote(null)
      await updateReminder(modal.reminder.id, input)
    } else {
      await createReminder(input)
    }
    setModal(null)
  }

  const handleReset = async (reminder: ReminderWithMeta): Promise<void> => {
    const result = await resetToAutomatic(reminder.id)
    setResetNote(result.message ? { id: reminder.id, message: result.message, ok: result.ok } : null)
  }

  const row = (reminder: ReminderWithMeta): React.ReactNode => {
    const firing = reminder.active_occurrence
    const recurrence = describeRecurrence(reminder)
    const ownership = ownershipOf(reminder)
    // Only offer the way back while the task is still there to follow — a broken
    // link has no due date to recompute from.
    const canReset = ownership === 'yours' && reminder.entity_title !== null
    const note = resetNote?.id === reminder.id ? resetNote : null
    const nextAt = firing
      ? firing.fire_at
      : reminder.next_occurrence?.state === 'snoozed'
        ? reminder.next_occurrence.snoozed_until
        : reminder.next_occurrence?.fire_at

    return (
      <div
        key={reminder.id}
        className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
          firing
            ? 'border-amber-400/60 bg-amber-50 dark:bg-amber-500/10'
            : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900'
        }`}
      >
        <div className="mt-0.5 shrink-0">
          {firing ? (
            <AlarmClock className="w-4 h-4 text-amber-500" />
          ) : reminder.enabled ? (
            <Bell className="w-4 h-4 text-zinc-400" />
          ) : (
            <BellOff className="w-4 h-4 text-zinc-400" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{reminder.title}</span>
            {ownership === 'follows' && (
              <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent shrink-0"
                title="This reminder follows its task: moving the task's due date moves it. Your tier, escalation, sound and lead time are kept."
              >
                <Link2 className="w-2.5 h-2.5" />
                Follows task
              </span>
            )}
            {ownership === 'yours' && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 shrink-0"
                title="You set this reminder's own time, so the task's due date no longer moves it."
              >
                Yours
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
              {reminder.intensity}
            </span>
            {reminder.escalate_after_min !== null && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                title={`Escalates a rung every ${reminder.escalate_after_min} min while unacknowledged`}
              >
                ↑{reminder.escalate_after_min}m
              </span>
            )}
            {reminder.missed_count > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400">
                {reminder.missed_count} missed
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatWhen(nextAt)}
              {reminder.next_occurrence?.state === 'snoozed' && ' (snoozed)'}
            </span>
            {recurrence && (
              <span className="inline-flex items-center gap-1">
                <Repeat className="w-3 h-3" />
                {recurrence}
              </span>
            )}
            {reminder.entity_title && (
              <span className="truncate">task: {reminder.entity_title}</span>
            )}
            {firing?.current_tier && firing.current_tier !== reminder.intensity && (
              <span className="text-amber-600 dark:text-amber-400">
                escalated to {firing.current_tier}
              </span>
            )}
          </div>

          {reminder.body && (
            <p className="text-xs text-zinc-500 mt-1 line-clamp-2 whitespace-pre-wrap">
              {reminder.body}
            </p>
          )}

          {note && (
            <p
              className={`text-xs mt-1 ${
                note.ok ? 'text-zinc-500' : 'text-red-500'
              }`}
            >
              {note.message}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {firing && (
            <>
              <button
                onClick={() => dismissOccurrence(firing.id)}
                className="px-2 py-1 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
                title="Acknowledge this firing"
              >
                Dismiss
              </button>
              <div className="relative">
                <button
                  onClick={() =>
                    setSnoozeMenuFor((current) => (current === firing.id ? null : firing.id))
                  }
                  className="flex items-center gap-0.5 px-2 py-1 text-xs rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Snooze
                  <ChevronDown className="w-3 h-3" />
                </button>
                {snoozeMenuFor === firing.id && (
                  <div className="absolute right-0 top-full mt-1 w-36 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-xl overflow-hidden z-20">
                    {SNOOZE_OPTIONS.map((opt) => (
                      <button
                        key={String(opt.value)}
                        onClick={() => {
                          setSnoozeMenuFor(null)
                          snoozeOccurrence(firing.id, opt.value)
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {canReset && (
            <button
              onClick={() => handleReset(reminder)}
              className="p-1.5 rounded text-zinc-400 hover:text-accent hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title={`Reset to automatic — follow "${reminder.entity_title}" again, recomputing the time from its due date and this reminder's lead time. Clears any repeat.`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => testFire(reminder.id)}
            className="p-1.5 rounded text-zinc-400 hover:text-amber-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Fire this now, to see what it looks like"
          >
            <Zap className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setEnabled(reminder.id, !reminder.enabled)}
            className="p-1.5 rounded text-zinc-400 hover:text-accent hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title={reminder.enabled ? 'Disable' : 'Enable'}
          >
            {reminder.enabled ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setModal({ mode: 'edit', reminder })}
            className="p-1.5 rounded text-zinc-400 hover:text-accent hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setPendingDelete(reminder)}
            className="p-1.5 rounded text-zinc-400 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    )
  }

  const firingCount = grouped.firing.length

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400">
              {reminders.length} reminder{reminders.length === 1 ? '' : 's'}
            </span>
            {firingCount > 0 && (
              <>
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  {firingCount} waiting
                </span>
                <button
                  onClick={() => window.api.snoozeAllReminders(15)}
                  className="px-2 py-1 text-xs rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Snooze all 15m
                </button>
              </>
            )}
          </div>
          <button
            onClick={() => setModal({ mode: 'create' })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Reminder
          </button>
        </div>

        {/* Content */}
        <div
          className={`flex-1 overflow-auto p-4 space-y-6 ${sidebarCollapsed ? '' : ''}`}
          onClick={() => setSnoozeMenuFor(null)}
        >
          {reminders.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400 gap-2">
              <CheckCircle2 className="w-8 h-8" />
              <p className="text-sm">No reminders yet.</p>
              <p className="text-xs">
                High-priority tasks with a future due date get one automatically.
              </p>
            </div>
          )}

          {GROUP_META.map(({ key, label, hint }) => {
            const items = grouped[key]
            if (items.length === 0) return null
            return (
              <section key={key}>
                <div className="flex items-baseline gap-2 mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {label}
                  </h3>
                  <span className="text-[11px] text-zinc-400">
                    {items.length} · {hint}
                  </span>
                </div>
                <div className="space-y-2">{items.map(row)}</div>
              </section>
            )
          })}
        </div>
      </div>

      {modal && (
        <ReminderModal
          reminder={modal.mode === 'edit' ? modal.reminder : null}
          prefs={prefs}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this reminder?"
          message={`"${pendingDelete.title}" and its schedule will be removed. This cannot be undone.`}
          onConfirm={async () => {
            const target = pendingDelete
            setPendingDelete(null)
            await deleteReminder(target.id)
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
