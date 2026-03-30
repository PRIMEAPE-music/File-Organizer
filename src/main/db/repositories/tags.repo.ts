import { getDb } from '../database'
import type { Tag } from '../../../shared/types'

export function getAllTags(): Tag[] {
  return getDb().prepare('SELECT * FROM tags ORDER BY name').all() as Tag[]
}

export function createTag(name: string, color: string): Tag {
  const db = getDb()
  const info = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?)').run(name, color)
  return db.prepare('SELECT * FROM tags WHERE id = ?').get(info.lastInsertRowid) as Tag
}

export function updateTag(id: number, name: string, color: string): Tag {
  const db = getDb()
  db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(name, color, id)
  return db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as Tag
}

export function deleteTag(id: number): void {
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(id)
}

export function addFileTag(fileId: number, tagId: number): void {
  getDb().prepare('INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)').run(fileId, tagId)
}

export function removeFileTag(fileId: number, tagId: number): void {
  getDb().prepare('DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?').run(fileId, tagId)
}

export function getFileTags(fileId: number): Tag[] {
  return getDb().prepare(`
    SELECT t.* FROM tags t
    INNER JOIN file_tags ft ON ft.tag_id = t.id
    WHERE ft.file_id = ?
  `).all(fileId) as Tag[]
}
