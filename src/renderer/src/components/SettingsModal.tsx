import { useState, useEffect } from 'react'
import { X, Settings as SettingsIcon } from 'lucide-react'
import type { AppPreferences, ReminderIntensity, TaskPriority } from '../../../shared/types'

interface Props {
  onClose: () => void
}

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low and above (all tasks)' },
  { value: 'medium', label: 'Medium and above' },
  { value: 'high', label: 'High and above' },
  { value: 'urgent', label: 'Urgent only' }
]

const INTENSITY_OPTIONS: { value: ReminderIntensity; label: string }[] = [
  { value: 'toast', label: 'Toast — a notification' },
  { value: 'popup', label: 'Popup — always-on-top window' },
  { value: 'blackout', label: 'Blackout — covers every screen' }
]

interface FieldRowProps {
  label: string
  hint: string
  children: React.ReactNode
}

function FieldRow({ label, hint, children }: FieldRowProps) {
  return (
    <div>
      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</div>
      <div className="text-xs text-zinc-500 mt-0.5 mb-1.5">{hint}</div>
      {children}
    </div>
  )
}

interface ToggleRowProps {
  label: string
  hint: string
  checked: boolean
  onChange: () => void
}

function ToggleRow({ label, hint, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</div>
        <div className="text-xs text-zinc-500 mt-0.5">{hint}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-600'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

const selectClass =
  'w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-accent/50'

export default function SettingsModal({ onClose }: Props) {
  const [prefs, setPrefs] = useState<AppPreferences | null>(null)

  useEffect(() => {
    window.api.getAppPrefs().then(setPrefs)
  }, [])

  const patch = async (next: Partial<AppPreferences>) => {
    const applied = await window.api.setAppPrefs(next)
    setPrefs(applied)
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 w-[480px] max-h-[85vh] overflow-y-auto shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2">
            <SettingsIcon size={15} className="text-accent" />
            <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">Settings</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {prefs === null ? (
            <div className="text-sm text-zinc-500">Loading…</div>
          ) : (
            <>
              <ToggleRow
                label="Keep running in the tray"
                hint="Closing the window hides it instead of quitting, so background work keeps going"
                checked={prefs.closeToTray}
                onChange={() => patch({ closeToTray: !prefs.closeToTray })}
              />
              <ToggleRow
                label="Start with Windows"
                hint="Launch minimised to the tray when you sign in"
                checked={prefs.openAtLogin}
                onChange={() => patch({ openAtLogin: !prefs.openAtLogin })}
              />
              <p className="text-xs text-zinc-400">
                Right-click the tray icon to show the window or quit. Ctrl+Shift+Space brings it
                back at any time.
              </p>

              <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4 space-y-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Reminders
                </div>

                <FieldRow
                  label="Automatic task reminders"
                  hint="Tasks at or above this priority with a future due date get a reminder automatically. Existing tasks are never backfilled."
                >
                  <select
                    value={prefs.reminderPriorityThreshold}
                    onChange={(e) =>
                      patch({ reminderPriorityThreshold: e.target.value as TaskPriority })
                    }
                    className={selectClass}
                  >
                    {PRIORITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </FieldRow>

                <FieldRow
                  label="Default lead time"
                  hint="Minutes before the due date an automatic reminder fires. A due date with no time is treated as 9am that day."
                >
                  <input
                    type="number"
                    min={0}
                    max={43200}
                    value={prefs.reminderDefaultLeadMin}
                    onChange={(e) =>
                      patch({ reminderDefaultLeadMin: Math.max(0, Number(e.target.value) || 0) })
                    }
                    className={selectClass}
                  />
                </FieldRow>

                <FieldRow
                  label="Default intensity"
                  hint="Where a new reminder starts on the ladder. Escalation is what makes it louder."
                >
                  <select
                    value={prefs.reminderDefaultIntensity}
                    onChange={(e) =>
                      patch({ reminderDefaultIntensity: e.target.value as ReminderIntensity })
                    }
                    className={selectClass}
                  >
                    {INTENSITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </FieldRow>

                <FieldRow
                  label="Default escalation"
                  hint="Minutes an unacknowledged reminder waits before climbing a rung. Empty means never escalate."
                >
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    placeholder="never"
                    value={prefs.reminderDefaultEscalateMin ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value.trim()
                      const parsed = Number(raw)
                      patch({
                        reminderDefaultEscalateMin:
                          raw === '' || !Number.isFinite(parsed) || parsed <= 0
                            ? null
                            : Math.round(parsed)
                      })
                    }}
                    className={selectClass}
                  />
                </FieldRow>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
