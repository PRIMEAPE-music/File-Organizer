import { useState, useEffect, useCallback } from 'react'
import type { NoteCategory } from '../../../shared/types'

export function useNoteCategories() {
  const [categories, setCategories] = useState<NoteCategory[]>([])

  const refresh = useCallback(async () => {
    const result = await window.api.getNoteCategories()
    setCategories(result)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createCategory = useCallback(async (name: string, color: string) => {
    const cat = await window.api.createNoteCategory(name, color)
    await refresh()
    return cat
  }, [refresh])

  const updateCategory = useCallback(async (id: number, name: string, color: string) => {
    const cat = await window.api.updateNoteCategory(id, name, color)
    await refresh()
    return cat
  }, [refresh])

  const deleteCategory = useCallback(async (id: number) => {
    await window.api.deleteNoteCategory(id)
    await refresh()
  }, [refresh])

  return { categories, createCategory, updateCategory, deleteCategory, refresh }
}
