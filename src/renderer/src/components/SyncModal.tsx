import { useState, useEffect } from 'react'
import { X, RefreshCw, FolderOpen, Check, AlertCircle, Wifi } from 'lucide-react'
import type { SyncConfig, SyncPreferences } from '../../../shared/types'

interface Props {
  onClose: () => void
  currentPrefs: SyncPreferences
  onSyncImport: (prefs: SyncPreferences) => void
}

export default function SyncModal({ onClose, currentPrefs, onSyncImport }: Props) {
  const [config, setConfig] = useState<SyncConfig>({ enabled: false, syncPath: '', lastSyncedAt: null, autoSync: true })
  const [status, setStatus] = useState<{ message: string; ok: boolean } | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    window.api.getSyncConfig().then(setConfig)
  }, [])

  const saveConfig = async (next: SyncConfig) => {
    setConfig(next)
    await window.api.setSyncConfig(next)
  }

  const browse = async () => {
    const folder = await window.api.syncSelectFolder()
    if (folder) saveConfig({ ...config, syncPath: folder })
  }

  const syncNow = async () => {
    setSyncing(true)
    setStatus(null)
    const result = await window.api.syncNow(currentPrefs)
    setSyncing(false)
    setStatus({ message: result.message, ok: result.success })
    if (result.success && result.importedNewData && result.preferences) {
      onSyncImport(result.preferences)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 w-[480px] shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2">
            <Wifi size={15} className="text-accent" />
            <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">LAN Sync</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Enable sync</div>
              <div className="text-xs text-zinc-500 mt-0.5">Sync data across machines on your local network</div>
            </div>
            <button
              role="switch"
              aria-checked={config.enabled}
              onClick={() => saveConfig({ ...config, enabled: !config.enabled })}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                config.enabled ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-600'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                config.enabled ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          {/* Sync path */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
              Shared folder path
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={config.syncPath}
                onChange={e => setConfig({ ...config, syncPath: e.target.value })}
                onBlur={() => saveConfig(config)}
                placeholder={String.raw`\\PC-NAME\SharedFolder  or  Z:\SyncFolder`}
                className="flex-1 px-3 py-1.5 text-sm bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={browse}
                className="px-3 py-1.5 text-sm bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors flex items-center gap-1.5 shrink-0"
              >
                <FolderOpen size={14} />
                Browse
              </button>
            </div>
            <p className="mt-1.5 text-xs text-zinc-500">
              Both machines must point to the same folder — a mapped drive or UNC path works.
            </p>
          </div>

          {/* Auto-sync toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Auto-sync</div>
              <div className="text-xs text-zinc-500 mt-0.5">Import newer data on startup · export on close</div>
            </div>
            <button
              role="switch"
              aria-checked={config.autoSync}
              onClick={() => saveConfig({ ...config, autoSync: !config.autoSync })}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                config.autoSync ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-600'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                config.autoSync ? 'translate-x-4' : 'translate-x-0.5'
              }`} />
            </button>
          </div>

          {/* Last synced */}
          {config.lastSyncedAt && (
            <p className="text-xs text-zinc-400">
              Last synced: {new Date(config.lastSyncedAt).toLocaleString()}
            </p>
          )}

          {/* Status message */}
          {status && (
            <div className={`flex items-center gap-2 p-3 rounded-md text-sm ${
              status.ok
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
            }`}>
              {status.ok ? <Check size={14} className="shrink-0" /> : <AlertCircle size={14} className="shrink-0" />}
              <span>{status.message}</span>
            </div>
          )}

          {/* Sync Now */}
          <button
            onClick={syncNow}
            disabled={!config.enabled || !config.syncPath || syncing}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-accent text-white rounded-md text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>
    </div>
  )
}
