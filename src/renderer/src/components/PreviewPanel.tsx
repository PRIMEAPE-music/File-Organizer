import { Star, ExternalLink, FolderOpen, Tag, X } from 'lucide-react'
import { useState } from 'react'
import type { FileWithMeta, Category, Tag as TagType } from '../../../shared/types'
import { usePreview } from '../hooks/usePreview'
import { formatFileSize, formatDate } from '../lib/format'
import FileIcon from './FileIcon'
import ExcelPreview from './ExcelPreview'
import WordPreview from './WordPreview'
import PdfPreview from './PdfPreview'
import TextPreview from './TextPreview'

interface Props {
  file: FileWithMeta | null
  onOpen: (file: FileWithMeta) => void
  onToggleFavorite: (fileId: number) => void
  onSetCategory: (fileId: number, categoryId: number | null) => void
  onAddTag: (fileId: number, tagId: number) => void
  onRemoveTag: (fileId: number, tagId: number) => void
  categories: Category[]
  tags: TagType[]
}

export default function PreviewPanel({
  file, onOpen, onToggleFavorite,
  onSetCategory, onAddTag, onRemoveTag,
  categories, tags
}: Props) {
  const { preview, loading: previewLoading } = usePreview(file?.path ?? null)
  const [showCatDropdown, setShowCatDropdown] = useState(false)
  const [showTagDropdown, setShowTagDropdown] = useState(false)

  if (!file) {
    return (
      <div className="w-96 flex-shrink-0 border-l border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex items-center justify-center text-zinc-400 text-sm p-4">
        Select a file to preview
      </div>
    )
  }

  const fileTagIds = new Set(file.tags.map(t => t.id))
  const availableTags = tags.filter(t => !fileTagIds.has(t.id))

  return (
    <div className="w-96 flex-shrink-0 border-l border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-700">
        <div className="flex items-start gap-3">
          <FileIcon extension={file.extension} size={32} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" title={file.name}>{file.name}</p>
            <p className="text-xs text-zinc-400 mt-0.5 truncate" title={file.path}>{file.path}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => onToggleFavorite(file.id)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors
              ${file.is_favorite
                ? 'bg-amber-500/15 text-amber-600'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-amber-500'}`}
          >
            <Star className="w-3 h-3" fill={file.is_favorite ? 'currentColor' : 'none'} />
            {file.is_favorite ? 'Starred' : 'Star'}
          </button>

          <button
            onClick={() => onOpen(file)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </button>

          <button
            onClick={() => window.api.openFileLocation(file.path)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
          >
            <FolderOpen className="w-3 h-3" />
            Location
          </button>
        </div>
      </div>

      {/* Preview Content */}
      <div className="flex-1 overflow-auto p-4" style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
        {previewLoading ? (
          <div className="flex items-center justify-center h-32 text-zinc-400">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
          </div>
        ) : preview?.type === 'excel' ? (
          <ExcelPreview data={preview} />
        ) : preview?.type === 'word' ? (
          <WordPreview data={preview} />
        ) : preview?.type === 'pdf' ? (
          <PdfPreview data={preview} />
        ) : preview?.type === 'text' ? (
          <TextPreview data={preview} />
        ) : preview?.type === 'unsupported' ? (
          <p className="text-sm text-zinc-400 italic">{preview.message}</p>
        ) : null}
      </div>

      {/* Metadata */}
      <div className="p-4 border-t border-zinc-200 dark:border-zinc-700 space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-zinc-400">Size</span>
            <p className="font-medium">{formatFileSize(file.size)}</p>
          </div>
          <div>
            <span className="text-zinc-400">Type</span>
            <p className="font-medium uppercase">{file.extension.replace('.', '')}</p>
          </div>
          <div className="col-span-2">
            <span className="text-zinc-400">Modified</span>
            <p className="font-medium">{formatDate(file.modified_at)}</p>
          </div>
        </div>

        {/* Category */}
        <div className="relative">
          <span className="text-xs text-zinc-400">Category</span>
          <button
            onClick={() => { setShowCatDropdown(!showCatDropdown); setShowTagDropdown(false) }}
            className="mt-1 w-full text-left px-2 py-1.5 text-sm rounded border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
          >
            {file.category ? (
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: file.category.color }} />
                {file.category.name}
              </span>
            ) : (
              <span className="text-zinc-400">None</span>
            )}
          </button>
          {showCatDropdown && (
            <div className="absolute bottom-full left-0 w-full mb-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg z-20 max-h-48 overflow-auto">
              <button
                onClick={() => { onSetCategory(file.id, null); setShowCatDropdown(false) }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400"
              >
                None
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => { onSetCategory(file.id, cat.id); setShowCatDropdown(false) }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2"
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
          <span className="text-xs text-zinc-400">Tags</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {file.tags.map(tag => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                style={{ backgroundColor: tag.color + '25', color: tag.color }}
              >
                {tag.name}
                <button
                  onClick={() => onRemoveTag(file.id, tag.id)}
                  className="hover:opacity-70"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <button
              onClick={() => { setShowTagDropdown(!showTagDropdown); setShowCatDropdown(false) }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-dashed border-zinc-300 dark:border-zinc-600 text-zinc-400 hover:border-accent hover:text-accent transition-colors"
            >
              <Tag className="w-3 h-3" />
              Add
            </button>
          </div>
          {showTagDropdown && availableTags.length > 0 && (
            <div className="absolute bottom-full left-0 w-full mb-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg z-20 max-h-48 overflow-auto">
              {availableTags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => { onAddTag(file.id, tag.id); setShowTagDropdown(false) }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center gap-2"
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
