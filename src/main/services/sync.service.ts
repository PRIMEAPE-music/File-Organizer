import { app, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import { getDb } from '../db/database'
import type { SyncConfig, SyncResult, SyncPreferences } from '../../shared/types'

// ─── Internal Types ───────────────────────────────────────────────────────────

interface SyncPayload {
  version: number
  exportedAt: string
  categories: Array<{ name: string; color: string }>
  tags: Array<{ name: string; color: string }>
  fileAssignments: Array<{ path: string; categoryName: string | null; tagNames: string[] }>
  favorites: string[]
  noteCategories: Array<{ name: string; color: string }>
  noteTags: Array<{ name: string; color: string }>
  notes: Array<{
    title: string
    content: string
    categoryName: string | null
    tagNames: string[]
    created_at: string
    updated_at: string
  }>
  taskCategories: Array<{ name: string; color: string }>
  taskTags: Array<{ name: string; color: string }>
  tasks: Array<{
    title: string
    description: string
    status: string
    priority: string
    due_date: string | null
    sort_order: number
    categoryName: string | null
    tagNames: string[]
    created_at: string
    updated_at: string
  }>
  preferences: SyncPreferences
}

// ─── File Paths ───────────────────────────────────────────────────────────────

const configPath = (): string => path.join(app.getPath('userData'), 'sync-config.json')
const syncedPrefsPath = (): string => path.join(app.getPath('userData'), 'synced-prefs.json')
const syncFilePath = (syncPath: string): string => path.join(syncPath, 'file-organizer-sync.json')

// ─── Config ──────────────────────────────────────────────────────────────────

export function getSyncConfig(): SyncConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as SyncConfig
  } catch {
    return { enabled: false, syncPath: '', lastSyncedAt: null, autoSync: true }
  }
}

export function setSyncConfig(config: SyncConfig): void {
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2))
}

export function getSyncedPrefs(): SyncPreferences | null {
  try {
    return JSON.parse(fs.readFileSync(syncedPrefsPath(), 'utf-8')) as SyncPreferences
  } catch {
    return null
  }
}

export function clearSyncedPrefs(): void {
  try {
    fs.unlinkSync(syncedPrefsPath())
  } catch {
    // ignore
  }
}

export function selectSyncFolder(): string | null {
  const result = dialog.showOpenDialogSync({ properties: ['openDirectory'] })
  return result?.[0] ?? null
}

// ─── Current prefs (updated live from renderer) ───────────────────────────────

let currentPrefs: SyncPreferences = { theme: 'dark', viewMode: 'list', sidebarCollapsed: false, activeTab: 'files' }

export function updateCurrentPrefs(prefs: SyncPreferences): void {
  currentPrefs = prefs
}

export function getCurrentPrefs(): SyncPreferences {
  return currentPrefs
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function exportData(preferences: SyncPreferences): SyncResult {
  const config = getSyncConfig()
  if (!config.enabled || !config.syncPath) {
    return { success: false, message: 'Sync is not configured' }
  }

  try {
    const db = getDb()

    const categories = db.prepare('SELECT name, color FROM categories ORDER BY name').all() as Array<{ name: string; color: string }>
    const tags = db.prepare('SELECT name, color FROM tags ORDER BY name').all() as Array<{ name: string; color: string }>

    // Only include files that have a category or tags assigned
    const assignedFiles = db.prepare(`
      SELECT f.path, c.name as categoryName
      FROM files f
      LEFT JOIN categories c ON c.id = f.category_id
      WHERE f.category_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id)
    `).all() as Array<{ path: string; categoryName: string | null }>

    const fileTagsStmt = db.prepare(`
      SELECT t.name FROM tags t
      INNER JOIN file_tags ft ON ft.tag_id = t.id
      INNER JOIN files f ON f.id = ft.file_id
      WHERE f.path = ?
    `)

    const fileAssignments = assignedFiles.map(f => ({
      path: f.path,
      categoryName: f.categoryName,
      tagNames: (fileTagsStmt.all(f.path) as Array<{ name: string }>).map(t => t.name)
    }))

    const favorites = (db.prepare(`
      SELECT f.path FROM files f INNER JOIN favorites fav ON fav.file_id = f.id
    `).all() as Array<{ path: string }>).map(f => f.path)

    const noteCategories = db.prepare('SELECT name, color FROM note_categories ORDER BY name').all() as Array<{ name: string; color: string }>
    const noteTags = db.prepare('SELECT name, color FROM note_tags ORDER BY name').all() as Array<{ name: string; color: string }>

    const rawNotes = db.prepare(`
      SELECT n.id, n.title, n.content, nc.name as categoryName, n.created_at, n.updated_at
      FROM notes n LEFT JOIN note_categories nc ON nc.id = n.category_id
    `).all() as Array<{ id: number; title: string; content: string; categoryName: string | null; created_at: string; updated_at: string }>

    const noteTagsStmt = db.prepare(`
      SELECT t.name FROM note_tags t INNER JOIN note_tag_map m ON m.tag_id = t.id WHERE m.note_id = ?
    `)
    const notes = rawNotes.map(n => ({
      title: n.title,
      content: n.content,
      categoryName: n.categoryName,
      tagNames: (noteTagsStmt.all(n.id) as Array<{ name: string }>).map(t => t.name),
      created_at: n.created_at,
      updated_at: n.updated_at
    }))

    const taskCategories = db.prepare('SELECT name, color FROM task_categories ORDER BY name').all() as Array<{ name: string; color: string }>
    const taskTags = db.prepare('SELECT name, color FROM task_tags ORDER BY name').all() as Array<{ name: string; color: string }>

    const rawTasks = db.prepare(`
      SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date, t.sort_order,
             tc.name as categoryName, t.created_at, t.updated_at
      FROM tasks t LEFT JOIN task_categories tc ON tc.id = t.category_id
      ORDER BY t.sort_order
    `).all() as Array<{ id: number; title: string; description: string; status: string; priority: string; due_date: string | null; sort_order: number; categoryName: string | null; created_at: string; updated_at: string }>

    const taskTagsStmt = db.prepare(`
      SELECT tg.name FROM task_tags tg INNER JOIN task_tag_map m ON m.tag_id = tg.id WHERE m.task_id = ?
    `)
    const tasks = rawTasks.map(t => ({
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      due_date: t.due_date,
      sort_order: t.sort_order,
      categoryName: t.categoryName,
      tagNames: (taskTagsStmt.all(t.id) as Array<{ name: string }>).map(tg => tg.name),
      created_at: t.created_at,
      updated_at: t.updated_at
    }))

    const exportedAt = new Date().toISOString()
    const payload: SyncPayload = {
      version: 1,
      exportedAt,
      categories, tags, fileAssignments, favorites,
      noteCategories, noteTags, notes,
      taskCategories, taskTags, tasks,
      preferences
    }

    fs.writeFileSync(syncFilePath(config.syncPath), JSON.stringify(payload, null, 2), 'utf-8')

    config.lastSyncedAt = exportedAt
    setSyncConfig(config)

    return { success: true, message: `Synced at ${new Date(exportedAt).toLocaleTimeString()}`, exportedAt }
  } catch (err) {
    return { success: false, message: `Export failed: ${(err as Error).message}` }
  }
}

// ─── Import ──────────────────────────────────────────────────────────────────

export function importData(): { result: SyncResult; preferences: SyncPreferences | null } {
  const config = getSyncConfig()
  if (!config.enabled || !config.syncPath) {
    return { result: { success: false, message: 'Sync is not configured' }, preferences: null }
  }

  const filePath = syncFilePath(config.syncPath)

  try {
    if (!fs.existsSync(filePath)) {
      return { result: { success: false, message: 'No sync file found at the configured path' }, preferences: null }
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SyncPayload
    const db = getDb()

    db.transaction(() => {
      // Categories
      const catUpsert = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET color = excluded.color')
      for (const c of data.categories) catUpsert.run(c.name, c.color)

      // Tags
      const tagUpsert = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET color = excluded.color')
      for (const t of data.tags) tagUpsert.run(t.name, t.color)

      // File assignments — apply only to files that exist locally
      const getFileId = db.prepare('SELECT id FROM files WHERE path = ?')
      const getCatId = db.prepare('SELECT id FROM categories WHERE name = ?')
      const getTagId = db.prepare('SELECT id FROM tags WHERE name = ?')
      const setFileCat = db.prepare('UPDATE files SET category_id = ? WHERE id = ?')
      const clearFileTags = db.prepare('DELETE FROM file_tags WHERE file_id = ?')
      const addFileTag = db.prepare('INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)')

      for (const fa of data.fileAssignments) {
        const file = getFileId.get(fa.path) as { id: number } | undefined
        if (!file) continue
        const cat = fa.categoryName ? (getCatId.get(fa.categoryName) as { id: number } | undefined) : null
        setFileCat.run(cat?.id ?? null, file.id)
        clearFileTags.run(file.id)
        for (const tagName of fa.tagNames) {
          const tag = getTagId.get(tagName) as { id: number } | undefined
          if (tag) addFileTag.run(file.id, tag.id)
        }
      }

      // Favorites
      const addFav = db.prepare('INSERT OR IGNORE INTO favorites (file_id) VALUES (?)')
      for (const favPath of data.favorites) {
        const file = getFileId.get(favPath) as { id: number } | undefined
        if (file) addFav.run(file.id)
      }

      // Note categories
      const noteCatUpsert = db.prepare('INSERT INTO note_categories (name, color) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET color = excluded.color')
      for (const nc of data.noteCategories) noteCatUpsert.run(nc.name, nc.color)

      // Note tags
      const noteTagUpsert = db.prepare('INSERT INTO note_tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET color = excluded.color')
      for (const nt of data.noteTags) noteTagUpsert.run(nt.name, nt.color)

      // Notes — merge (upsert by created_at; never delete local-only notes)
      const getNoteCatId = db.prepare('SELECT id FROM note_categories WHERE name = ?')
      const getNoteTagId = db.prepare('SELECT id FROM note_tags WHERE name = ?')
      const getNoteByCreatedAt = db.prepare('SELECT id, updated_at FROM notes WHERE created_at = ?')
      const noteInsert = db.prepare('INSERT INTO notes (title, content, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      const noteUpdate = db.prepare('UPDATE notes SET title=?, content=?, category_id=?, updated_at=? WHERE id=?')
      const clearNoteTags = db.prepare('DELETE FROM note_tag_map WHERE note_id = ?')
      const noteTagInsert = db.prepare('INSERT OR IGNORE INTO note_tag_map (note_id, tag_id) VALUES (?, ?)')

      for (const note of data.notes) {
        const cat = note.categoryName ? (getNoteCatId.get(note.categoryName) as { id: number } | undefined) : null
        const existing = getNoteByCreatedAt.get(note.created_at) as { id: number; updated_at: string } | undefined
        let noteId: number
        if (existing) {
          if (note.updated_at > existing.updated_at) {
            noteUpdate.run(note.title, note.content, cat?.id ?? null, note.updated_at, existing.id)
          }
          noteId = existing.id
        } else {
          const info = noteInsert.run(note.title, note.content, cat?.id ?? null, note.created_at, note.updated_at)
          noteId = info.lastInsertRowid as number
        }
        clearNoteTags.run(noteId)
        for (const tagName of note.tagNames) {
          const tag = getNoteTagId.get(tagName) as { id: number } | undefined
          if (tag) noteTagInsert.run(noteId, tag.id)
        }
      }

      // Task categories
      const taskCatUpsert = db.prepare('INSERT INTO task_categories (name, color) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET color = excluded.color')
      for (const tc of data.taskCategories) taskCatUpsert.run(tc.name, tc.color)

      // Task tags
      const taskTagUpsert = db.prepare('INSERT INTO task_tags (name, color) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET color = excluded.color')
      for (const tt of data.taskTags) taskTagUpsert.run(tt.name, tt.color)

      // Tasks — merge (upsert by created_at; never delete local-only tasks)
      const getTaskCatId = db.prepare('SELECT id FROM task_categories WHERE name = ?')
      const getTaskTagId = db.prepare('SELECT id FROM task_tags WHERE name = ?')
      const getTaskByCreatedAt = db.prepare('SELECT id, updated_at FROM tasks WHERE created_at = ?')
      const taskInsert = db.prepare(`
        INSERT INTO tasks (title, description, status, priority, due_date, sort_order, category_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const taskUpdate = db.prepare(`
        UPDATE tasks SET title=?, description=?, status=?, priority=?, due_date=?, sort_order=?, category_id=?, updated_at=? WHERE id=?
      `)
      const clearTaskTags = db.prepare('DELETE FROM task_tag_map WHERE task_id = ?')
      const taskTagInsert = db.prepare('INSERT OR IGNORE INTO task_tag_map (task_id, tag_id) VALUES (?, ?)')

      for (const task of data.tasks) {
        const cat = task.categoryName ? (getTaskCatId.get(task.categoryName) as { id: number } | undefined) : null
        const existing = getTaskByCreatedAt.get(task.created_at) as { id: number; updated_at: string } | undefined
        let taskId: number
        if (existing) {
          if (task.updated_at > existing.updated_at) {
            taskUpdate.run(task.title, task.description, task.status, task.priority, task.due_date, task.sort_order, cat?.id ?? null, task.updated_at, existing.id)
          }
          taskId = existing.id
        } else {
          const info = taskInsert.run(
            task.title, task.description, task.status, task.priority,
            task.due_date, task.sort_order, cat?.id ?? null,
            task.created_at, task.updated_at
          )
          taskId = info.lastInsertRowid as number
        }
        clearTaskTags.run(taskId)
        for (const tagName of task.tagNames) {
          const tag = getTaskTagId.get(tagName) as { id: number } | undefined
          if (tag) taskTagInsert.run(taskId, tag.id)
        }
      }
    })()

    // Persist synced prefs so renderer can apply them on next startup
    fs.writeFileSync(syncedPrefsPath(), JSON.stringify(data.preferences, null, 2))

    config.lastSyncedAt = data.exportedAt
    setSyncConfig(config)

    return {
      result: { success: true, message: `Synced from ${new Date(data.exportedAt).toLocaleString()}`, exportedAt: data.exportedAt },
      preferences: data.preferences
    }
  } catch (err) {
    return { result: { success: false, message: `Import failed: ${(err as Error).message}` }, preferences: null }
  }
}

// ─── Startup check ────────────────────────────────────────────────────────────

export function shouldAutoImport(): boolean {
  const config = getSyncConfig()
  if (!config.enabled || !config.autoSync || !config.syncPath) return false

  try {
    const filePath = syncFilePath(config.syncPath)
    if (!fs.existsSync(filePath)) return false
    const { exportedAt } = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { exportedAt: string }
    if (!config.lastSyncedAt) return true
    return new Date(exportedAt) > new Date(config.lastSyncedAt)
  } catch {
    return false
  }
}
