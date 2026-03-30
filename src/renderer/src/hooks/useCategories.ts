import { useState, useEffect, useCallback } from 'react'
import type { Category } from '../../../shared/types'

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([])

  const refresh = useCallback(async () => {
    const result = await window.api.getCategories()
    setCategories(result)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createCategory = useCallback(async (name: string, color: string) => {
    const cat = await window.api.createCategory(name, color)
    await refresh()
    return cat
  }, [refresh])

  const updateCategory = useCallback(async (id: number, name: string, color: string) => {
    const cat = await window.api.updateCategory(id, name, color)
    await refresh()
    return cat
  }, [refresh])

  const deleteCategory = useCallback(async (id: number) => {
    await window.api.deleteCategory(id)
    await refresh()
  }, [refresh])

  return { categories, createCategory, updateCategory, deleteCategory, refresh }
}
