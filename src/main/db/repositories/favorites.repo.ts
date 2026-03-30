import { getDb } from '../database'

export function toggleFavorite(fileId: number): boolean {
  const db = getDb()
  const existing = db.prepare('SELECT 1 FROM favorites WHERE file_id = ?').get(fileId)
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE file_id = ?').run(fileId)
    return false
  } else {
    db.prepare('INSERT INTO favorites (file_id) VALUES (?)').run(fileId)
    return true
  }
}

export function isFavorite(fileId: number): boolean {
  return !!getDb().prepare('SELECT 1 FROM favorites WHERE file_id = ?').get(fileId)
}
