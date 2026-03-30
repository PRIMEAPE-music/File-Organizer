import { ExternalLink, FolderOpen, Star, Tag, Folder } from 'lucide-react'
import type { Category, Tag as TagType, FileWithMeta } from '../../../shared/types'

interface Props {
  x: number
  y: number
  fileId: number
  selectedFileIds: Set<number>
  categories: Category[]
  tags: TagType[]
  files: FileWithMeta[]
  onClose: () => void
  onSetCategory: (fileId: number, categoryId: number | null) => void
  onAddTag: (fileId: number, tagId: number) => void
  onRemoveTag: (fileId: number, tagId: number) => void
  onToggleFavorite: (fileId: number) => void
  onOpenFile: (fileId: number) => void
  onOpenLocation: (fileId: number) => void
  onBulkToggleFavorite: (fileIds: Set<number>) => void
  onBulkSetCategory: (fileIds: Set<number>, categoryId: number | null) => void
  onBulkAddTag: (fileIds: Set<number>, tagId: number) => void
  onBulkRemoveTag: (fileIds: Set<number>, tagId: number) => void
}

export default function FileContextMenu({
  x, y, fileId, selectedFileIds, categories, tags, files,
  onClose, onSetCategory, onAddTag, onRemoveTag,
  onToggleFavorite, onOpenFile, onOpenLocation,
  onBulkToggleFavorite, onBulkSetCategory, onBulkAddTag, onBulkRemoveTag
}: Props) {
  const isBulk = selectedFileIds.has(fileId) && selectedFileIds.size > 1
  const bulkCount = selectedFileIds.size

  const file = files.find(f => f.id === fileId)
  if (!file) return null

  const fileTagIds = new Set(file.tags.map(t => t.id))

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - 400),
    zIndex: 50
  }

  const menuItem = (label: string, icon: React.ReactNode, onClick: () => void, className = '') => (
    <button
      onClick={e => { e.stopPropagation(); onClick(); onClose() }}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left transition-colors ${className}`}
    >
      {icon}
      {label}
    </button>
  )

  if (isBulk) {
    return (
      <div
        style={menuStyle}
        className="w-56 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-3 py-1.5 text-xs text-zinc-400 font-medium border-b border-zinc-200 dark:border-zinc-700">
          {bulkCount} files selected
        </div>

        {menuItem(
          `Star ${bulkCount} files`,
          <Star className="w-4 h-4" />,
          () => onBulkToggleFavorite(selectedFileIds)
        )}

        <div className="border-t border-zinc-200 dark:border-zinc-700 my-1" />

        <div className="px-3 py-1 text-xs text-zinc-400 font-medium">Set Category</div>
        <button
          onClick={e => { e.stopPropagation(); onBulkSetCategory(selectedFileIds, null); onClose() }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left text-zinc-500"
        >
          <Folder className="w-3 h-3" />
          None
        </button>
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={e => { e.stopPropagation(); onBulkSetCategory(selectedFileIds, cat.id); onClose() }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left"
          >
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
            {cat.name}
          </button>
        ))}

        {tags.length > 0 && (
          <>
            <div className="border-t border-zinc-200 dark:border-zinc-700 my-1" />
            <div className="px-3 py-1 text-xs text-zinc-400 font-medium">Add Tag</div>
            {tags.map(tag => (
              <button
                key={tag.id}
                onClick={e => { e.stopPropagation(); onBulkAddTag(selectedFileIds, tag.id); onClose() }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left"
              >
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </button>
            ))}

            <div className="border-t border-zinc-200 dark:border-zinc-700 my-1" />
            <div className="px-3 py-1 text-xs text-zinc-400 font-medium">Remove Tag</div>
            {tags.map(tag => (
              <button
                key={tag.id}
                onClick={e => { e.stopPropagation(); onBulkRemoveTag(selectedFileIds, tag.id); onClose() }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left"
              >
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </button>
            ))}
          </>
        )}
      </div>
    )
  }

  // Single file context menu (unchanged)
  return (
    <div
      style={menuStyle}
      className="w-52 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl overflow-hidden"
      onClick={e => e.stopPropagation()}
    >
      {menuItem('Open File', <ExternalLink className="w-4 h-4" />, () => onOpenFile(fileId))}
      {menuItem('Show in Folder', <FolderOpen className="w-4 h-4" />, () => onOpenLocation(fileId))}
      {menuItem(
        file.is_favorite ? 'Remove Star' : 'Add Star',
        <Star className="w-4 h-4" fill={file.is_favorite ? 'currentColor' : 'none'} />,
        () => onToggleFavorite(fileId),
        file.is_favorite ? 'text-amber-500' : ''
      )}

      <div className="border-t border-zinc-200 dark:border-zinc-700 my-1" />

      <div className="px-3 py-1 text-xs text-zinc-400 font-medium">Category</div>
      <button
        onClick={e => { e.stopPropagation(); onSetCategory(fileId, null); onClose() }}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left
          ${!file.category_id ? 'text-accent font-medium' : 'text-zinc-500'}`}
      >
        <Folder className="w-3 h-3" />
        None
      </button>
      {categories.map(cat => (
        <button
          key={cat.id}
          onClick={e => { e.stopPropagation(); onSetCategory(fileId, cat.id); onClose() }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left
            ${file.category_id === cat.id ? 'text-accent font-medium' : ''}`}
        >
          <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
          {cat.name}
        </button>
      ))}

      {tags.length > 0 && (
        <>
          <div className="border-t border-zinc-200 dark:border-zinc-700 my-1" />
          <div className="px-3 py-1 text-xs text-zinc-400 font-medium">Tags</div>
          {tags.map(tag => {
            const hasTag = fileTagIds.has(tag.id)
            return (
              <button
                key={tag.id}
                onClick={e => {
                  e.stopPropagation()
                  if (hasTag) onRemoveTag(fileId, tag.id)
                  else onAddTag(fileId, tag.id)
                  onClose()
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 text-left"
              >
                <span
                  className={`w-3 h-3 rounded flex-shrink-0 border-2 ${hasTag ? '' : 'border-zinc-300 dark:border-zinc-600'}`}
                  style={hasTag ? { backgroundColor: tag.color, borderColor: tag.color } : {}}
                />
                {tag.name}
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}
