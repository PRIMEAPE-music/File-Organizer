import { LayoutGrid, List, PanelRight, Filter } from 'lucide-react'
import type { ViewMode, SortField, SortDirection } from '../../../shared/types'

interface Props {
  viewMode: ViewMode
  onSetViewMode: (mode: ViewMode) => void
  extensions: string[]
  onSetExtensions: (ext: string[]) => void
  sortField: SortField
  sortDirection: SortDirection
  onSetSort: (field: SortField, dir: SortDirection) => void
  showPreview: boolean
  onTogglePreview: () => void
  fileCount: number
}

const EXT_OPTIONS = ['.xlsx', '.xls', '.docx', '.doc']

export default function TopBar({
  viewMode, onSetViewMode,
  extensions, onSetExtensions,
  sortField, sortDirection, onSetSort,
  showPreview, onTogglePreview,
  fileCount
}: Props) {
  const toggleExt = (ext: string) => {
    if (extensions.includes(ext)) {
      onSetExtensions(extensions.filter(e => e !== ext))
    } else {
      onSetExtensions([...extensions, ext])
    }
  }

  const cycleSortField = () => {
    const fields: SortField[] = ['name', 'modified_at', 'size', 'extension', 'folder']
    const idx = fields.indexOf(sortField)
    onSetSort(fields[(idx + 1) % fields.length], sortDirection)
  }

  const toggleSortDir = () => {
    onSetSort(sortField, sortDirection === 'asc' ? 'desc' : 'asc')
  }

  const sortLabel: Record<SortField, string> = {
    name: 'Name',
    modified_at: 'Date',
    size: 'Size',
    extension: 'Type',
    folder: 'Folder'
  }

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
      <div className="flex items-center gap-3">
        {/* Extension filters */}
        <div className="flex items-center gap-1">
          <Filter className="w-4 h-4 text-zinc-400 mr-1" />
          {EXT_OPTIONS.map(ext => (
            <button
              key={ext}
              onClick={() => toggleExt(ext)}
              className={`px-2 py-0.5 text-xs rounded-full border transition-colors
                ${extensions.includes(ext)
                  ? 'border-accent bg-accent/10 text-accent font-medium'
                  : 'border-zinc-300 dark:border-zinc-600 text-zinc-500 hover:border-zinc-400 dark:hover:border-zinc-500'}`}
            >
              {ext}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1 text-xs text-zinc-500">
          <button onClick={cycleSortField} className="px-2 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
            Sort: {sortLabel[sortField]}
          </button>
          <button onClick={toggleSortDir} className="px-1 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {sortDirection === 'asc' ? '\u2191' : '\u2193'}
          </button>
        </div>

        <span className="text-xs text-zinc-400">{fileCount} files</span>
      </div>

      <div className="flex items-center gap-1">
        {/* View toggle */}
        <button
          onClick={() => onSetViewMode('grid')}
          className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-accent/15 text-accent' : 'text-zinc-400 hover:text-zinc-600'}`}
          title="Grid view"
        >
          <LayoutGrid className="w-4 h-4" />
        </button>
        <button
          onClick={() => onSetViewMode('list')}
          className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-accent/15 text-accent' : 'text-zinc-400 hover:text-zinc-600'}`}
          title="List view"
        >
          <List className="w-4 h-4" />
        </button>

        <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-1" />

        {/* Preview toggle */}
        <button
          onClick={onTogglePreview}
          className={`p-1.5 rounded transition-colors ${showPreview ? 'bg-accent/15 text-accent' : 'text-zinc-400 hover:text-zinc-600'}`}
          title="Toggle preview panel"
        >
          <PanelRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
