import { getDb } from '../database'
import type { ScannedFolder } from '../../../shared/types'

export function getAllFolders(): ScannedFolder[] {
  return getDb().prepare('SELECT * FROM scanned_folders ORDER BY added_at DESC').all() as ScannedFolder[]
}

export function addFolder(folderPath: string, recursive: boolean = true): ScannedFolder {
  const db = getDb()
  const rec = recursive ? 1 : 0
  const info = db.prepare('INSERT OR IGNORE INTO scanned_folders (path, recursive) VALUES (?, ?)').run(folderPath, rec)
  if (info.changes === 0) {
    return db.prepare('SELECT * FROM scanned_folders WHERE path = ?').get(folderPath) as ScannedFolder
  }
  return db.prepare('SELECT * FROM scanned_folders WHERE id = ?').get(info.lastInsertRowid) as ScannedFolder
}

export function removeFolder(id: number): void {
  getDb().prepare('DELETE FROM scanned_folders WHERE id = ?').run(id)
}

export function getFolderById(id: number): ScannedFolder | undefined {
  return getDb().prepare('SELECT * FROM scanned_folders WHERE id = ?').get(id) as ScannedFolder | undefined
}
