import { useState, useEffect } from 'react'
import { X, Settings as SettingsIcon } from 'lucide-react'
import type { AppPreferences } from '../../../shared/types'

interface Props {
  onClose: () => void
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
        className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 w-[480px] shadow-xl"
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
