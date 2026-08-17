import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One-at-a-time guard for a control that starts an async write.
 *
 * WHAT THIS EXISTS FOR: the "New" button in the notes list called its create IPC
 * straight out of onClick with nothing stopping a second click, and a double-click
 * really did create two notes. Every other create control in the app had the same
 * shape — the modal dialogs stay mounted until the parent's async save resolves and
 * closes them, so their Create button was double-clickable too.
 *
 * WHY A REF AND NOT JUST STATE: `disabled` driven by state alone is a race. The two
 * clicks of a double-click are two separate events, and the button only actually
 * becomes disabled once React has re-rendered from the state change. `busy` flips
 * synchronously inside the first handler, so the second click is rejected whatever
 * React has or has not painted. The state is there to disable and grey the control
 * for the user; the ref is what makes it correct.
 *
 * The flag is released in a `finally`, always: a create that fails must leave the
 * control usable, not permanently dead.
 */
export function useInFlight(label = 'complete that action'): {
  inFlight: boolean
  run: (action: () => void | Promise<void>) => void
} {
  const [inFlight, setInFlight] = useState(false)
  const busy = useRef(false)

  // Callers routinely close their dialog when the action resolves, so this
  // component is often already gone by the time the flag is released.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback(
    (action: () => void | Promise<void>): void => {
      if (busy.current) return
      busy.current = true
      setInFlight(true)
      void (async () => {
        try {
          await action()
        } catch (err) {
          // Logged rather than rethrown: a rejection escaping an event handler is
          // an unhandled rejection, invisible to the user and to us.
          console.error(`Failed to ${label}:`, err)
        } finally {
          busy.current = false
          if (mounted.current) setInFlight(false)
        }
      })()
    },
    [label]
  )

  return { inFlight, run }
}
