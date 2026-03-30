import { getDb } from '../database'

const MAX_RECENTS = 50

export function addRecent(fileId: number): void {
  const db = getDb()
  db.prepare('INSERT INTO recents (file_id) VALUES (?)').run(fileId)

  // Trim old entries
  db.prepare(`
    DELETE FROM recents WHERE id NOT IN (
      SELECT id FROM recents ORDER BY opened_at DESC LIMIT ?
    )
  `).run(MAX_RECENTS)
}
