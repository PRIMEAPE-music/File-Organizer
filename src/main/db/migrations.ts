import type Database from 'better-sqlite3'

/**
 * Schema migrations, keyed on SQLite's `PRAGMA user_version`.
 *
 * WHY THIS EXISTS: the original `initSchema()` was `CREATE TABLE IF NOT EXISTS`
 * only. That works for brand-new tables but silently does nothing for
 * `ALTER TABLE`, so any column added later would never reach an existing
 * install. Every schema change from now on must be a numbered migration.
 *
 * IMPORTANT — migration 1 is the verbatim body of the old `initSchema()`.
 * Existing installs already have every one of those objects but still report
 * `user_version = 0`, so migration 1 *will* re-run against a populated
 * database. That is safe only because every statement in it is idempotent
 * (`IF NOT EXISTS`, or guarded by a `pragma_table_info` / `sqlite_master`
 * lookup). Never add a destructive or non-idempotent statement to migration 1.
 */
export interface Migration {
  version: number
  name: string
  up: (db: Database.Database) => void
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS scanned_folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          path TEXT NOT NULL UNIQUE,
          recursive INTEGER NOT NULL DEFAULT 1,
          added_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          color TEXT NOT NULL DEFAULT '#6366f1'
        );

        CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          color TEXT NOT NULL DEFAULT '#8b5cf6'
        );

        CREATE TABLE IF NOT EXISTS files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          folder_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          extension TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          size INTEGER NOT NULL DEFAULT 0,
          modified_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          category_id INTEGER,
          indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (folder_id) REFERENCES scanned_folders(id) ON DELETE CASCADE,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS file_tags (
          file_id INTEGER NOT NULL,
          tag_id INTEGER NOT NULL,
          PRIMARY KEY (file_id, tag_id),
          FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS favorites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          file_id INTEGER NOT NULL UNIQUE,
          added_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS recents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          file_id INTEGER NOT NULL,
          opened_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
        CREATE INDEX IF NOT EXISTS idx_files_category ON files(category_id);
        CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);
        CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
        CREATE INDEX IF NOT EXISTS idx_recents_opened ON recents(opened_at DESC);

        -- ─── Notes Domain ───

        CREATE TABLE IF NOT EXISTS note_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          color TEXT NOT NULL DEFAULT '#6366f1'
        );

        CREATE TABLE IF NOT EXISTS note_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          color TEXT NOT NULL DEFAULT '#8b5cf6'
        );

        CREATE TABLE IF NOT EXISTS notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL DEFAULT 'Untitled',
          content TEXT NOT NULL DEFAULT '',
          category_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (category_id) REFERENCES note_categories(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS note_tag_map (
          note_id INTEGER NOT NULL,
          tag_id INTEGER NOT NULL,
          PRIMARY KEY (note_id, tag_id),
          FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES note_tags(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category_id);
        CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);

        -- ─── Tasks Domain ───

        CREATE TABLE IF NOT EXISTS task_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          color TEXT NOT NULL DEFAULT '#6366f1'
        );

        CREATE TABLE IF NOT EXISTS task_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          color TEXT NOT NULL DEFAULT '#8b5cf6'
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'todo',
          priority TEXT NOT NULL DEFAULT 'medium',
          due_date TEXT,
          sort_order REAL NOT NULL DEFAULT 0,
          category_id INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (category_id) REFERENCES task_categories(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS task_tag_map (
          task_id INTEGER NOT NULL,
          tag_id INTEGER NOT NULL,
          PRIMARY KEY (task_id, tag_id),
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES task_tags(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
        CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_sort ON tasks(sort_order);
      `)

      // Pre-user_version installs may predate the `recursive` column.
      const hasRecursive = db
        .prepare("SELECT COUNT(*) as cnt FROM pragma_table_info('scanned_folders') WHERE name='recursive'")
        .get() as { cnt: number }
      if (hasRecursive.cnt === 0) {
        db.exec('ALTER TABLE scanned_folders ADD COLUMN recursive INTEGER NOT NULL DEFAULT 1')
      }

      // FTS5 virtual table for full-text search
      const ftsExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='files_fts'")
        .get()
      if (!ftsExists) {
        db.exec(`
          CREATE VIRTUAL TABLE files_fts USING fts5(name, path, content='files', content_rowid='id');

          CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
            INSERT INTO files_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
          END;

          CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
            INSERT INTO files_fts(files_fts, rowid, name, path) VALUES('delete', old.id, old.name, old.path);
          END;

          CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
            INSERT INTO files_fts(files_fts, rowid, name, path) VALUES('delete', old.id, old.name, old.path);
            INSERT INTO files_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
          END;
        `)
      }
    }
  }
]

export function getSchemaVersion(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true })) || 0
}

/**
 * Applies every migration newer than the database's current `user_version`, in
 * ascending order. Each migration plus its version bump runs inside a single
 * transaction, so a failing migration rolls back completely instead of leaving
 * a half-migrated schema behind (and the version stays put, so it retries next
 * launch). Throws on failure — a database we cannot migrate is not one we
 * should keep writing to.
 */
export function runMigrations(db: Database.Database): void {
  const pending = [...migrations].sort((a, b) => a.version - b.version)

  const seen = new Set<number>()
  for (const m of pending) {
    if (m.version < 1) throw new Error(`Migration versions must be >= 1 (got ${m.version})`)
    if (seen.has(m.version)) throw new Error(`Duplicate migration version ${m.version}`)
    seen.add(m.version)
  }

  const startVersion = getSchemaVersion(db)

  for (const m of pending) {
    if (m.version <= startVersion) continue

    const apply = db.transaction(() => {
      m.up(db)
      // Version is a validated number from our own table, never user input.
      db.pragma(`user_version = ${Number(m.version)}`)
    })

    try {
      apply()
    } catch (err) {
      throw new Error(
        `Migration ${m.version} (${m.name}) failed and was rolled back: ${(err as Error).message}`
      )
    }

    console.log(`[db] applied migration ${m.version} — ${m.name}`)
  }

  const endVersion = getSchemaVersion(db)
  if (endVersion === startVersion) {
    console.log(`[db] schema up to date at version ${endVersion}`)
  }
}
