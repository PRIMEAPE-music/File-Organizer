import { useState, useEffect, useCallback } from 'react'
import type { TaskTag } from '../../../shared/types'

export function useTaskTags() {
  const [tags, setTags] = useState<TaskTag[]>([])

  const refresh = useCallback(async () => {
    const result = await window.api.getTaskTags()
    setTags(result)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createTag = useCallback(async (name: string, color: string) => {
    const tag = await window.api.createTaskTag(name, color)
    await refresh()
    return tag
  }, [refresh])

  const updateTag = useCallback(async (id: number, name: string, color: string) => {
    const tag = await window.api.updateTaskTag(id, name, color)
    await refresh()
    return tag
  }, [refresh])

  const deleteTag = useCallback(async (id: number) => {
    await window.api.deleteTaskTag(id)
    await refresh()
  }, [refresh])

  return { tags, createTag, updateTag, deleteTag, refresh }
}
