import { Star, ArrowUp, ArrowDown } from 'lucide-react'
import { useState, useCallback, useRef } from 'react'
import type { FileWithMeta, SortField, SortDirection } from '../../../shared/types'
import FileIcon from './FileIcon'
import { formatFileSize, formatDate } from '../lib/format'

interface Props {
  files: FileWithMeta[]
  selectedFile: FileWithMeta | null
  selectedFileIds: Set<number>
  onSelect: (file: FileWithMeta, e: React.MouseEvent) => void
  onOpen: (file: FileWithMeta) => void
  onContextMenu: (e: React.MouseEvent, fileId: number) => void
  onToggleFavorite: (fileId: number) => void
  sortField: SortField
  sortDirection: SortDirection
  onSetSort: (field: SortField, dir: SortDirection) => void
}

interface ColumnDef {
  key: SortField | '_star' | '_icon' | '_tags'
  label: string
  sortable: boolean
  defaultWidth: number
  minWidth: number
  align?: 'right'
}

const COLUMNS: ColumnDef[] = [
  { key: '_star',      label: '',         sortable: false, defaultWidth: 32,  minWidth: 32 },
  { key: '_icon',      label: '',         sortable: false, defaultWidth: 28,  minWidth: 28 },
  { key: 'name',       label: 'Name',     sortable: true,  defaultWidth: 280, minWidth: 120 },
  { key: 'folder',     label: 'Folder',   sortable: true,  defaultWidth: 150, minWidth: 80 },
  { key: 'size',       label: 'Size',     sortable: true,  defaultWidth: 80,  minWidth: 60, align: 'right' },
  { key: 'modified_at',label: 'Modified', sortable: true,  defaultWidth: 160, minWidth: 100 },
  { key: 'extension',  label: 'Type',     sortable: true,  defaultWidth: 64,  minWidth: 48 },
  { key: '_tags',      label: 'Category', sortable: false, defaultWidth: 120, minWidth: 60 },
]

function getParentFolder(filePath: string): string {
  const sep = filePath.includes('\\') ? '\\' : '/'
  const parts = filePath.split(sep)
  return parts.length >= 2 ? parts[parts.length - 2] : ''
}

function getStoredWidths(): Record<string, number> | null {
  try {
    const stored = localStorage.getItem('fileListColumnWidths')
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

function saveWidths(widths: Record<string, number>): void {
  localStorage.setItem('fileListColumnWidths', JSON.stringify(widths))
}

export default function FileList({
  files, selectedFile, selectedFileIds, onSelect, onOpen, onContextMenu, onToggleFavorite,
  sortField, sortDirection, onSetSort
}: Props) {
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const stored = getStoredWidths()
    if (stored) return stored
    const defaults: Record<string, number> = {}
    for (const col of COLUMNS) {
      defaults[col.key] = col.defaultWidth
    }
    return defaults
  })

  const resizingRef = useRef<{
    key: string
    startX: number
    startWidth: number
  } | null>(null)

  const handleResizeStart = useCallback((e: React.MouseEvent, colKey: string) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = columnWidths[colKey] ?? 100

    resizingRef.current = { key: colKey, startX, startWidth }

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = ev.clientX - resizingRef.current.startX
      const col = COLUMNS.find(c => c.key === resizingRef.current!.key)
      const minW = col?.minWidth ?? 40
      const newWidth = Math.max(minW, resizingRef.current.startWidth + delta)
      setColumnWidths(prev => {
        const next = { ...prev, [resizingRef.current!.key]: newWidth }
        saveWidths(next)
        return next
      })
    }

    const onMouseUp = () => {
      resizingRef.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [columnWidths])

  const handleHeaderClick = useCallback((col: ColumnDef) => {
    if (!col.sortable) return
    const field = col.key as SortField
    if (sortField === field) {
      onSetSort(field, sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      onSetSort(field, 'asc')
    }
  }, [sortField, sortDirection, onSetSort])

  const renderSortIndicator = (col: ColumnDef) => {
    if (!col.sortable) return null
    const field = col.key as SortField
    if (sortField !== field) return null
    return sortDirection === 'asc'
      ? <ArrowUp className="w-3 h-3 inline-block ml-1 text-accent" />
      : <ArrowDown className="w-3 h-3 inline-block ml-1 text-accent" />
  }

  const getWidth = (col: ColumnDef) => columnWidths[col.key] ?? col.defaultWidth

  const renderCellContent = (col: ColumnDef, file: FileWithMeta) => {
    switch (col.key) {
      case '_star':
        return (
          <button
            onClick={e => { e.stopPropagation(); onToggleFavorite(file.id) }}
            className={`${file.is_favorite ? 'text-amber-500' : 'text-zinc-300 dark:text-zinc-600 hover:text-amber-400'}`}
          >
            <Star className="w-4 h-4" fill={file.is_favorite ? 'currentColor' : 'none'} />
          </button>
        )
      case '_icon':
        return <FileIcon extension={file.extension} size={18} />
      case 'name':
        return (
          <div className="min-w-0">
            <p className="text-sm truncate" title={file.name}>{file.name}</p>
            {file.tags.length > 0 && (
              <div className="flex gap-1 mt-0.5 overflow-hidden">
                {file.tags.map(tag => (
                  <span
                    key={tag.id}
                    className="px-1 py-0 rounded text-[10px] flex-shrink-0"
                    style={{ backgroundColor: tag.color + '25', color: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      case 'folder':
        return (
          <span className="text-xs text-zinc-500 truncate block" title={file.path}>
            {getParentFolder(file.path)}
          </span>
        )
      case 'size':
        return <span className="text-xs text-zinc-500">{formatFileSize(file.size)}</span>
      case 'modified_at':
        return <span className="text-xs text-zinc-500">{formatDate(file.modified_at)}</span>
      case 'extension':
        return <span className="text-xs text-zinc-500 uppercase">{file.extension.replace('.', '')}</span>
      case '_tags':
        return file.category ? (
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-medium truncate inline-block max-w-full"
            style={{ backgroundColor: file.category.color + '25', color: file.category.color }}
          >
            {file.category.name}
          </span>
        ) : null
      default:
        return null
    }
  }

  return (
    <div className="w-full overflow-x-auto">
      {/* Header */}
      <div className="flex items-center border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 sticky top-0 z-10">
        {COLUMNS.map((col, i) => (
          <div
            key={col.key}
            className="relative flex-shrink-0"
            style={{ width: getWidth(col) }}
          >
            <div
              onClick={() => handleHeaderClick(col)}
              className={`px-2 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-500 truncate
                ${col.sortable ? 'cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300' : ''}
                ${col.align === 'right' ? 'text-right' : 'text-left'}
                ${sortField === col.key ? 'text-accent' : ''}`}
            >
              {col.label}
              {renderSortIndicator(col)}
            </div>

            {/* Resize handle */}
            {i < COLUMNS.length - 1 && col.label && (
              <div
                onMouseDown={e => handleResizeStart(e, col.key)}
                className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-accent/30 active:bg-accent/50 z-20"
              />
            )}
          </div>
        ))}
      </div>

      {/* Rows */}
      {files.map(file => {
        const isSelected = selectedFileIds.has(file.id)
        return (
          <div
            key={file.id}
            draggable
            onDragStart={(e) => {
              const paths = isSelected && selectedFileIds.size > 1
                ? files.filter(f => selectedFileIds.has(f.id)).map(f => f.path)
                : [file.path]
              e.dataTransfer.effectAllowed = 'copy'
              e.dataTransfer.setData('text/plain', paths.join('\n'))
              window.api.startDrag(paths)
            }}
            onClick={(e) => onSelect(file, e)}
            onDoubleClick={() => onOpen(file)}
            onContextMenu={e => onContextMenu(e, file.id)}
            className={`flex items-center cursor-pointer border-b border-zinc-100 dark:border-zinc-800 transition-colors
              ${isSelected
                ? 'bg-accent/10'
                : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}
          >
            {COLUMNS.map(col => (
              <div
                key={col.key}
                className={`flex-shrink-0 px-2 py-2 truncate ${col.align === 'right' ? 'text-right' : ''}`}
                style={{ width: getWidth(col) }}
              >
                {renderCellContent(col, file)}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
