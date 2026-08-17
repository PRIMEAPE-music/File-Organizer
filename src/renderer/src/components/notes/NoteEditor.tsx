import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Trash2, Tag, FolderOpen } from 'lucide-react'
import type { NoteWithMeta, NoteCategory, NoteTag } from '../../../../shared/types'
import NoteToolbar from './NoteToolbar'

interface Props {
  note: NoteWithMeta | null
  categories: NoteCategory[]
  tags: NoteTag[]
  onUpdateNote: (id: number, title: string, content: string) => Promise<unknown>
  onDeleteNote: (id: number) => void
  onSetCategory: (noteId: number, categoryId: number | null) => void
  onAddTag: (noteId: number, tagId: number) => void
  onRemoveTag: (noteId: number, tagId: number) => void
}

export default function NoteEditor({
  note, categories, tags,
  onUpdateNote, onDeleteNote,
  onSetCategory, onAddTag, onRemoveTag
}: Props) {
  const [title, setTitle] = useState('')
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle')
  const [showCategoryMenu, setShowCategoryMenu] = useState(false)
  const [showTagMenu, setShowTagMenu] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const noteIdRef = useRef<number | null>(null)
  const titleRef = useRef('')

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder: 'Start writing...' })
    ],
    content: '',
    onUpdate: () => {
      scheduleSave()
    }
  })

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }
    if (noteIdRef.current && editor) {
      setSaveStatus('saving')
      onUpdateNote(noteIdRef.current, titleRef.current, editor.getHTML()).then(() => {
        setSaveStatus('saved')
      })
    }
  }, [editor, onUpdateNote])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveStatus('idle')
    saveTimerRef.current = setTimeout(flushSave, 800)
  }, [flushSave])

  // Sync note changes
  useEffect(() => {
    // Flush any pending save from previous note
    if (noteIdRef.current && noteIdRef.current !== note?.id) {
      flushSave()
    }

    noteIdRef.current = note?.id ?? null

    if (note) {
      setTitle(note.title)
      titleRef.current = note.title
      if (editor && editor.getHTML() !== note.content) {
        editor.commands.setContent(note.content || '')
      }
      setSaveStatus('saved')
    } else {
      setTitle('')
      titleRef.current = ''
      editor?.commands.setContent('')
      setSaveStatus('idle')
    }
  }, [note?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle)
    titleRef.current = newTitle
    scheduleSave()
  }

  if (!note) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-400">
        <div className="text-center">
          <p className="text-lg mb-1">No note selected</p>
          <p className="text-sm">Select a note or create a new one</p>
        </div>
      </div>
    )
  }

  const noteTagIds = new Set(note.tags.map(t => t.id))

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-white dark:bg-zinc-900">
      {/* Title + meta bar */}
      <div className="px-4 pt-3 pb-2 border-b border-zinc-200 dark:border-zinc-700">
        <input
          type="text"
          value={title}
          onChange={e => handleTitleChange(e.target.value)}
          placeholder="Note title"
          className="w-full text-lg font-semibold bg-transparent border-none outline-none text-zinc-800 dark:text-zinc-100 placeholder:text-zinc-400"
        />
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {/* Category */}
          <div className="relative">
            <button
              onClick={() => { setShowCategoryMenu(!showCategoryMenu); setShowTagMenu(false) }}
              className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-md border border-zinc-300 dark:border-zinc-600 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <FolderOpen className="w-3 h-3" />
              {note.category ? note.category.name : 'Category'}
            </button>
            {showCategoryMenu && (
              <div className="absolute top-full left-0 mt-1 w-40 bg-white dark:bg-zinc-800 rounded-md shadow-lg border border-zinc-200 dark:border-zinc-700 z-20 py-1">
                <button
                  onClick={() => { onSetCategory(note.id, null); setShowCategoryMenu(false) }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-500"
                >
                  None
                </button>
                {categories.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => { onSetCategory(note.id, cat.id); setShowCategoryMenu(false) }}
                    className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700"
                  >
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tags */}
          <div className="relative">
            <button
              onClick={() => { setShowTagMenu(!showTagMenu); setShowCategoryMenu(false) }}
              className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-md border border-zinc-300 dark:border-zinc-600 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Tag className="w-3 h-3" />
              Tags
            </button>
            {showTagMenu && (
              <div className="absolute top-full left-0 mt-1 w-40 bg-white dark:bg-zinc-800 rounded-md shadow-lg border border-zinc-200 dark:border-zinc-700 z-20 py-1 max-h-48 overflow-y-auto">
                {tags.map(tag => (
                  <button
                    key={tag.id}
                    onClick={() => {
                      if (noteTagIds.has(tag.id)) {
                        onRemoveTag(note.id, tag.id)
                      } else {
                        onAddTag(note.id, tag.id)
                      }
                    }}
                    className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700"
                  >
                    <span className={`w-3 h-3 rounded border ${noteTagIds.has(tag.id) ? 'bg-accent border-accent' : 'border-zinc-300 dark:border-zinc-600'}`} />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                    {tag.name}
                  </button>
                ))}
                {tags.length === 0 && (
                  <p className="px-3 py-2 text-xs text-zinc-400">No tags created</p>
                )}
              </div>
            )}
          </div>

          {/* Tag pills */}
          {note.tags.map(tag => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
              style={{ backgroundColor: tag.color + '25', color: tag.color }}
            >
              {tag.name}
            </span>
          ))}

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-zinc-400">
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : ''}
            </span>
            <button
              onClick={() => onDeleteNote(note.id)}
              className="p-1 rounded text-zinc-400 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              title="Delete note"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <NoteToolbar editor={editor} />

      {/* Editor */}
      <div className="flex-1 overflow-y-auto cursor-text" onClick={() => editor?.chain().focus().run()}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
