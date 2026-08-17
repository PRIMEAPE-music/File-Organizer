import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import { runMigrations } from './migrations'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'file-organizer.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    // Schema lives in db/migrations.ts, gated on PRAGMA user_version, so that
    // ALTER TABLE changes actually reach existing installs. Migration 1 is the
    // verbatim former initSchema() body.
    runMigrations(db)
  }
  return db
}

export function closeDb(): void {
  if (!db) return
  const handle = db
  // Clear the singleton FIRST, and unconditionally. Leaving the closed handle
  // cached made `getDb()`'s `if (!db)` guard skip re-opening and hand back a
  // dead connection ("The database connection is not open") to anything that ran
  // afterwards — an IPC call draining after teardown, for instance. Nulling it
  // lets the singleton recover by re-opening.
  db = null
  try {
    handle.close()
  } catch (err) {
    console.error(`[db] close failed: ${(err as Error).message}`)
  }
}
