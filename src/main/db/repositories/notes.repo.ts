import { getDb } from '../database'
import type { Note, NoteWithMeta, NoteFilterState, NoteCategory, NoteTag } from '../../../shared/types'

function enrichNote(note: Note): NoteWithMeta {
  const db = getDb()
  const category = note.category_id
    ? (db.prepare('SELECT * FROM note_categories WHERE id = ?').get(note.category_id) as NoteCategory | undefined) ?? null
    : null
  const tags = db.prepare(`
    SELECT t.* FROM note_tags t
    INNER JOIN note_tag_map m ON m.tag_id = t.id
    WHERE m.note_id = ?
  `).all(note.id) as NoteTag[]
  return { ...note, category, tags }
}

export function getNotes(filter: NoteFilterState): NoteWithMeta[] {
  const db = getDb()
  let query = 'SELECT * FROM notes'
  const conditions: string[] = []
  const params: unknown[] = []

  if (filter.search) {
    conditions.push('(title LIKE ? OR content LIKE ?)')
    const term = `%${filter.search}%`
    params.push(term, term)
  }

  if (filter.sidebarView.type === 'category') {
    conditions.push('category_id = ?')
    params.push(filter.sidebarView.id)
  } else if (filter.sidebarView.type === 'tag') {
    conditions.push('id IN (SELECT note_id FROM note_tag_map WHERE tag_id = ?)')
    params.push(filter.sidebarView.id)
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }

  const dir = filter.sortDirection === 'asc' ? 'ASC' : 'DESC'
  query += ` ORDER BY ${filter.sortField} ${dir}`

  const notes = db.prepare(query).all(...params) as Note[]
  return notes.map(enrichNote)
}

export function getNoteById(id: number): NoteWithMeta | undefined {
  const note = getDb().prepare('SELECT * FROM notes WHERE id = ?').get(id) as Note | undefined
  return note ? enrichNote(note) : undefined
}

export function createNote(title: string, content: string): NoteWithMeta {
  const db = getDb()
  const info = db.prepare('INSERT INTO notes (title, content) VALUES (?, ?)').run(title, content)
  return enrichNote(db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid) as Note)
}

export function updateNote(id: number, title: string, content: string): NoteWithMeta {
  const db = getDb()
  db.prepare("UPDATE notes SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?").run(title, content, id)
  return enrichNote(db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Note)
}

export function deleteNote(id: number): void {
  getDb().prepare('DELETE FROM notes WHERE id = ?').run(id)
}

export function setNoteCategory(noteId: number, categoryId: number | null): void {
  getDb().prepare('UPDATE notes SET category_id = ? WHERE id = ?').run(categoryId, noteId)
}
