import { useCallback, useEffect, useRef, useState } from 'react'
import { AlarmClock, Bell, Check, ChevronDown, Clock } from 'lucide-react'
import type { ReminderAlertPayload, ReminderSnoozeChoice } from '../../../shared/types'

/**
 * The tier-2 (popup) and tier-3 (blackout) alert surface.
 *
 * Rendered instead of the main app when the window's hash says so, so there is
 * only ever one renderer build entry. Everything it shows arrives over IPC —
 * nothing is re-derived here, because the main process is the only thing that
 * knows what is actually owed.
 */

const SNOOZE_OPTIONS: { value: ReminderSnoozeChoice; label: string }[] = [
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 'tomorrow', label: 'Tomorrow at 9am' }
]

function formatWhen(iso: string): string {
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

/**
 * The opaque cover shown on non-primary displays at tier 3. No IPC, no state — the
 * controls live on the primary display's window.
 */
export function AlertDimWindow() {
  return <div className="fixed inset-0 bg-black" />
}

export default function AlertWindow() {
  const [payload, setPayload] = useState<ReminderAlertPayload | null>(null)
  const [snoozeOpen, setSnoozeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    window.api.reminderAlertGet().then(setPayload)
    return window.api.onReminderAlertChanged(setPayload)
  }, [])

  // Sound lives in the renderer because the main process cannot play audio. The
  // source is a base64 data URI handed over IPC rather than a file:// path, which
  // the renderer's CSP would refuse.
  useEffect(() => {
    const uri = payload?.sound_data_uri ?? null
    const shouldLoop = payload?.loop_sound ?? false

    if (!uri) {
      audioRef.current?.pause()
      audioRef.current = null
      return
    }

    // Same clip already playing (a queue-count refresh, say): leave it alone
    // rather than restarting it from the top.
    if (audioRef.current && audioRef.current.src === uri) {
      audioRef.current.loop = shouldLoop
      return
    }

    audioRef.current?.pause()
    const audio = new Audio(uri)
    audio.loop = shouldLoop
    audioRef.current = audio
    // Autoplay can still be refused; a silent alert is degraded, not broken —
    // the window itself is the delivery guarantee.
    audio.play().catch((err) => console.warn('[alert] could not play sound:', err))

    return () => {
      audio.pause()
    }
  }, [payload?.sound_data_uri, payload?.loop_sound])

  const stopSound = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
  }, [])

  /**
   * `busy` disables every control in this window, and this window is
   * `closable: false` and always on top — so a rejected IPC call that left `busy`
   * stuck at true would be a trap with no way out but killing the app. The reset
   * belongs in a `finally`: on success the main process destroys the window a moment
   * later and the state no longer matters, and on failure the controls come back.
   */
  const done = useCallback(async () => {
    if (busy) return
    setBusy(true)
    stopSound()
    try {
      await window.api.reminderAlertAck(payload?.occurrence_id ?? null)
    } catch (err) {
      console.error('[alert] could not acknowledge:', err)
    } finally {
      setBusy(false)
    }
  }, [busy, payload?.occurrence_id, stopSound])

  const snooze = useCallback(
    async (choice: ReminderSnoozeChoice) => {
      if (busy) return
      setBusy(true)
      setSnoozeOpen(false)
      stopSound()
      try {
        await window.api.reminderAlertSnooze(payload?.occurrence_id ?? null, choice)
      } catch (err) {
        console.error('[alert] could not snooze:', err)
      } finally {
        setBusy(false)
      }
    },
    [busy, payload?.occurrence_id, stopSound]
  )

  if (!payload) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-zinc-900 text-zinc-400 text-sm">
        Loading reminder…
      </div>
    )
  }

  const blackout = payload.tier === 'blackout'
  const isDigest = payload.kind === 'digest'

  return (
    <div
      className={`h-screen w-screen flex flex-col select-none ${
        blackout ? 'bg-black text-zinc-100 items-center justify-center' : 'bg-zinc-900 text-zinc-100'
      }`}
    >
      {/*
        Both tiers are flex columns with a scrolling body and pinned controls.
        The blackout branch used to be a plain block, which made the body's
        `flex-1 overflow-auto` inert: long text pushed the Done button off the
        bottom of the screen (measured: gone at ~39 lines) and scrolled the title
        away with it. `max-h-full` keeps the card inside the viewport while the
        parent's justify-center still centres it when it is short.
      */}
      <div
        className={
          blackout
            ? 'w-[520px] max-w-[90vw] max-h-full flex flex-col overflow-hidden'
            : 'flex flex-col h-full'
        }
      >
        {/* Header — the only draggable strip, so a popup can be moved aside. */}
        <div
          className={`flex items-center gap-2 px-4 py-3 shrink-0 ${
            blackout ? 'justify-center' : 'border-b border-zinc-700 drag-region'
          }`}
        >
          {blackout ? (
            <AlarmClock className="w-6 h-6 text-amber-400" />
          ) : (
            <Bell className="w-4 h-4 text-amber-400" />
          )}
          <span className={`font-semibold ${blackout ? 'text-lg' : 'text-sm'}`}>
            {isDigest ? 'Missed reminders' : 'Reminder'}
          </span>
          {payload.late && !isDigest && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
              missed
            </span>
          )}
          {payload.queued_count > 0 && (
            <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-300 no-drag">
              {payload.queued_count} more waiting
            </span>
          )}
        </div>

        {/* Body. `min-h-0` is what actually lets a flex child scroll instead of
            growing past its container. */}
        <div className={`flex-1 min-h-0 overflow-auto px-4 py-4 ${blackout ? 'text-center' : ''}`}>
          <div className={`font-semibold ${blackout ? 'text-2xl' : 'text-base'}`}>
            {payload.title}
          </div>

          {!isDigest && (
            <div
              className={`text-xs text-zinc-400 mt-1 flex items-center gap-1 ${
                blackout ? 'justify-center' : ''
              }`}
            >
              <Clock className="w-3 h-3" />
              {formatWhen(payload.fire_at)}
            </div>
          )}

          {payload.body && (
            <p className="text-sm text-zinc-300 mt-3 whitespace-pre-wrap">{payload.body}</p>
          )}

          {isDigest && payload.items.length > 0 && (
            <ul className="mt-4 space-y-1 text-left max-h-[40vh] overflow-auto">
              {payload.items.map((item, i) => (
                <li
                  key={`${item.fire_at}-${i}`}
                  className="text-sm flex items-baseline justify-between gap-3 border-b border-zinc-800 pb-1"
                >
                  <span className="truncate">{item.title}</span>
                  <span className="text-xs text-zinc-500 shrink-0">{formatWhen(item.fire_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Controls — the ONLY way out of this window, so they are pinned and
            never allowed to shrink or scroll away. */}
        <div
          className={`flex items-center gap-2 px-4 py-3 shrink-0 ${
            blackout ? 'justify-center' : 'border-t border-zinc-700'
          }`}
        >
          <button
            onClick={done}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            <Check className="w-4 h-4" />
            Done
          </button>

          {!isDigest && (
            <>
              <button
                onClick={() => snooze(10)}
                disabled={busy}
                className="px-3 py-2 text-sm rounded-md bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 transition-colors"
              >
                Snooze 10m
              </button>
              <button
                onClick={() => snooze(60)}
                disabled={busy}
                className="px-3 py-2 text-sm rounded-md bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 transition-colors"
              >
                Snooze 1h
              </button>

              <div className="relative ml-auto">
                <button
                  onClick={() => setSnoozeOpen((v) => !v)}
                  disabled={busy}
                  className="flex items-center gap-1 px-2 py-2 text-sm rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                  title="More snooze options"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
                {snoozeOpen && (
                  <div className="absolute right-0 bottom-full mb-1 w-44 rounded-md border border-zinc-700 bg-zinc-800 shadow-xl overflow-hidden z-10">
                    {SNOOZE_OPTIONS.map((opt) => (
                      <button
                        key={String(opt.value)}
                        onClick={() => snooze(opt.value)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-700 transition-colors"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
