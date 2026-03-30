import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '../../../shared/types'

export function useTags() {
  const [tags, setTags] = useState<Tag[]>([])

  const refresh = useCallback(async () => {
    const result = await window.api.getTags()
    setTags(result)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createTag = useCallback(async (name: string, color: string) => {
    const tag = await window.api.createTag(name, color)
    await refresh()
    return tag
  }, [refresh])

  const updateTag = useCallback(async (id: number, name: string, color: string) => {
    const tag = await window.api.updateTag(id, name, color)
    await refresh()
    return tag
  }, [refresh])

  const deleteTag = useCallback(async (id: number) => {
    await window.api.deleteTag(id)
    await refresh()
  }, [refresh])

  return { tags, createTag, updateTag, deleteTag, refresh }
}
