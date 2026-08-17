import { useState, useEffect, useCallback } from 'react'
import type { PersistenceIssue } from '../../../shared/types'

/**
 * Collects data-persistence failures reported by the main process.
 *
 * Issues raised before the renderer existed (the startup sync auto-import runs
 * before the window is created) are queued in main and drained here on mount.
 * De-duplication is by `id`, so an issue that arrives both ways appears once.
 */
export function usePersistenceIssues(): {
  issues: PersistenceIssue[]
  dismiss: (id: number) => void
} {
  const [issues, setIssues] = useState<PersistenceIssue[]>([])

  const add = useCallback((incoming: PersistenceIssue[]) => {
    if (incoming.length === 0) return
    setIssues((prev) => {
      const seen = new Set(prev.map((i) => i.id))
      const fresh = incoming.filter((i) => !seen.has(i.id))
      return fresh.length > 0 ? [...prev, ...fresh] : prev
    })
  }, [])

  useEffect(() => {
    window.api.getPendingPersistenceIssues().then(add)
    return window.api.onPersistenceIssue((issue) => add([issue]))
  }, [add])

  const dismiss = useCallback((id: number) => {
    setIssues((prev) => prev.filter((i) => i.id !== id))
  }, [])

  return { issues, dismiss }
}
