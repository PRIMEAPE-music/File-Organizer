import { getDb } from '../database'
import type { NoteCategory, NoteTag } from '../../../shared/types'

// ─── Note Categories ───

export function getAllNoteCategories(): NoteCategory[] {
  return getDb().prepare('SELECT * FROM note_categories ORDER BY name').all() as NoteCategory[]
}

export function createNoteCategory(name: string, color: string): NoteCategory {
  const db = getDb()
  const info = db.prepare('INSERT INTO note_categories (name, color) VALUES (?, ?)').run(name, color)
  return db.prepare('SELECT * FROM note_categories WHERE id = ?').get(info.lastInsertRowid) as NoteCategory
}

export function updateNoteCategory(id: number, name: string, color: string): NoteCategory {
  const db = getDb()
  db.prepare('UPDATE note_categories SET name = ?, color = ? WHERE id = ?').run(name, color, id)
  return db.prepare('SELECT * FROM note_categories WHERE id = ?').get(id) as NoteCategory
}

export function deleteNoteCategory(id: number): void {
  getDb().prepare('DELETE FROM note_categories WHERE id = ?').run(id)
}

// ─── Note Tags ───

export function getAllNoteTags(): NoteTag[] {
  return getDb().prepare('SELECT * FROM note_tags ORDER BY name').all() as NoteTag[]
}

export function createNoteTag(name: string, color: string): NoteTag {
  const db = getDb()
  const info = db.prepare('INSERT INTO note_tags (name, color) VALUES (?, ?)').run(name, color)
  return db.prepare('SELECT * FROM note_tags WHERE id = ?').get(info.lastInsertRowid) as NoteTag
}

export function updateNoteTag(id: number, name: string, color: string): NoteTag {
  const db = getDb()
  db.prepare('UPDATE note_tags SET name = ?, color = ? WHERE id = ?').run(name, color, id)
  return db.prepare('SELECT * FROM note_tags WHERE id = ?').get(id) as NoteTag
}

export function deleteNoteTag(id: number): void {
  getDb().prepare('DELETE FROM note_tags WHERE id = ?').run(id)
}

export function addNoteTag(noteId: number, tagId: number): void {
  getDb().prepare('INSERT OR IGNORE INTO note_tag_map (note_id, tag_id) VALUES (?, ?)').run(noteId, tagId)
}

export function removeNoteTag(noteId: number, tagId: number): void {
  getDb().prepare('DELETE FROM note_tag_map WHERE note_id = ? AND tag_id = ?').run(noteId, tagId)
}
