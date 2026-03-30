import { Search, Plus, X } from 'lucide-react'
import type { NoteWithMeta, NoteSortField } from '../../../../shared/types'
import { formatDistanceToNow } from 'date-fns'

interface Props {
  notes: NoteWithMeta[]
  selectedNoteId: number | null
  onSelect: (note: NoteWithMeta) => void
  onCreateNote: () => void
  search: string
  onSearchChange: (s: string) => void
  sortField: NoteSortField
  onCycleSortField: () => void
}

function stripHtml(html: string): string {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent?.slice(0, 120) || ''
}

export default function NoteList({
  notes, selectedNoteId, onSelect, onCreateNote,
  search, onSearchChange, sortField, onCycleSortField
}: Props) {
  const sortLabel: Record<NoteSortField, string> = {
    title: 'Title',
    updated_at: 'Date',
    created_at: 'Created'
  }

  return (
    <div className="w-72 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-zinc-200 dark:border-zinc-700 space-y-2">
        <div className="flex items-center justify-between">
          <button onClick={onCycleSortField} className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 px-1 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
            Sort: {sortLabel[sortField]}
          </button>
          <button
            onClick={onCreateNote}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            type="text"
            placeholder="Search notes..."
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 text-sm rounded-md border border-zinc-300 dark:border-zinc-600
              bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-accent/50 placeholder:text-zinc-400"
          />
          {search && (
            <button onClick={() => onSearchChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {notes.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-zinc-400 text-sm">
            No notes yet
          </div>
        ) : (
          notes.map(note => (
            <button
              key={note.id}
              onClick={() => onSelect(note)}
              className={`w-full text-left px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800 transition-colors
                ${selectedNoteId === note.id
                  ? 'bg-accent/10 border-l-2 border-l-accent'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}
            >
              <div className="text-sm font-medium truncate text-zinc-800 dark:text-zinc-200">
                {note.title || 'Untitled'}
              </div>
              <div className="text-xs text-zinc-400 truncate mt-0.5">
                {stripHtml(note.content) || 'Empty note'}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-zinc-400">
                  {formatDistanceToNow(new Date(note.updated_at + 'Z'), { addSuffix: true })}
                </span>
                {note.category && (
                  <span className="inline-flex items-center gap-1 text-[10px]">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: note.category.color }} />
                    {note.category.name}
                  </span>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
