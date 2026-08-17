import { useCallback, useEffect, useState } from 'react'
import type { ReminderInput, ReminderSnoozeChoice, ReminderWithMeta } from '../../../shared/types'

/**
 * Mirrors useTasks, with one addition: the main process pushes
 * `event:reminders-changed` whenever the scheduler fires, escalates or snoozes
 * something, so the list stays honest without polling.
 */
export function useReminders() {
  const [reminders, setReminders] = useState<ReminderWithMeta[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setReminders(await window.api.getReminders())
    } catch (err) {
      console.error('Failed to fetch reminders:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    return window.api.onRemindersChanged(() => {
      refresh()
    })
  }, [refresh])

  const createReminder = useCallback(
    async (input: ReminderInput) => {
      const created = await window.api.createReminder(input)
      await refresh()
      return created
    },
    [refresh]
  )

  const updateReminder = useCallback(
    async (id: number, input: ReminderInput) => {
      const updated = await window.api.updateReminder(id, input)
      await refresh()
      return updated
    },
    [refresh]
  )

  const deleteReminder = useCallback(
    async (id: number) => {
      await window.api.deleteReminder(id)
      await refresh()
    },
    [refresh]
  )

  const setEnabled = useCallback(
    async (id: number, enabled: boolean) => {
      await window.api.setReminderEnabled(id, enabled)
      await refresh()
    },
    [refresh]
  )

  /**
   * Hand a reminder that a timing edit detached back to its task. Returns the
   * outcome so the caller can surface a refusal (or a "reset, but now switched
   * off") rather than appearing to do nothing.
   */
  const resetToAutomatic = useCallback(
    async (id: number) => {
      const result = await window.api.resetReminderToAuto(id)
      await refresh()
      return result
    },
    [refresh]
  )

  const snoozeOccurrence = useCallback(
    async (occurrenceId: number, choice: ReminderSnoozeChoice) => {
      await window.api.snoozeOccurrence(occurrenceId, choice)
      await refresh()
    },
    [refresh]
  )

  const dismissOccurrence = useCallback(
    async (occurrenceId: number) => {
      await window.api.dismissOccurrence(occurrenceId)
      await refresh()
    },
    [refresh]
  )

  const testFire = useCallback(async (id: number) => {
    await window.api.testFireReminder(id)
  }, [])

  return {
    reminders,
    loading,
    refresh,
    createReminder,
    updateReminder,
    deleteReminder,
    setEnabled,
    resetToAutomatic,
    snoozeOccurrence,
    dismissOccurrence,
    testFire
  }
}
