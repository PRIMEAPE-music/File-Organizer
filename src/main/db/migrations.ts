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
  },
  {
    version: 2,
    name: 'reminders',
    up: (db) => {
      // Plain DDL is fine from migration 2 onwards: the runner wraps each
      // migration and its version bump in one transaction, so this either
      // applies whole or not at all, and it only ever runs once.
      db.exec(`
        CREATE TABLE reminders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          -- Cross-machine identity for sync, generated by SQLite itself.
          --
          -- Notes and tasks merge on created_at, and the plan here was to match
          -- that. It does not survive contact: created_at is only as unique as the
          -- clock's resolution, and reminders are created in bursts — saving one
          -- high-priority task with "Remind me" ticked writes the auto reminder
          -- and the manual one in the SAME millisecond. Two rows then share the
          -- merge key, and the receiving machine either drops the second as a
          -- duplicate of the first or inserts a fresh copy on every later import.
          -- Both were reproduced before this column existed.
          --
          -- UNIQUE is the real guarantee: even if the merge logic slipped, the
          -- database refuses a second copy of the same reminder.
          sync_id TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
          title TEXT NOT NULL,
          body TEXT,
          -- 'task' | 'note' | NULL for a standalone reminder. Deliberately not a
          -- foreign key: one column cannot reference two tables, and the owning
          -- rows are cleaned up explicitly (see reminders.repo).
          entity_type TEXT,
          entity_id INTEGER,
          -- ISO instant (toISOString) of the first firing. Every later firing is
          -- derived from this anchor in LOCAL time, never by adding fixed ms.
          fire_at TEXT NOT NULL,
          -- NULL = one-off.
          freq TEXT,
          interval INTEGER NOT NULL DEFAULT 1,
          -- Weekly only: comma-separated 0-6, 0 = Sunday.
          byweekday TEXT,
          lead_time_min INTEGER NOT NULL DEFAULT 0,
          -- STARTING tier. escalate_after_min bumps it one rung at a time.
          intensity TEXT NOT NULL DEFAULT 'toast',
          escalate_after_min INTEGER,
          sound TEXT,
          -- 1 = derived from a task by the automation. Hand-made reminders
          -- (0) are never touched by it.
          auto_created INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          -- MILLISECOND precision, unlike tasks/notes' datetime('now').
          --
          -- created_at is the sync merge key. At one-second resolution two
          -- reminders created in the same second share a key, and the importer on
          -- the other machine treats the second one as an already-seen copy of the
          -- first and drops it. That is not hypothetical: saving a high-priority
          -- task with "Remind me" ticked creates the auto reminder and the manual
          -- one back to back, inside the same second, every time.
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );

        -- Occurrences are MATERIALISED rather than computed on read, so that a
        -- per-instance snooze/acknowledge has a row to live in and a cold start
        -- can tell "already fired" from "missed while the app was down".
        CREATE TABLE reminder_occurrences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
          fire_at TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'pending',
          current_tier TEXT,
          fired_at TEXT,
          acknowledged_at TEXT,
          snoozed_until TEXT,
          snooze_count INTEGER NOT NULL DEFAULT 0,
          UNIQUE(reminder_id, fire_at)
        );

        -- The scheduler's hot query: every tick asks for pending/snoozed rows
        -- that are due, so state leads and fire_at follows.
        CREATE INDEX idx_occurrences_state_fire ON reminder_occurrences(state, fire_at);
        CREATE INDEX idx_occurrences_reminder ON reminder_occurrences(reminder_id);
        CREATE INDEX idx_reminders_entity ON reminders(entity_type, entity_id);
        CREATE INDEX idx_reminders_enabled ON reminders(enabled);
      `)
    }
  },
  {
    version: 3,
    name: 'notes-tasks-sync-id',
    up: (db) => {
      /**
       * Give notes and tasks the same stable cross-machine identity reminders
       * already have.
       *
       * WHAT THIS FIXES: both tables were merged by sync on `created_at`, whose
       * default is `datetime('now')` — ONE SECOND of resolution. Two notes created
       * in the same second exported as two entries with an identical merge key.
       * The receiving machine then kept only one of them (the second import
       * overwrote the row the first had just inserted), and when it exported back,
       * the originating machine resolved that key to its lowest rowid and
       * overwrote the *first* note's title and content too. The user's text was
       * destroyed on both machines, with no later sync able to recover it. A
       * double-click on "New note" was enough to reach it.
       *
       * WHY THIS SHAPE, and not `sync_id TEXT NOT NULL UNIQUE DEFAULT
       * (lower(hex(randomblob(16))))` as `reminders` declares:
       *
       *  - SQLite's ALTER TABLE ADD COLUMN refuses "Cannot add a UNIQUE column"
       *    and "Cannot add a column with non-constant default". Both were checked
       *    against the bundled SQLite (3.49.2), not assumed.
       *  - The usual answer — rebuild the table — is UNSAFE here. `note_tag_map`
       *    and `task_tag_map` reference these tables with ON DELETE CASCADE, and
       *    `DROP TABLE` performs an implicit DELETE that fires foreign key
       *    actions. `PRAGMA foreign_keys` cannot be turned off from inside a
       *    transaction (it is silently a no-op), and the migration runner wraps
       *    every migration in one. A rebuild here therefore deletes every note tag
       *    and task tag assignment. Verified: the child table went from 1 row to 0
       *    on `DROP TABLE notes`.
       *
       * So: a plain column, a per-row backfill, a UNIQUE INDEX for the constraint,
       * and an AFTER INSERT trigger to generate the value for every future row
       * whatever code path inserts it. That is the same guarantee by three
       * statements instead of one.
       */
      for (const table of ['notes', 'tasks'] as const) {
        const hasColumn = db
          .prepare(`SELECT COUNT(*) AS cnt FROM pragma_table_info('${table}') WHERE name = 'sync_id'`)
          .get() as { cnt: number }
        if (hasColumn.cnt === 0) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN sync_id TEXT`)
        }

        /**
         * Backfill, and the part to be careful about: `randomblob()` must be
         * evaluated once PER ROW.
         *
         * It is, in this form — 500 existing rows produced 500 distinct ids. Note
         * what does NOT work: `SET sync_id = (SELECT lower(hex(randomblob(16))))`
         * is a constant subquery, evaluated once, and gives every row the SAME id
         * — which would then fail the unique index below, and if it somehow did
         * not, would make every note a duplicate of every other note on the next
         * sync. Keep this expression inline.
         */
        db.exec(`UPDATE ${table} SET sync_id = lower(hex(randomblob(16))) WHERE sync_id IS NULL`)

        // The real guarantee. A unique index permits multiple NULLs, which is why
        // the trigger below exists rather than this standing alone.
        db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_sync_id ON ${table}(sync_id)`)

        // Every insert gets an id, including inserts from code that has never
        // heard of the column (the sync importer's INSERT, for one). An explicit
        // sync_id — what the importer supplies for a row from another machine — is
        // left exactly as given.
        db.exec(`
          CREATE TRIGGER IF NOT EXISTS ${table}_sync_id_ai AFTER INSERT ON ${table}
          WHEN new.sync_id IS NULL
          BEGIN
            UPDATE ${table} SET sync_id = lower(hex(randomblob(16))) WHERE id = new.id;
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
