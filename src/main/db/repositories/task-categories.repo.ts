import { getDb } from '../database'
import type { TaskCategory, TaskTag } from '../../../shared/types'

// ─── Task Categories ───

export function getAllTaskCategories(): TaskCategory[] {
  return getDb().prepare('SELECT * FROM task_categories ORDER BY name').all() as TaskCategory[]
}

export function createTaskCategory(name: string, color: string): TaskCategory {
  const db = getDb()
  const info = db.prepare('INSERT INTO task_categories (name, color) VALUES (?, ?)').run(name, color)
  return db.prepare('SELECT * FROM task_categories WHERE id = ?').get(info.lastInsertRowid) as TaskCategory
}

export function updateTaskCategory(id: number, name: string, color: string): TaskCategory {
  const db = getDb()
  db.prepare('UPDATE task_categories SET name = ?, color = ? WHERE id = ?').run(name, color, id)
  return db.prepare('SELECT * FROM task_categories WHERE id = ?').get(id) as TaskCategory
}

export function deleteTaskCategory(id: number): void {
  getDb().prepare('DELETE FROM task_categories WHERE id = ?').run(id)
}

// ─── Task Tags ───

export function getAllTaskTags(): TaskTag[] {
  return getDb().prepare('SELECT * FROM task_tags ORDER BY name').all() as TaskTag[]
}

export function createTaskTag(name: string, color: string): TaskTag {
  const db = getDb()
  const info = db.prepare('INSERT INTO task_tags (name, color) VALUES (?, ?)').run(name, color)
  return db.prepare('SELECT * FROM task_tags WHERE id = ?').get(info.lastInsertRowid) as TaskTag
}

export function updateTaskTag(id: number, name: string, color: string): TaskTag {
  const db = getDb()
  db.prepare('UPDATE task_tags SET name = ?, color = ? WHERE id = ?').run(name, color, id)
  return db.prepare('SELECT * FROM task_tags WHERE id = ?').get(id) as TaskTag
}

export function deleteTaskTag(id: number): void {
  getDb().prepare('DELETE FROM task_tags WHERE id = ?').run(id)
}

export function addTaskTag(taskId: number, tagId: number): void {
  getDb().prepare('INSERT OR IGNORE INTO task_tag_map (task_id, tag_id) VALUES (?, ?)').run(taskId, tagId)
}

export function removeTaskTag(taskId: number, tagId: number): void {
  getDb().prepare('DELETE FROM task_tag_map WHERE task_id = ? AND tag_id = ?').run(taskId, tagId)
}
