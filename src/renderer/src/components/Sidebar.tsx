import {
  Files, Star, Clock, FolderPlus, Folder, ChevronDown, ChevronRight,
  Plus, Pencil, Trash2, Tag, Search, RefreshCw, X
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import type { SidebarView, ScannedFolder, Category, Tag as TagType } from '../../../shared/types'

interface Props {
  sidebarView: SidebarView
  onSetView: (view: SidebarView) => void
  folders: ScannedFolder[]
  categories: Category[]
  tags: TagType[]
  onAddFolder: (recursive: boolean) => void
  onRemoveFolder: (id: number) => void
  onRescanFolder: (id: number) => void
  onCreateCategory: () => void
  onEditCategory: (cat: Category) => void
  onDeleteCategory: (id: number) => void
  onCreateTag: () => void
  onEditTag: (tag: TagType) => void
  onDeleteTag: (id: number) => void
  search: string
  onSearchChange: (search: string) => void
}

function isActiveView(current: SidebarView, check: SidebarView): boolean {
  if (current.type !== check.type) return false
  if ('id' in current && 'id' in check) return current.id === check.id
  return true
}

export default function Sidebar({
  sidebarView, onSetView, folders, categories, tags,
  onAddFolder, onRemoveFolder, onRescanFolder,
  onCreateCategory, onEditCategory, onDeleteCategory,
  onCreateTag, onEditTag, onDeleteTag,
  search, onSearchChange
}: Props) {
  const [foldersOpen, setFoldersOpen] = useState(true)
  const [categoriesOpen, setCategoriesOpen] = useState(true)
  const [tagsOpen, setTagsOpen] = useState(true)
  const [addFolderMenu, setAddFolderMenu] = useState(false)
  const addFolderRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (!addFolderMenu) return
    const handler = (e: MouseEvent) => {
      if (addFolderRef.current && !addFolderRef.current.contains(e.target as Node)) {
        setAddFolderMenu(false)
      }
    }
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [addFolderMenu])

  const navItem = (label: string, icon: React.ReactNode, view: SidebarView) => {
    const active = isActiveView(sidebarView, view)
    return (
      <button
        onClick={() => onSetView(view)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors
          ${active
            ? 'bg-accent/15 text-accent font-medium'
            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
      >
        {icon}
        {label}
      </button>
    )
  }

  return (
    <div className="w-64 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b border-zinc-200 dark:border-zinc-700">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search files... (Ctrl+F)"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 text-sm rounded-md border border-zinc-300 dark:border-zinc-600
              bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-accent/50
              placeholder:text-zinc-400"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {navItem('All Files', <Files className="w-4 h-4" />, { type: 'all' })}
        {navItem('Favorites', <Star className="w-4 h-4" />, { type: 'favorites' })}
        {navItem('Recent', <Clock className="w-4 h-4" />, { type: 'recent' })}

        {/* Folders Section */}
        <div className="pt-3">
          <button
            onClick={() => setFoldersOpen(!foldersOpen)}
            className="w-full flex items-center justify-between px-3 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            <span className="flex items-center gap-1">
              {foldersOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Folders
            </span>
            <div ref={addFolderRef} className="relative">
              <button
                onClick={e => { e.stopPropagation(); setAddFolderMenu(!addFolderMenu) }}
                className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
                title="Add folder"
              >
                <FolderPlus className="w-3.5 h-3.5" />
              </button>
              {addFolderMenu && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md shadow-lg z-30 overflow-hidden">
                  <button
                    onClick={() => { onAddFolder(true); setAddFolderMenu(false) }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                  >
                    <span className="font-medium">With subfolders</span>
                    <p className="text-[11px] text-zinc-400 mt-0.5">Include all nested files</p>
                  </button>
                  <button
                    onClick={() => { onAddFolder(false); setAddFolderMenu(false) }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors border-t border-zinc-100 dark:border-zinc-700"
                  >
                    <span className="font-medium">Top-level only</span>
                    <p className="text-[11px] text-zinc-400 mt-0.5">Only files in selected folder</p>
                  </button>
                </div>
              )}
            </div>
          </button>
          {foldersOpen && (
            <div className="mt-1 space-y-0.5">
              {folders.map(folder => (
                <div key={folder.id} className="group flex items-center">
                  <button
                    onClick={() => onSetView({ type: 'folder', id: folder.id })}
                    className={`flex-1 flex items-center gap-2 px-3 py-1.5 rounded-md text-sm truncate transition-colors
                      ${isActiveView(sidebarView, { type: 'folder', id: folder.id })
                        ? 'bg-accent/15 text-accent font-medium'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                    title={folder.path}
                  >
                    <Folder className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">{folder.path.split(/[\\/]/).pop()}</span>
                    {!folder.recursive && (
                      <span className="text-[9px] text-zinc-400 flex-shrink-0" title="Top-level only">flat</span>
                    )}
                  </button>
                  <div className="hidden group-hover:flex items-center gap-0.5 mr-1">
                    <button
                      onClick={() => onRescanFolder(folder.id)}
                      className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400"
                      title="Rescan"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => onRemoveFolder(folder.id)}
                      className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500"
                      title="Remove"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
              {folders.length === 0 && (
                <p className="px-3 py-2 text-xs text-zinc-400 italic">No folders added</p>
              )}
            </div>
          )}
        </div>

        {/* Categories Section */}
        <div className="pt-3">
          <button
            onClick={() => setCategoriesOpen(!categoriesOpen)}
            className="w-full flex items-center justify-between px-3 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            <span className="flex items-center gap-1">
              {categoriesOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Categories
            </span>
            <button
              onClick={e => { e.stopPropagation(); onCreateCategory() }}
              className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
              title="New category"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </button>
          {categoriesOpen && (
            <div className="mt-1 space-y-0.5">
              {categories.map(cat => (
                <div key={cat.id} className="group flex items-center">
                  <button
                    onClick={() => onSetView({ type: 'category', id: cat.id })}
                    className={`flex-1 flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors
                      ${isActiveView(sidebarView, { type: 'category', id: cat.id })
                        ? 'bg-accent/15 text-accent font-medium'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                  >
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                    {cat.name}
                  </button>
                  <div className="hidden group-hover:flex items-center gap-0.5 mr-1">
                    <button
                      onClick={() => onEditCategory(cat)}
                      className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => onDeleteCategory(cat.id)}
                      className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
              {categories.length === 0 && (
                <p className="px-3 py-2 text-xs text-zinc-400 italic">No categories yet</p>
              )}
            </div>
          )}
        </div>

        {/* Tags Section */}
        <div className="pt-3">
          <button
            onClick={() => setTagsOpen(!tagsOpen)}
            className="w-full flex items-center justify-between px-3 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            <span className="flex items-center gap-1">
              {tagsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Tags
            </span>
            <button
              onClick={e => { e.stopPropagation(); onCreateTag() }}
              className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700"
              title="New tag"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </button>
          {tagsOpen && (
            <div className="mt-1 px-3 flex flex-wrap gap-1.5">
              {tags.map(tag => (
                <div key={tag.id} className="group relative">
                  <button
                    onClick={() => onSetView({ type: 'tag', id: tag.id })}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors
                      ${isActiveView(sidebarView, { type: 'tag', id: tag.id })
                        ? 'ring-2 ring-accent'
                        : ''}`}
                    style={{ backgroundColor: tag.color + '25', color: tag.color }}
                  >
                    <Tag className="w-3 h-3" />
                    {tag.name}
                  </button>
                  <div className="hidden group-hover:flex absolute -top-1 -right-1 items-center gap-0.5 bg-white dark:bg-zinc-800 rounded shadow-sm border border-zinc-200 dark:border-zinc-700 p-0.5 z-10">
                    <button
                      onClick={() => onEditTag(tag)}
                      className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                    </button>
                    <button
                      onClick={() => onDeleteTag(tag.id)}
                      className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              ))}
              {tags.length === 0 && (
                <p className="py-2 text-xs text-zinc-400 italic">No tags yet</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
