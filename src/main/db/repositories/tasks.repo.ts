import { getDb } from '../database'
import { NOW_MS_EXPR } from '../timestamp'
import type { Task, TaskWithMeta, TaskFilterState, TaskCategory, TaskTag, TaskStatus } from '../../../shared/types'

function enrichTask(task: Task): TaskWithMeta {
  const db = getDb()
  const category = task.category_id
    ? (db.prepare('SELECT * FROM task_categories WHERE id = ?').get(task.category_id) as TaskCategory | undefined) ?? null
    : null
  const tags = db.prepare(`
    SELECT t.* FROM task_tags t
    INNER JOIN task_tag_map m ON m.tag_id = t.id
    WHERE m.task_id = ?
  `).all(task.id) as TaskTag[]
  return { ...task, category, tags }
}

export function getTasks(filter: TaskFilterState): TaskWithMeta[] {
  const db = getDb()
  let query = 'SELECT * FROM tasks'
  const conditions: string[] = []
  const params: unknown[] = []

  if (filter.search) {
    conditions.push('(title LIKE ? OR description LIKE ?)')
    const term = `%${filter.search}%`
    params.push(term, term)
  }

  const view = filter.sidebarView
  if (view.type === 'status') {
    conditions.push('status = ?')
    params.push(view.status)
  } else if (view.type === 'priority') {
    conditions.push('priority = ?')
    params.push(view.priority)
  } else if (view.type === 'category') {
    conditions.push('category_id = ?')
    params.push(view.id)
  } else if (view.type === 'tag') {
    conditions.push('id IN (SELECT task_id FROM task_tag_map WHERE tag_id = ?)')
    params.push(view.id)
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }

  const dir = filter.sortDirection === 'asc' ? 'ASC' : 'DESC'
  query += ` ORDER BY ${filter.sortField} ${dir}`

  const tasks = db.prepare(query).all(...params) as Task[]
  return tasks.map(enrichTask)
}

export function getTaskById(id: number): TaskWithMeta | undefined {
  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined
  return task ? enrichTask(task) : undefined
}

export function createTask(data: {
  title: string
  description?: string
  status?: string
  priority?: string
  due_date?: string | null
  category_id?: number | null
}): TaskWithMeta {
  const db = getDb()
  // Get max sort_order for the target status
  const status = data.status || 'todo'
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM tasks WHERE status = ?').get(status) as { m: number | null }
  const sortOrder = (maxOrder.m ?? 0) + 1000

  // Explicit millisecond timestamps, not the second-resolution column defaults:
  // `created_at` is a sync merge key and two tasks created in the same second used
  // to collide (see NOW_MS_EXPR). `sync_id` comes from the migration-3 trigger.
  const info = db.prepare(`
    INSERT INTO tasks (title, description, status, priority, due_date, sort_order, category_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ${NOW_MS_EXPR}, ${NOW_MS_EXPR})
  `).run(
    data.title,
    data.description || '',
    status,
    data.priority || 'medium',
    data.due_date || null,
    sortOrder,
    data.category_id || null
  )
  return enrichTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid) as Task)
}

export function updateTask(id: number, data: {
  title?: string
  description?: string
  status?: string
  priority?: string
  due_date?: string | null
  category_id?: number | null
}): TaskWithMeta {
  const db = getDb()
  const current = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task
  db.prepare(`
    UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, category_id = ?, updated_at = ${NOW_MS_EXPR}
    WHERE id = ?
  `).run(
    data.title ?? current.title,
    data.description ?? current.description,
    data.status ?? current.status,
    data.priority ?? current.priority,
    data.due_date !== undefined ? data.due_date : current.due_date,
    data.category_id !== undefined ? data.category_id : current.category_id,
    id
  )
  return enrichTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task)
}

export function deleteTask(id: number): void {
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id)
}

export function reorderTask(id: number, status: TaskStatus, sortOrder: number): void {
  getDb().prepare(`UPDATE tasks SET status = ?, sort_order = ?, updated_at = ${NOW_MS_EXPR} WHERE id = ?`).run(status, sortOrder, id)
}

export function setTaskCategory(taskId: number, categoryId: number | null): void {
  getDb().prepare('UPDATE tasks SET category_id = ? WHERE id = ?').run(categoryId, taskId)
}
