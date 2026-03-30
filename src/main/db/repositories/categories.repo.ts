import { getDb } from '../database'
import type { Category } from '../../../shared/types'

export function getAllCategories(): Category[] {
  return getDb().prepare('SELECT * FROM categories ORDER BY name').all() as Category[]
}

export function createCategory(name: string, color: string): Category {
  const db = getDb()
  const info = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)').run(name, color)
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid) as Category
}

export function updateCategory(id: number, name: string, color: string): Category {
  const db = getDb()
  db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?').run(name, color, id)
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category
}

export function deleteCategory(id: number): void {
  getDb().prepare('DELETE FROM categories WHERE id = ?').run(id)
}
