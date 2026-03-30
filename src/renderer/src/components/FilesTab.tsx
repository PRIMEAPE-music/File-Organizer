import { useState, useCallback, useRef } from 'react'
import type { FilterState, SidebarView, ViewMode, FileWithMeta, SortField, SortDirection } from '../../../shared/types'
import { useFiles } from '../hooks/useFiles'
import { useFolders } from '../hooks/useFolders'
import { useCategories } from '../hooks/useCategories'
import { useTags } from '../hooks/useTags'
import { useContextMenu } from '../hooks/useContextMenu'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import FileGrid from './FileGrid'
import FileList from './FileList'
import PreviewPanel from './PreviewPanel'
import FileContextMenu from './FileContextMenu'
import CategoryDialog from './CategoryDialog'
import TagDialog from './TagDialog'

interface FilesTabProps {
  viewMode: ViewMode
  onSetViewMode: (mode: ViewMode) => void
  sidebarCollapsed?: boolean
}

export default function FilesTab({ viewMode, onSetViewMode: setViewMode, sidebarCollapsed = false }: FilesTabProps) {

  const [selectedFile, setSelectedFile] = useState<FileWithMeta | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set())
  const lastClickedIndexRef = useRef<number>(-1)
  const [isDragOver, setIsDragOver] = useState(false)

  const [showPreview, setShowPreview] = useState(() => {
    return localStorage.getItem('showPreview') !== 'false'
  })

  const togglePreview = useCallback(() => {
    setShowPreview(prev => {
      const next = !prev
      localStorage.setItem('showPreview', String(next))
      return next
    })
  }, [])

  const [filter, setFilter] = useState<FilterState>({
    search: '',
    extensions: [],
    sortField: 'name',
    sortDirection: 'asc',
    sidebarView: { type: 'all' }
  })

  const { files, loading, refresh } = useFiles(filter)
  const { folders, addFolder, removeFolder, rescanFolder } = useFolders()
  const { categories, createCategory, updateCategory, deleteCategory } = useCategories()
  const { tags, createTag, updateTag, deleteTag } = useTags()
  const { menu, openMenu, closeMenu } = useContextMenu()

  const [categoryDialog, setCategoryDialog] = useState<{ mode: 'create' } | { mode: 'edit'; id: number; name: string; color: string } | null>(null)
  const [tagDialog, setTagDialog] = useState<{ mode: 'create' } | { mode: 'edit'; id: number; name: string; color: string } | null>(null)

  const setSidebarView = useCallback((view: SidebarView) => {
    setFilter(f => ({ ...f, sidebarView: view }))
    setSelectedFile(null)
    setSelectedFiles(new Set())
  }, [])

  const setSearch = useCallback((search: string) => {
    setFilter(f => ({ ...f, search }))
  }, [])

  const setExtensions = useCallback((extensions: string[]) => {
    setFilter(f => ({ ...f, extensions }))
  }, [])

  const setSort = useCallback((sortField: SortField, sortDirection: SortDirection) => {
    setFilter(f => ({ ...f, sortField, sortDirection }))
  }, [])

  const handleSelectFile = useCallback((file: FileWithMeta, e: React.MouseEvent) => {
    const fileIndex = files.findIndex(f => f.id === file.id)

    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Click: toggle in set
      setSelectedFiles(prev => {
        const next = new Set(prev)
        if (next.has(file.id)) {
          next.delete(file.id)
        } else {
          next.add(file.id)
        }
        return next
      })
      lastClickedIndexRef.current = fileIndex
    } else if (e.shiftKey && lastClickedIndexRef.current >= 0) {
      // Shift+Click: range select
      const start = Math.min(lastClickedIndexRef.current, fileIndex)
      const end = Math.max(lastClickedIndexRef.current, fileIndex)
      const rangeIds = new Set<number>()
      for (let i = start; i <= end; i++) {
        rangeIds.add(files[i].id)
      }
      setSelectedFiles(rangeIds)
    } else {
      // Plain click: select one
      setSelectedFiles(new Set([file.id]))
      lastClickedIndexRef.current = fileIndex
    }

    setSelectedFile(file)
  }, [files])

  const handleOpenFile = useCallback(async (file: FileWithMeta) => {
    await window.api.openFile(file.id)
    refresh()
  }, [refresh])

  const handleToggleFavorite = useCallback(async (fileId: number) => {
    await window.api.toggleFavorite(fileId)
    refresh()
    if (selectedFile?.id === fileId) {
      const updated = await window.api.getFile(fileId)
      if (updated) setSelectedFile(updated)
    }
  }, [refresh, selectedFile])

  const handleSetCategory = useCallback(async (fileId: number, categoryId: number | null) => {
    await window.api.setFileCategory(fileId, categoryId)
    refresh()
    if (selectedFile?.id === fileId) {
      const updated = await window.api.getFile(fileId)
      if (updated) setSelectedFile(updated)
    }
  }, [refresh, selectedFile])

  const handleAddTag = useCallback(async (fileId: number, tagId: number) => {
    await window.api.addFileTag(fileId, tagId)
    refresh()
    if (selectedFile?.id === fileId) {
      const updated = await window.api.getFile(fileId)
      if (updated) setSelectedFile(updated)
    }
  }, [refresh, selectedFile])

  const handleRemoveTag = useCallback(async (fileId: number, tagId: number) => {
    await window.api.removeFileTag(fileId, tagId)
    refresh()
    if (selectedFile?.id === fileId) {
      const updated = await window.api.getFile(fileId)
      if (updated) setSelectedFile(updated)
    }
  }, [refresh, selectedFile])

  // Bulk handlers
  const handleBulkToggleFavorite = useCallback(async (fileIds: Set<number>) => {
    for (const id of fileIds) {
      await window.api.toggleFavorite(id)
    }
    refresh()
  }, [refresh])

  const handleBulkSetCategory = useCallback(async (fileIds: Set<number>, categoryId: number | null) => {
    for (const id of fileIds) {
      await window.api.setFileCategory(id, categoryId)
    }
    refresh()
  }, [refresh])

  const handleBulkAddTag = useCallback(async (fileIds: Set<number>, tagId: number) => {
    for (const id of fileIds) {
      await window.api.addFileTag(id, tagId)
    }
    refresh()
  }, [refresh])

  const handleBulkRemoveTag = useCallback(async (fileIds: Set<number>, tagId: number) => {
    for (const id of fileIds) {
      await window.api.removeFileTag(id, tagId)
    }
    refresh()
  }, [refresh])

  const handleAddFolder = useCallback(async (recursive: boolean) => {
    const result = await addFolder(recursive)
    if (result) refresh()
  }, [addFolder, refresh])

  const handleRemoveFolder = useCallback(async (id: number) => {
    await removeFolder(id)
    refresh()
  }, [removeFolder, refresh])

  const handleContextMenu = useCallback((e: React.MouseEvent, fileId: number) => {
    openMenu(e, fileId, selectedFiles)
  }, [openMenu, selectedFiles])

  // Drag-in handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    // Only show drop zone for external files (not internal drags)
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the container (not entering a child)
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const items = e.dataTransfer.files
    if (!items || items.length === 0) return

    // Collect unique parent folder paths
    const folderPaths = new Set<string>()
    for (let i = 0; i < items.length; i++) {
      const filePath = items[i].path
      if (!filePath) continue
      // Use the path directly if it's a directory, otherwise get parent
      const sep = filePath.includes('\\') ? '\\' : '/'
      const parts = filePath.split(sep)
      // Check if the dropped item looks like a folder (no extension in last segment)
      const lastPart = parts[parts.length - 1]
      if (!lastPart.includes('.')) {
        // Likely a folder
        folderPaths.add(filePath)
      } else {
        // It's a file — add its parent folder
        parts.pop()
        folderPaths.add(parts.join(sep))
      }
    }

    for (const folderPath of folderPaths) {
      try {
        await window.api.addFolder(folderPath)
      } catch {
        // Folder may already be added
      }
    }

    refresh()
  }, [refresh])

  return (
    <div className="flex flex-1 overflow-hidden">
      {!sidebarCollapsed && <Sidebar
        sidebarView={filter.sidebarView}
        onSetView={setSidebarView}
        folders={folders}
        categories={categories}
        tags={tags}
        onAddFolder={handleAddFolder}
        onRemoveFolder={handleRemoveFolder}
        onRescanFolder={rescanFolder}
        onCreateCategory={() => setCategoryDialog({ mode: 'create' })}
        onEditCategory={(cat) => setCategoryDialog({ mode: 'edit', id: cat.id, name: cat.name, color: cat.color })}
        onDeleteCategory={deleteCategory}
        onCreateTag={() => setTagDialog({ mode: 'create' })}
        onEditTag={(tag) => setTagDialog({ mode: 'edit', id: tag.id, name: tag.name, color: tag.color })}
        onDeleteTag={deleteTag}
        search={filter.search}
        onSearchChange={setSearch}
      />}

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          viewMode={viewMode}
          onSetViewMode={setViewMode}
          extensions={filter.extensions}
          onSetExtensions={setExtensions}
          sortField={filter.sortField}
          sortDirection={filter.sortDirection}
          onSetSort={setSort}
          showPreview={showPreview}
          onTogglePreview={togglePreview}
          fileCount={files.length}
        />

        <div
          className={`flex-1 overflow-auto p-4 relative ${isDragOver ? 'bg-accent/5' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className="absolute inset-4 border-2 border-dashed border-accent rounded-lg flex items-center justify-center bg-accent/5 z-30 pointer-events-none">
              <p className="text-accent font-medium text-sm">Drop folders here to add them</p>
            </div>
          )}

          {loading && files.length === 0 ? (
            <div className="flex items-center justify-center h-full text-zinc-400">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto mb-3" />
                <p>Loading files...</p>
              </div>
            </div>
          ) : files.length === 0 ? (
            <div className="flex items-center justify-center h-full text-zinc-400">
              <div className="text-center">
                <p className="text-lg mb-2">No files found</p>
                <p className="text-sm">
                  {folders.length === 0
                    ? 'Add a folder to get started'
                    : 'Try adjusting your search or filters'}
                </p>
              </div>
            </div>
          ) : viewMode === 'grid' ? (
            <FileGrid
              files={files}
              selectedFile={selectedFile}
              selectedFileIds={selectedFiles}
              onSelect={handleSelectFile}
              onOpen={handleOpenFile}
              onContextMenu={handleContextMenu}
              onToggleFavorite={handleToggleFavorite}
            />
          ) : (
            <FileList
              files={files}
              selectedFile={selectedFile}
              selectedFileIds={selectedFiles}
              onSelect={handleSelectFile}
              onOpen={handleOpenFile}
              onContextMenu={handleContextMenu}
              onToggleFavorite={handleToggleFavorite}
              sortField={filter.sortField}
              sortDirection={filter.sortDirection}
              onSetSort={setSort}
            />
          )}
        </div>
      </div>

      {showPreview && (
        <PreviewPanel
          file={selectedFile}
          onOpen={handleOpenFile}
          onToggleFavorite={handleToggleFavorite}
          onSetCategory={handleSetCategory}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          categories={categories}
          tags={tags}
        />
      )}

      {menu && (
        <FileContextMenu
          x={menu.x}
          y={menu.y}
          fileId={menu.fileId}
          selectedFileIds={menu.selectedFileIds}
          categories={categories}
          tags={tags}
          files={files}
          onClose={closeMenu}
          onSetCategory={handleSetCategory}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onToggleFavorite={handleToggleFavorite}
          onOpenFile={(id) => {
            const f = files.find(f => f.id === id)
            if (f) handleOpenFile(f)
          }}
          onOpenLocation={(id) => {
            const f = files.find(f => f.id === id)
            if (f) window.api.openFileLocation(f.path)
          }}
          onBulkToggleFavorite={handleBulkToggleFavorite}
          onBulkSetCategory={handleBulkSetCategory}
          onBulkAddTag={handleBulkAddTag}
          onBulkRemoveTag={handleBulkRemoveTag}
        />
      )}

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
