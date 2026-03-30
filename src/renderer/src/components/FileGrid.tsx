import { Star } from 'lucide-react'
import type { FileWithMeta } from '../../../shared/types'
import FileIcon from './FileIcon'
import { formatFileSize } from '../lib/format'

interface Props {
  files: FileWithMeta[]
  selectedFile: FileWithMeta | null
  selectedFileIds: Set<number>
  onSelect: (file: FileWithMeta, e: React.MouseEvent) => void
  onOpen: (file: FileWithMeta) => void
  onContextMenu: (e: React.MouseEvent, fileId: number) => void
  onToggleFavorite: (fileId: number) => void
}

export default function FileGrid({ files, selectedFileIds, onSelect, onOpen, onContextMenu, onToggleFavorite }: Props) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
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
            className={`group relative flex flex-col items-center p-4 rounded-lg border cursor-pointer transition-all
              ${isSelected
                ? 'border-accent bg-accent/5 shadow-sm'
                : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}
          >
            {/* Favorite button */}
            <button
              onClick={e => { e.stopPropagation(); onToggleFavorite(file.id) }}
              className={`absolute top-2 right-2 p-1 rounded transition-opacity
                ${file.is_favorite ? 'text-amber-500 opacity-100' : 'text-zinc-300 dark:text-zinc-600 opacity-0 group-hover:opacity-100'}`}
            >
              <Star className="w-4 h-4" fill={file.is_favorite ? 'currentColor' : 'none'} />
            </button>

            <FileIcon extension={file.extension} size={40} />
            <p className="mt-2 text-sm text-center font-medium truncate w-full" title={file.name}>
              {file.name}
            </p>
            <p className="text-xs text-zinc-400 mt-0.5">{formatFileSize(file.size)}</p>

            {/* Category/tags badges */}
            <div className="flex flex-wrap gap-1 mt-2 justify-center">
              {file.category && (
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                  style={{ backgroundColor: file.category.color + '25', color: file.category.color }}
                >
                  {file.category.name}
                </span>
              )}
              {file.tags.slice(0, 2).map(tag => (
                <span
                  key={tag.id}
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                  style={{ backgroundColor: tag.color + '25', color: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
              {file.tags.length > 2 && (
                <span className="px-1 py-0.5 text-[10px] text-zinc-400">
                  +{file.tags.length - 2}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
