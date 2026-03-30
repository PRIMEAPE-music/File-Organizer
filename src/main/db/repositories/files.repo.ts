import { getDb } from '../database'
import type { FileEntry, FileWithMeta, Tag, Category, FilterState } from '../../../shared/types'

interface InsertFileParams {
  folder_id: number
  name: string
  extension: string
  path: string
  size: number
  modified_at: string
  created_at: string
}

export function upsertFile(params: InsertFileParams): FileEntry {
  const db = getDb()
  db.prepare(`
    INSERT INTO files (folder_id, name, extension, path, size, modified_at, created_at)
    VALUES (@folder_id, @name, @extension, @path, @size, @modified_at, @created_at)
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name,
      size = excluded.size,
      modified_at = excluded.modified_at,
      indexed_at = datetime('now')
  `).run(params)
  return db.prepare('SELECT * FROM files WHERE path = ?').get(params.path) as FileEntry
}

export function removeFilesByFolder(folderId: number): void {
  getDb().prepare('DELETE FROM files WHERE folder_id = ?').run(folderId)
}

/** Remove files in a folder whose indexed_at is older than the most recent scan.
 *  Call this after a full scanFolder() to clean up files that no longer exist on
 *  disk without destroying metadata for files that were just re-indexed. */
export function removeStaleFiles(folderId: number): void {
  const db = getDb()
  const latest = db.prepare(
    'SELECT MAX(indexed_at) as latest FROM files WHERE folder_id = ?'
  ).get(folderId) as { latest: string | null } | undefined
  if (!latest?.latest) return
  db.prepare(
    'DELETE FROM files WHERE folder_id = ? AND indexed_at < ?'
  ).run(folderId, latest.latest)
}

export function removeFileByPath(filePath: string): void {
  getDb().prepare('DELETE FROM files WHERE path = ?').run(filePath)
}

export function getFileById(id: number): FileWithMeta | undefined {
  const db = getDb()
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(id) as FileEntry | undefined
  if (!file) return undefined
  return enrichFile(file)
}

export function getFiles(filter: FilterState): FileWithMeta[] {
  const db = getDb()
  const conditions: string[] = []
  const params: Record<string, unknown> = {}

  // Sidebar view filtering
  const view = filter.sidebarView
  if (view.type === 'category') {
    conditions.push('f.category_id = @categoryId')
    params.categoryId = view.id
  } else if (view.type === 'tag') {
    conditions.push('f.id IN (SELECT file_id FROM file_tags WHERE tag_id = @tagId)')
    params.tagId = view.id
  } else if (view.type === 'folder') {
    conditions.push('f.folder_id = @folderId')
    params.folderId = view.id
  } else if (view.type === 'favorites') {
    conditions.push('f.id IN (SELECT file_id FROM favorites)')
  } else if (view.type === 'recent') {
    // Handled separately with ORDER BY
  }

  // Extension filter
  if (filter.extensions.length > 0) {
    const extPlaceholders = filter.extensions.map((_, i) => `@ext${i}`).join(', ')
    conditions.push(`f.extension IN (${extPlaceholders})`)
    filter.extensions.forEach((ext, i) => {
      params[`ext${i}`] = ext
    })
  }

  // Search
  if (filter.search.trim()) {
    conditions.push('f.id IN (SELECT rowid FROM files_fts WHERE files_fts MATCH @search)')
    params.search = filter.search.trim().split(/\s+/).map(w => `"${w}"*`).join(' ')
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const needsFolderJoin = filter.sortField === 'folder'
  const folderJoin = needsFolderJoin ? 'LEFT JOIN scanned_folders sf ON sf.id = f.folder_id' : ''

  let orderBy: string
  if (view.type === 'recent') {
    orderBy = 'ORDER BY r.opened_at DESC'
  } else {
    const dir = filter.sortDirection === 'asc' ? 'ASC' : 'DESC'
    if (filter.sortField === 'folder') {
      orderBy = `ORDER BY sf.path ${dir}`
    } else {
      orderBy = `ORDER BY f.${filter.sortField} ${dir}`
    }
  }

  let query: string
  if (view.type === 'recent') {
    query = `
      SELECT DISTINCT f.* FROM files f
      INNER JOIN recents r ON r.file_id = f.id
      ${folderJoin}
      ${where}
      ${orderBy}
      LIMIT 50
    `
  } else {
    query = `SELECT f.* FROM files f ${folderJoin} ${where} ${orderBy}`
  }

  const files = db.prepare(query).all(params) as FileEntry[]
  return files.map(enrichFile)
}

function enrichFile(file: FileEntry): FileWithMeta {
  const db = getDb()
  const tags = db.prepare(`
    SELECT t.* FROM tags t
    INNER JOIN file_tags ft ON ft.tag_id = t.id
    WHERE ft.file_id = ?
  `).all(file.id) as Tag[]

  const category = file.category_id
    ? (db.prepare('SELECT * FROM categories WHERE id = ?').get(file.category_id) as Category | null)
    : null

  const fav = db.prepare('SELECT 1 FROM favorites WHERE file_id = ?').get(file.id)

  return {
    ...file,
    tags,
    category,
    is_favorite: !!fav
  }
}

export function setFileCategory(fileId: number, categoryId: number | null): void {
  getDb().prepare('UPDATE files SET category_id = ? WHERE id = ?').run(categoryId, fileId)
}

export function searchFiles(query: string): FileWithMeta[] {
  const db = getDb()
  const searchTerms = query.trim().split(/\s+/).map(w => `"${w}"*`).join(' ')
  const files = db.prepare(`
    SELECT f.* FROM files f
    INNER JOIN files_fts fts ON fts.rowid = f.id
    WHERE files_fts MATCH ?
    LIMIT 100
  `).all(searchTerms) as FileEntry[]
  return files.map(enrichFile)
}
