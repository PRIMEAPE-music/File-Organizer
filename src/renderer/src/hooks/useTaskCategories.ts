import { useState, useEffect, useCallback } from 'react'
import type { TaskCategory } from '../../../shared/types'

export function useTaskCategories() {
  const [categories, setCategories] = useState<TaskCategory[]>([])

  const refresh = useCallback(async () => {
    const result = await window.api.getTaskCategories()
    setCategories(result)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createCategory = useCallback(async (name: string, color: string) => {
    const cat = await window.api.createTaskCategory(name, color)
    await refresh()
    return cat
  }, [refresh])

  const updateCategory = useCallback(async (id: number, name: string, color: string) => {
    const cat = await window.api.updateTaskCategory(id, name, color)
    await refresh()
    return cat
  }, [refresh])

  const deleteCategory = useCallback(async (id: number) => {
    await window.api.deleteTaskCategory(id)
    await refresh()
  }, [refresh])

  return { categories, createCategory, updateCategory, deleteCategory, refresh }
}
