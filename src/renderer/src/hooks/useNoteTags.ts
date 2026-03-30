import { useState, useEffect, useCallback } from 'react'
import type { NoteTag } from '../../../shared/types'

export function useNoteTags() {
  const [tags, setTags] = useState<NoteTag[]>([])

  const refresh = useCallback(async () => {
    const result = await window.api.getNoteTags()
    setTags(result)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createTag = useCallback(async (name: string, color: string) => {
    const tag = await window.api.createNoteTag(name, color)
    await refresh()
    return tag
  }, [refresh])

  const updateTag = useCallback(async (id: number, name: string, color: string) => {
    const tag = await window.api.updateNoteTag(id, name, color)
    await refresh()
    return tag
  }, [refresh])

  const deleteTag = useCallback(async (id: number) => {
    await window.api.deleteNoteTag(id)
    await refresh()
  }, [refresh])

  return { tags, createTag, updateTag, deleteTag, refresh }
}
