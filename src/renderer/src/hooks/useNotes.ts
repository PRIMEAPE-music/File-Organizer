import { useState, useEffect, useCallback } from 'react'
import type { NoteWithMeta, NoteFilterState } from '../../../shared/types'

export function useNotes(filter: NoteFilterState) {
  const [notes, setNotes] = useState<NoteWithMeta[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.getNotes(filter)
      setNotes(result)
    } catch (err) {
      console.error('Failed to fetch notes:', err)
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

  const createNote = useCallback(async (title: string, content: string) => {
    const note = await window.api.createNote(title, content)
    await refresh()
    return note
  }, [refresh])

  const updateNote = useCallback(async (id: number, title: string, content: string) => {
    const note = await window.api.updateNote(id, title, content)
    await refresh()
    return note
  }, [refresh])

  const deleteNote = useCallback(async (id: number) => {
    await window.api.deleteNote(id)
    await refresh()
  }, [refresh])

  const setNoteCategory = useCallback(async (noteId: number, categoryId: number | null) => {
    await window.api.setNoteCategory(noteId, categoryId)
    await refresh()
  }, [refresh])

  const addNoteTag = useCallback(async (noteId: number, tagId: number) => {
    await window.api.addNoteTag(noteId, tagId)
    await refresh()
  }, [refresh])

  const removeNoteTag = useCallback(async (noteId: number, tagId: number) => {
    await window.api.removeNoteTag(noteId, tagId)
    await refresh()
  }, [refresh])

  return { notes, loading, refresh, createNote, updateNote, deleteNote, setNoteCategory, addNoteTag, removeNoteTag }
}
