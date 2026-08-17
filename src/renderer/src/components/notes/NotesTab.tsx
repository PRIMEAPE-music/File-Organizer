import { useState, useCallback } from 'react'
import type { NoteFilterState, NoteSidebarView, NoteSortField, NoteWithMeta } from '../../../../shared/types'
import { useNotes } from '../../hooks/useNotes'
import { useNoteCategories } from '../../hooks/useNoteCategories'
import { useNoteTags } from '../../hooks/useNoteTags'
import { useInFlight } from '../../hooks/useInFlight'
import NoteSidebar from './NoteSidebar'
import NoteList from './NoteList'
import NoteEditor from './NoteEditor'
import CategoryDialog from '../CategoryDialog'
import TagDialog from '../TagDialog'

interface NotesTabProps {
  sidebarCollapsed?: boolean
}

export default function NotesTab({ sidebarCollapsed = false }: NotesTabProps) {
  const [filter, setFilter] = useState<NoteFilterState>({
    search: '',
    sortField: 'updated_at',
    sortDirection: 'desc',
    sidebarView: { type: 'all' }
  })

  const [selectedNote, setSelectedNote] = useState<NoteWithMeta | null>(null)
  const { notes, createNote, updateNote, deleteNote, setNoteCategory, addNoteTag, removeNoteTag, refresh } = useNotes(filter)
  const { categories, createCategory, updateCategory, deleteCategory } = useNoteCategories()
  const { tags, createTag, updateTag, deleteTag } = useNoteTags()

  const [categoryDialog, setCategoryDialog] = useState<{ mode: 'create' } | { mode: 'edit'; id: number; name: string; color: string } | null>(null)
  const [tagDialog, setTagDialog] = useState<{ mode: 'create' } | { mode: 'edit'; id: number; name: string; color: string } | null>(null)

  const setSidebarView = useCallback((view: NoteSidebarView) => {
    setFilter(f => ({ ...f, sidebarView: view }))
  }, [])

  // Guarded: this used to fire the create IPC straight out of the click with no
  // in-flight state, so a double-click on "New" made two notes.
  const { inFlight: creatingNote, run: runCreateNote } = useInFlight('create note')

  const handleCreateNote = useCallback(() => {
    runCreateNote(async () => {
      const note = await createNote('Untitled', '')
      setSelectedNote(note)
    })
  }, [createNote, runCreateNote])

  const handleSelectNote = useCallback((note: NoteWithMeta) => {
    setSelectedNote(note)
  }, [])

  const handleUpdateNote = useCallback(async (id: number, title: string, content: string) => {
    const updated = await updateNote(id, title, content)
    setSelectedNote(prev => prev?.id === id ? updated : prev)
  }, [updateNote])

  const handleDeleteNote = useCallback(async (id: number) => {
    await deleteNote(id)
    setSelectedNote(null)
  }, [deleteNote])

  const handleSetCategory = useCallback(async (noteId: number, categoryId: number | null) => {
    await setNoteCategory(noteId, categoryId)
    const updated = await window.api.getNote(noteId)
    if (updated) setSelectedNote(updated)
  }, [setNoteCategory])

  const handleAddTag = useCallback(async (noteId: number, tagId: number) => {
    await addNoteTag(noteId, tagId)
    const updated = await window.api.getNote(noteId)
    if (updated) setSelectedNote(updated)
  }, [addNoteTag])

  const handleRemoveTag = useCallback(async (noteId: number, tagId: number) => {
    await removeNoteTag(noteId, tagId)
    const updated = await window.api.getNote(noteId)
    if (updated) setSelectedNote(updated)
  }, [removeNoteTag])

  const sortFields: NoteSortField[] = ['updated_at', 'title', 'created_at']
  const cycleSortField = useCallback(() => {
    setFilter(f => {
      const idx = sortFields.indexOf(f.sortField)
      return { ...f, sortField: sortFields[(idx + 1) % sortFields.length] }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-1 overflow-hidden">
      {!sidebarCollapsed && <NoteSidebar
        sidebarView={filter.sidebarView}
        onSetView={setSidebarView}
        categories={categories}
        tags={tags}
        onCreateCategory={() => setCategoryDialog({ mode: 'create' })}
        onEditCategory={(cat) => setCategoryDialog({ mode: 'edit', id: cat.id, name: cat.name, color: cat.color })}
        onDeleteCategory={deleteCategory}
        onCreateTag={() => setTagDialog({ mode: 'create' })}
        onEditTag={(tag) => setTagDialog({ mode: 'edit', id: tag.id, name: tag.name, color: tag.color })}
        onDeleteTag={deleteTag}
      />}

      <NoteList
        notes={notes}
        selectedNoteId={selectedNote?.id ?? null}
        onSelect={handleSelectNote}
        onCreateNote={handleCreateNote}
        creatingNote={creatingNote}
        search={filter.search}
        onSearchChange={(search) => setFilter(f => ({ ...f, search }))}
        sortField={filter.sortField}
        onCycleSortField={cycleSortField}
      />

      <NoteEditor
        note={selectedNote}
        categories={categories}
        tags={tags}
        onUpdateNote={handleUpdateNote}
        onDeleteNote={handleDeleteNote}
        onSetCategory={handleSetCategory}
        onAddTag={handleAddTag}
        onRemoveTag={handleRemoveTag}
      />

      {categoryDialog && (
        <CategoryDialog
          mode={categoryDialog.mode}
          initial={categoryDialog.mode === 'edit' ? categoryDialog : undefined}
          onSave={async (name, color) => {
            if (categoryDialog.mode === 'create') {
              await createCategory(name, color)
            } else {
              await updateCategory(categoryDialog.id, name, color)
            }
            setCategoryDialog(null)
            refresh()
          }}
          onClose={() => setCategoryDialog(null)}
        />
      )}

      {tagDialog && (
        <TagDialog
          mode={tagDialog.mode}
          initial={tagDialog.mode === 'edit' ? tagDialog : undefined}
          onSave={async (name, color) => {
            if (tagDialog.mode === 'create') {
              await createTag(name, color)
            } else {
              await updateTag(tagDialog.id, name, color)
            }
            setTagDialog(null)
            refresh()
          }}
          onClose={() => setTagDialog(null)}
        />
      )}
    </div>
  )
}
