import { useState } from 'react'
import {
  StickyNote, ChevronDown, ChevronRight, Plus, Pencil, Trash2, Tag
} from 'lucide-react'
import type { NoteSidebarView, NoteCategory, NoteTag } from '../../../../shared/types'

interface Props {
  sidebarView: NoteSidebarView
  onSetView: (view: NoteSidebarView) => void
  categories: NoteCategory[]
  tags: NoteTag[]
  onCreateCategory: () => void
  onEditCategory: (cat: NoteCategory) => void
  onDeleteCategory: (id: number) => void
  onCreateTag: () => void
  onEditTag: (tag: NoteTag) => void
  onDeleteTag: (id: number) => void
}

function isActive(current: NoteSidebarView, check: NoteSidebarView): boolean {
  if (current.type !== check.type) return false
  if ('id' in current && 'id' in check) return current.id === check.id
  return true
}

export default function NoteSidebar({
  sidebarView, onSetView, categories, tags,
  onCreateCategory, onEditCategory, onDeleteCategory,
  onCreateTag, onEditTag, onDeleteTag
}: Props) {
  const [categoriesOpen, setCategoriesOpen] = useState(true)
  const [tagsOpen, setTagsOpen] = useState(true)

  const navItem = (label: string, icon: React.ReactNode, view: NoteSidebarView) => {
    const active = isActive(sidebarView, view)
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
    <div className="w-56 flex-shrink-0 border-r border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 flex flex-col h-full overflow-y-auto">
      <div className="p-2 space-y-1">
        {navItem('All Notes', <StickyNote className="w-4 h-4" />, { type: 'all' })}

        {/* Categories */}
        <div className="pt-3">
          <button
            onClick={() => setCategoriesOpen(!categoriesOpen)}
            className="w-full flex items-center justify-between px-3 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
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
                      ${isActive(sidebarView, { type: 'category', id: cat.id })
                        ? 'bg-accent/15 text-accent font-medium'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                  >
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                    {cat.name}
                  </button>
                  <div className="hidden group-hover:flex items-center gap-0.5 mr-1">
                    <button onClick={() => onEditCategory(cat)} className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={() => onDeleteCategory(cat.id)} className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500">
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

        {/* Tags */}
        <div className="pt-3">
          <button
            onClick={() => setTagsOpen(!tagsOpen)}
            className="w-full flex items-center justify-between px-3 py-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
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
                      ${isActive(sidebarView, { type: 'tag', id: tag.id }) ? 'ring-2 ring-accent' : ''}`}
                    style={{ backgroundColor: tag.color + '25', color: tag.color }}
                  >
                    <Tag className="w-3 h-3" />
                    {tag.name}
                  </button>
                  <div className="hidden group-hover:flex absolute -top-1 -right-1 items-center gap-0.5 bg-white dark:bg-zinc-800 rounded shadow-sm border border-zinc-200 dark:border-zinc-700 p-0.5 z-10">
                    <button onClick={() => onEditTag(tag)} className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400">
                      <Pencil className="w-2.5 h-2.5" />
                    </button>
                    <button onClick={() => onDeleteTag(tag.id)} className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-red-500">
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
