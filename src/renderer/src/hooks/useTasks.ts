import { useState, useEffect, useCallback } from 'react'
import type { TaskWithMeta, TaskFilterState, TaskStatus } from '../../../shared/types'

export function useTasks(filter: TaskFilterState) {
  const [tasks, setTasks] = useState<TaskWithMeta[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.getTasks(filter)
      setTasks(result)
    } catch (err) {
      console.error('Failed to fetch tasks:', err)
    } finally {
      setLoading(false)
    }
  }, [
    filter.search,
    filter.sortField,
    filter.sortDirection,
    JSON.stringify(filter.sidebarView)
  ])

  useEffect(() => {
    refresh()
  }, [refresh])

  const createTask = useCallback(async (data: { title: string; description?: string; status?: string; priority?: string; due_date?: string | null; category_id?: number | null }) => {
    const task = await window.api.createTask(data)
    await refresh()
    return task
  }, [refresh])

  const updateTask = useCallback(async (id: number, data: { title?: string; description?: string; status?: string; priority?: string; due_date?: string | null; category_id?: number | null }) => {
    const task = await window.api.updateTask(id, data)
    await refresh()
    return task
  }, [refresh])

  const deleteTask = useCallback(async (id: number) => {
    await window.api.deleteTask(id)
    await refresh()
  }, [refresh])

  const reorderTask = useCallback(async (id: number, status: TaskStatus, sortOrder: number) => {
    await window.api.reorderTask(id, status, sortOrder)
    await refresh()
  }, [refresh])

  const setTaskCategory = useCallback(async (taskId: number, categoryId: number | null) => {
    await window.api.setTaskCategory(taskId, categoryId)
    await refresh()
  }, [refresh])

  const addTaskTag = useCallback(async (taskId: number, tagId: number) => {
    await window.api.addTaskTag(taskId, tagId)
    await refresh()
  }, [refresh])

  const removeTaskTag = useCallback(async (taskId: number, tagId: number) => {
    await window.api.removeTaskTag(taskId, tagId)
    await refresh()
  }, [refresh])

  return { tasks, loading, refresh, createTask, updateTask, deleteTask, reorderTask, setTaskCategory, addTaskTag, removeTaskTag }
}
