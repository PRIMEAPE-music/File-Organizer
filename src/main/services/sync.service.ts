import { app, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import { getDb } from '../db/database'
import { dedupeAllAutoReminders } from '../db/repositories/reminders.repo'
import { loadJson, writeJsonAtomic } from '../utils/safe-fs'
import { reportPersistenceIssue } from '../utils/error-reporter'
import { getAppPrefs, setAppPrefs } from './app-prefs.service'
import { sanitizeReminderSound } from '../../shared/reminder-sounds'
import type {
  AppPreferences,
  ReminderIntensity,
  SyncConfig,
  SyncResult,
  SyncPreferences,
  SyncSkipReason,
  TaskPriority
} from '../../shared/types'

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
const INTENSITIES: ReminderIntensity[] = ['toast', 'popup', 'blackout']
const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly']

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
  notes: SyncNote[]
  taskCategories: Array<{ name: string; color: string }>
  taskTags: Array<{ name: string; color: string }>
  tasks: SyncTask[]
  /**
   * Reminder DEFINITIONS only. `reminder_occurrences` is deliberately excluded:
   * fired/acknowledged/snoozed state is per-machine. Syncing it would let one
   * machine's "I dealt with this" silently cancel the alert on the machine the
   * user is actually sitting at, which is the opposite of what a reminder is for.
   *
   * OPTIONAL ON READ (`data.reminders ?? []`). A machine still running the older
   * build writes a payload with no `reminders` key at all, and during a staged
   * rollout that must neither throw nor be read as "the remote has zero
   * reminders, delete mine". That is also why `version` stays at 1: bumping it
   * would imply the older build should refuse the payload, and it has no such
   * check — it would simply ignore the field, which is already the correct
   * behaviour.
   */
  reminders?: SyncReminder[]
  preferences: SyncPreferences
}

/**
 * THE MERGE KEY IS `sync_id`, for all three entities.
 *
 * Notes and tasks were merged on `created_at`, whose column default has one-second
 * resolution, and that was not a dropped-row bug — it destroyed data. Two notes
 * created in the same second exported with an identical key; the receiving machine
 * ended up with one note (the second insert's update overwrote the first row); it
 * then exported that back, and the originating machine resolved the shared key to
 * its lowest rowid and overwrote the first note's title and content too. Both
 * notes' original text was gone on both machines, unrecoverable by any later sync.
 *
 * `created_at` remains as a documented FALLBACK, for two cases that both matter:
 *  - a payload from a build that predates `sync_id` on notes/tasks, and
 *  - the first sync after that migration, where the same note already exists on
 *    both machines and each generated its own id locally. Matching by created_at
 *    there lets the two converge on one id instead of duplicating the note.
 * The fallback is de-duplicated with a `claimed` set, the same way the reminder
 * importer already does it, because the fallback key is not unique.
 */
interface SyncNote {
  sync_id?: string
  title: string
  content: string
  categoryName: string | null
  tagNames: string[]
  created_at: string
  updated_at: string
}

interface SyncTask {
  sync_id?: string
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
}

interface SyncReminder {
  /**
   * The merge key. Optional only for tolerance: no released build ever wrote a
   * reminders array, so in practice it is always present, but a payload missing
   * it falls back to created_at rather than throwing.
   */
  sync_id?: string
  title: string
  body: string | null
  entity_type: string | null
  /**
   * The linked task's `sync_id`.
   *
   * This used to be the task's `created_at`, and reminders therefore attached to
   * the WRONG TASK: `SELECT id FROM tasks WHERE created_at = ?` returns an
   * arbitrary row when two tasks were created in the same second, and a "Buy milk"
   * reminder was reproduced landing on a task called "Ship the thing". The
   * automation then compounded it — that row is `auto_created = 1` pointing at a
   * task it does not describe, so editing that task rewrote or deleted it.
   *
   * A legacy `created_at` value here still resolves (see the importer): the two
   * formats cannot be confused, since a sync_id is 32 hex characters.
   */
  entity_ref: string | null
  fire_at: string
  freq: string | null
  interval: number
  byweekday: string | null
  lead_time_min: number
  intensity: string
  escalate_after_min: number | null
  sound: string | null
  auto_created: number
  enabled: number
  created_at: string
  updated_at: string
}

// ─── File Paths ───────────────────────────────────────────────────────────────

const configPath = (): string => path.join(app.getPath('userData'), 'sync-config.json')
const syncedPrefsPath = (): string => path.join(app.getPath('userData'), 'synced-prefs.json')
const syncFilePath = (syncPath: string): string => path.join(syncPath, 'file-organizer-sync.json')

const DEFAULT_CONFIG: SyncConfig = { enabled: false, syncPath: '', lastSyncedAt: null, autoSync: true }

// ─── Config ──────────────────────────────────────────────────────────────────

/** Exported so IPC error reporting can name the real path, not a bare filename. */
export function getSyncConfigPath(): string {
  return configPath()
}

export function getSyncConfig(): SyncConfig {
  // Fresh copy of the default every call: callers mutate the returned config
  // (`config.lastSyncedAt = ...`), which would otherwise scribble on the shared
  // DEFAULT_CONFIG object.
  //
  // ownership 'local': this app is the only writer of sync-config.json, so a
  // file that doesn't parse really is damaged and quarantine + .bak restore is
  // the right response.
  const { data, issue } = loadJson<Partial<SyncConfig>>(
    configPath(),
    { ...DEFAULT_CONFIG },
    { ownership: 'local' }
  )
  if (issue) reportPersistenceIssue('corrupt', issue.file, issue.detail)

  // Field-by-field validation, the same shape check getAppPrefs does. safe-fs
  // already rejects a non-object, but this function feeds an *uncaught* startup
  // path (shouldAutoImport ← app.whenReady), and a throw there leaves a process
  // holding the single-instance lock with no window, no tray and no hotkey —
  // on every relaunch. Belt and braces.
  return {
    enabled: typeof data.enabled === 'boolean' ? data.enabled : DEFAULT_CONFIG.enabled,
    syncPath: typeof data.syncPath === 'string' ? data.syncPath : DEFAULT_CONFIG.syncPath,
    lastSyncedAt: typeof data.lastSyncedAt === 'string' ? data.lastSyncedAt : null,
    autoSync: typeof data.autoSync === 'boolean' ? data.autoSync : DEFAULT_CONFIG.autoSync
  }
}

/**
 * Throws on write failure. Callers either sit inside an existing try/catch that
 * turns it into a SyncResult, or route it through guardWrite.
 */
export function setSyncConfig(config: SyncConfig): void {
  writeJsonAtomic(configPath(), config)
}

export function getSyncedPrefs(): SyncPreferences | null {
  // Locally owned: written by importData, consumed and deleted by the renderer.
  const { data, issue } = loadJson<SyncPreferences | null>(syncedPrefsPath(), null, {
    ownership: 'local'
  })
  if (issue) reportPersistenceIssue('corrupt', issue.file, issue.detail)
  return data
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

// ─── Shared payload reads ─────────────────────────────────────────────────────

type SharedReadOutcome<T> =
  | { status: 'ok'; data: T }
  | { status: 'skip'; reason: SyncSkipReason; message: string }

/**
 * Read the payload that lives on the share — once — and turn every non-success
 * into "leave the share alone and retry next cycle".
 *
 * Three things this deliberately does NOT do:
 *
 *  - No `fs.existsSync` pre-check. On an unreachable UNC path existsSync returns
 *    `false`, which is exactly how a share outage came to be reported as "no
 *    sync file found". It also doubles the cost, and the first touch of a dead
 *    host blocks for seconds on name resolution. So: one access, then classify
 *    the error it produced.
 *
 *  - No quarantine and no `.bak` (ownership 'shared'). A partial read here is
 *    almost always another machine mid-write, and renaming the file would take
 *    that machine's data away from everyone.
 *
 *  - No progress recording. Callers must not advance `lastSyncedAt` on a skip.
 */
function readSharedPayload<T extends object>(filePath: string): SharedReadOutcome<T> {
  const outcome = loadJson<T | null>(filePath, null, { ownership: 'shared' })

  if (outcome.issue) {
    reportPersistenceIssue(
      outcome.status === 'unreachable' ? 'unreachable' : 'corrupt',
      outcome.issue.file,
      outcome.issue.detail
    )
  }

  switch (outcome.status) {
    case 'ok':
      // safe-fs classifies a non-object (including `null`) as damaged, so this
      // is never null in practice; the guard is for the type system.
      if (outcome.data) return { status: 'ok', data: outcome.data }
      return { status: 'skip', reason: 'unreadable', message: 'Sync file could not be read' }
    case 'missing':
      return {
        status: 'skip',
        reason: 'missing',
        message: 'No sync file found at the configured path'
      }
    case 'unreachable':
      return {
        status: 'skip',
        reason: 'unreachable',
        message: 'Sync folder is unreachable — check that the network share is available'
      }
    default:
      // 'skipped': the file did not parse and was left exactly as found.
      return {
        status: 'skip',
        reason: 'unreadable',
        message:
          'Sync file could not be read right now (another machine may be writing it) — will retry'
      }
  }
}

// ─── Current prefs (updated live from renderer) ───────────────────────────────

let currentPrefs: SyncPreferences = { theme: 'dark', viewMode: 'list', sidebarCollapsed: false, activeTab: 'files' }

export function updateCurrentPrefs(prefs: SyncPreferences): void {
  currentPrefs = prefs
}

export function getCurrentPrefs(): SyncPreferences {
  return currentPrefs
}

/**
 * Stamp the main process's reminder settings onto the renderer's prefs object.
 *
 * These belong in the payload because the task automation is only deterministic if
 * every machine decides from the same threshold and lead time. With machine A on
 * 'high' and machine B on 'urgent', a high-priority task got an auto reminder on A
 * and none on B: B's next edit of that task removed the reminder, A's next export
 * re-supplied it, and the two machines never stopped. The renderer does not own
 * these values, so they are read here rather than trusted from the caller.
 */
function withReminderPrefs(preferences: SyncPreferences): SyncPreferences {
  const app = getAppPrefs()
  return {
    ...preferences,
    reminderPriorityThreshold: app.reminderPriorityThreshold,
    reminderDefaultLeadMin: app.reminderDefaultLeadMin,
    reminderDefaultIntensity: app.reminderDefaultIntensity,
    reminderDefaultEscalateMin: app.reminderDefaultEscalateMin
  }
}

/**
 * Apply the reminder settings from an imported payload.
 *
 * Absent keys mean "the other machine predates this" and must leave local settings
 * alone — never reset them to defaults. `setAppPrefs` validates and clamps each
 * field itself, so a hostile payload cannot install a nonsense schedule; the
 * membership checks here just stop obviously wrong values reaching the file.
 */
function applyImportedReminderPrefs(preferences: SyncPreferences | undefined): void {
  if (!preferences || typeof preferences !== 'object') return

  const patch: Partial<AppPreferences> = {}
  if (PRIORITIES.includes(preferences.reminderPriorityThreshold as TaskPriority)) {
    patch.reminderPriorityThreshold = preferences.reminderPriorityThreshold as TaskPriority
  }
  if (
    typeof preferences.reminderDefaultLeadMin === 'number' &&
    Number.isFinite(preferences.reminderDefaultLeadMin)
  ) {
    patch.reminderDefaultLeadMin = preferences.reminderDefaultLeadMin
  }
  if (INTENSITIES.includes(preferences.reminderDefaultIntensity as ReminderIntensity)) {
    patch.reminderDefaultIntensity = preferences.reminderDefaultIntensity as ReminderIntensity
  }
  if (
    preferences.reminderDefaultEscalateMin === null ||
    (typeof preferences.reminderDefaultEscalateMin === 'number' &&
      Number.isFinite(preferences.reminderDefaultEscalateMin))
  ) {
    patch.reminderDefaultEscalateMin = preferences.reminderDefaultEscalateMin
  }

  if (Object.keys(patch).length === 0) return

  // Only write when something actually differs. Auto-import runs on every launch and
  // on every Sync Now, and rewriting app-prefs.json each time would be pure churn on
  // a file the user's own settings live in.
  const current = getAppPrefs()
  const changed = (Object.keys(patch) as (keyof AppPreferences)[]).some(
    (key) => patch[key] !== current[key]
  )
  if (!changed) return

  // Never fatal to an import: the database side has already committed by now, and
  // losing a settings write must not be reported as "import failed".
  try {
    setAppPrefs(patch)
    console.log('[sync] applied imported reminder settings')
  } catch (err) {
    console.error(`[sync] could not apply imported reminder settings: ${(err as Error).message}`)
  }
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function exportData(preferences: SyncPreferences): SyncResult {
  // Reading the config sits outside the main try below, and exportData runs from
  // the quit teardown — so an escaping throw here would skip every later
  // shutdown step. getSyncConfig is hardened against throwing, but this is the
  // caller that pays for it if that ever regresses.
  let config: SyncConfig
  try {
    config = getSyncConfig()
  } catch (err) {
    reportPersistenceIssue('corrupt', getSyncConfigPath(), (err as Error).message)
    return { success: false, message: `Export failed: ${(err as Error).message}` }
  }

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
      SELECT n.id, n.sync_id, n.title, n.content, nc.name as categoryName, n.created_at, n.updated_at
      FROM notes n LEFT JOIN note_categories nc ON nc.id = n.category_id
    `).all() as Array<{ id: number; sync_id: string; title: string; content: string; categoryName: string | null; created_at: string; updated_at: string }>

    const noteTagsStmt = db.prepare(`
      SELECT t.name FROM note_tags t INNER JOIN note_tag_map m ON m.tag_id = t.id WHERE m.note_id = ?
    `)
    const notes: SyncNote[] = rawNotes.map(n => ({
      sync_id: n.sync_id,
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
      SELECT t.id, t.sync_id, t.title, t.description, t.status, t.priority, t.due_date, t.sort_order,
             tc.name as categoryName, t.created_at, t.updated_at
      FROM tasks t LEFT JOIN task_categories tc ON tc.id = t.category_id
      ORDER BY t.sort_order
    `).all() as Array<{ id: number; sync_id: string; title: string; description: string; status: string; priority: string; due_date: string | null; sort_order: number; categoryName: string | null; created_at: string; updated_at: string }>

    const taskTagsStmt = db.prepare(`
      SELECT tg.name FROM task_tags tg INNER JOIN task_tag_map m ON m.tag_id = tg.id WHERE m.task_id = ?
    `)
    const tasks: SyncTask[] = rawTasks.map(t => ({
      sync_id: t.sync_id,
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

    // Reminder definitions.
    //
    // Auto-created reminders ARE exported, deliberately. The automation only ever
    // runs when a task is created or updated *through this app's UI*, so a task
    // that arrives on machine B by sync never passes through it — excluding auto
    // reminders would mean the high-priority task syncs across and then silently
    // has no reminder on the machine the user is actually using. Duplication is
    // not the risk it looks like: the receiving machine matches on `sync_id`, the
    // automation now keeps that id stable across a task's whole life, and the
    // importer collapses any duplicates an older build left behind.
    //
    // `entity_ref` is the task's sync_id, not its created_at — see SyncReminder.
    const rawReminders = db.prepare(`
      SELECT r.sync_id, r.title, r.body, r.entity_type, r.fire_at, r.freq, r.interval, r.byweekday,
             r.lead_time_min, r.intensity, r.escalate_after_min, r.sound,
             r.auto_created, r.enabled, r.created_at, r.updated_at,
             CASE WHEN r.entity_type = 'task' THEN t.sync_id ELSE NULL END AS entity_ref
      FROM reminders r
      LEFT JOIN tasks t ON r.entity_type = 'task' AND t.id = r.entity_id
      ORDER BY r.created_at
    `).all() as SyncReminder[]

    const reminders: SyncReminder[] = rawReminders.map(r => ({
      sync_id: r.sync_id,
      title: r.title,
      body: r.body,
      // A link we could not resolve locally becomes a standalone reminder rather
      // than one pointing at a row id that means something else over there.
      entity_type: r.entity_ref ? r.entity_type : null,
      entity_ref: r.entity_ref,
      fire_at: r.fire_at,
      freq: r.freq,
      interval: r.interval,
      byweekday: r.byweekday,
      lead_time_min: r.lead_time_min,
      intensity: r.intensity,
      escalate_after_min: r.escalate_after_min,
      sound: r.sound,
      auto_created: r.auto_created,
      enabled: r.enabled,
      created_at: r.created_at,
      updated_at: r.updated_at
    }))

    const exportedAt = new Date().toISOString()
    const payload: SyncPayload = {
      version: 1,
      exportedAt,
      categories, tags, fileAssignments, favorites,
      noteCategories, noteTags, notes,
      taskCategories, taskTags, tasks,
      reminders,
      preferences: withReminderPrefs(preferences)
    }

    // Atomic: the shared payload lives on a network share, where a torn write
    // is both likeliest and most damaging (every other machine reads this file).
    //
    // backup:false — a `.bak` next to the shared payload is a liability, not a
    // safety net: it is a snapshot of one machine's generation that any reader's
    // recovery path could republish over newer data. Nothing on the share gets a
    // backup file.
    writeJsonAtomic(syncFilePath(config.syncPath), payload, { backup: false })

    config.lastSyncedAt = exportedAt
    setSyncConfig(config)

    return { success: true, message: `Synced at ${new Date(exportedAt).toLocaleTimeString()}`, exportedAt }
  } catch (err) {
    // The auto-export on quit discards this result, so make the failure visible
    // here rather than letting a lost export pass silently.
    reportPersistenceIssue('write-failed', syncFilePath(config.syncPath), (err as Error).message)
    return { success: false, message: `Export failed: ${(err as Error).message}` }
  }
}

// ─── Reminder payload validation ──────────────────────────────────────────────

/** Every column the importer writes, already checked and coerced. */
interface NormalisedReminder {
  sync_id: string | null
  title: string
  body: string | null
  entity_type: string | null
  entity_ref: string | null
  fire_at: string
  freq: string | null
  interval: number
  byweekday: string | null
  lead_time_min: number
  intensity: string
  escalate_after_min: number | null
  sound: string | null
  auto_created: number
  enabled: number
  created_at: string
  updated_at: string
}

/** A timestamp we can both store (NOT NULL) and order by. */
function usableTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return Number.isFinite(Date.parse(trimmed)) ? trimmed : null
}

/**
 * Check and coerce one reminder from the payload, or return null to skip it.
 *
 * WHY EVERY FIELD AND NOT JUST TWO: the importer runs inside one transaction over
 * the whole payload. A single reminder with a missing `created_at` used to raise
 * `NOT NULL constraint failed` deep inside that transaction and roll back
 * everything — including the notes and tasks that had merged perfectly. Skipping a
 * bad row costs one reminder; aborting costs the entire sync.
 *
 * Required (identity and schedule, unrecoverable if wrong): title, fire_at,
 * created_at. Everything else is coerced to a sane value, because a reminder that
 * fires at the right time with a defaulted tier is worth having and a discarded one
 * is not. `updated_at` falls back to `created_at`, which loses last-write-wins
 * against the local copy — the conservative direction.
 */
function normaliseSyncReminder(raw: unknown): NormalisedReminder | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const title = typeof r.title === 'string' ? r.title.trim() : ''
  if (!title) return null

  const fireAt = usableTimestamp(r.fire_at)
  if (!fireAt) return null

  const createdAt = usableTimestamp(r.created_at)
  if (!createdAt) return null

  const interval = typeof r.interval === 'number' && Number.isInteger(r.interval) && r.interval > 0
    ? r.interval
    : 1
  const leadTime = typeof r.lead_time_min === 'number' && Number.isFinite(r.lead_time_min)
    ? Math.max(0, Math.round(r.lead_time_min))
    : 0
  const escalate = typeof r.escalate_after_min === 'number' &&
    Number.isFinite(r.escalate_after_min) &&
    r.escalate_after_min > 0
    ? Math.round(r.escalate_after_min)
    : null

  return {
    sync_id: typeof r.sync_id === 'string' && r.sync_id.trim() ? r.sync_id.trim() : null,
    title,
    body: typeof r.body === 'string' ? r.body : null,
    entity_type: r.entity_type === 'task' || r.entity_type === 'note' ? r.entity_type : null,
    entity_ref: typeof r.entity_ref === 'string' && r.entity_ref.trim() ? r.entity_ref.trim() : null,
    fire_at: fireAt,
    freq: typeof r.freq === 'string' && FREQUENCIES.includes(r.freq) ? r.freq : null,
    interval,
    // Stored as a comma-separated 0-6 list; anything else is dropped rather than
    // trusted, since it drives recurrence expansion.
    byweekday: typeof r.byweekday === 'string' && /^[0-6](,[0-6])*$/.test(r.byweekday.trim())
      ? r.byweekday.trim()
      : null,
    lead_time_min: leadTime,
    intensity: INTENSITIES.includes(r.intensity as ReminderIntensity) ? (r.intensity as string) : 'toast',
    escalate_after_min: escalate,
    // A path, or any name not on the allowlist, becomes "use the tier default" —
    // this field was an arbitrary file read. See shared/reminder-sounds.ts.
    sound: sanitizeReminderSound(r.sound),
    auto_created: r.auto_created === 1 || r.auto_created === true ? 1 : 0,
    enabled: r.enabled === 0 || r.enabled === false ? 0 : 1,
    created_at: createdAt,
    updated_at: usableTimestamp(r.updated_at) ?? createdAt
  }
}

// ─── Import ──────────────────────────────────────────────────────────────────

export function importData(): { result: SyncResult; preferences: SyncPreferences | null } {
  let config: SyncConfig
  try {
    config = getSyncConfig()
  } catch (err) {
    return {
      result: { success: false, message: `Import failed: ${(err as Error).message}` },
      preferences: null
    }
  }

  if (!config.enabled || !config.syncPath) {
    return { result: { success: false, message: 'Sync is not configured' }, preferences: null }
  }

  const filePath = syncFilePath(config.syncPath)

  try {
    const outcome = readSharedPayload<SyncPayload>(filePath)
    if (outcome.status !== 'ok') {
      // Surface *why* we declined: callers that are about to write need to know
      // the difference between "no payload yet" and "couldn't read the payload".
      return {
        result: { success: false, message: outcome.message, skipReason: outcome.reason },
        preferences: null
      }
    }
    const data = outcome.data

    const db = getDb()

    /** Reminders the payload described but we could not use. Reported below. */
    let malformedReminders = 0

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

      // Notes — merge on sync_id (created_at as the documented fallback; never
      // delete local-only notes). See the SyncNote comment for what the old
      // created_at-only merge destroyed.
      const getNoteCatId = db.prepare('SELECT id FROM note_categories WHERE name = ?')
      const getNoteTagId = db.prepare('SELECT id FROM note_tags WHERE name = ?')
      const getNoteBySyncId = db.prepare('SELECT id, updated_at FROM notes WHERE sync_id = ?')
      const getNoteByCreatedAt = db.prepare(
        'SELECT id, updated_at FROM notes WHERE created_at = ? ORDER BY id'
      )
      const noteInsert = db.prepare(
        'INSERT INTO notes (sync_id, title, content, category_id, created_at, updated_at) VALUES (COALESCE(?, lower(hex(randomblob(16)))), ?, ?, ?, ?, ?)'
      )
      const noteUpdate = db.prepare('UPDATE notes SET title=?, content=?, category_id=?, updated_at=? WHERE id=?')
      const adoptNoteSyncId = db.prepare('UPDATE notes SET sync_id = ? WHERE id = ?')
      const clearNoteTags = db.prepare('DELETE FROM note_tag_map WHERE note_id = ?')
      const noteTagInsert = db.prepare('INSERT OR IGNORE INTO note_tag_map (note_id, tag_id) VALUES (?, ?)')

      /**
       * Rows this import has already spoken for.
       *
       * Only the created_at fallback needs it, and it needs it badly: that key is
       * not unique, so without this two payload entries sharing a timestamp both
       * matched the same local row — the second overwrote the first, and the note
       * that was overwritten was then destroyed on the other machine too on the
       * next round trip.
       */
      const claimedNotes = new Set<number>()

      const matchLocalRow = (
        bySyncId: { get: (v: string) => unknown },
        byCreatedAt: { all: (v: string) => unknown[] },
        syncId: string | undefined,
        createdAt: string,
        claimed: Set<number>
      ): { row: { id: number; updated_at: string } | undefined; matchedBySyncId: boolean } => {
        if (syncId) {
          const row = bySyncId.get(syncId) as { id: number; updated_at: string } | undefined
          if (row) {
            claimed.add(row.id)
            return { row, matchedBySyncId: true }
          }
        }
        // Fallback. Reached for a payload written before sync_id existed, and for
        // the first sync after migration 3, when both machines generated their own
        // id for a row they already shared.
        const candidates = byCreatedAt.all(createdAt) as { id: number; updated_at: string }[]
        const row = candidates.find((c) => !claimed.has(c.id))
        if (row) claimed.add(row.id)
        return { row, matchedBySyncId: false }
      }

      for (const note of data.notes) {
        const cat = note.categoryName ? (getNoteCatId.get(note.categoryName) as { id: number } | undefined) : null
        const { row: existing, matchedBySyncId } = matchLocalRow(
          getNoteBySyncId, getNoteByCreatedAt, note.sync_id, note.created_at, claimedNotes
        )
        let noteId: number
        if (existing) {
          if (note.updated_at > existing.updated_at) {
            noteUpdate.run(note.title, note.content, cat?.id ?? null, note.updated_at, existing.id)
          }
          // Converge on one identity when the row was found by the fallback: from
          // here on both machines merge this note by the same key. Safe against a
          // UNIQUE collision — a local row already holding this sync_id would have
          // been found by the lookup above.
          if (!matchedBySyncId && note.sync_id) adoptNoteSyncId.run(note.sync_id, existing.id)
          noteId = existing.id
        } else {
          const info = noteInsert.run(note.sync_id ?? null, note.title, note.content, cat?.id ?? null, note.created_at, note.updated_at)
          noteId = info.lastInsertRowid as number
          claimedNotes.add(noteId)
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

      // Tasks — merge on sync_id, created_at as the fallback; never delete
      // local-only tasks.
      const getTaskCatId = db.prepare('SELECT id FROM task_categories WHERE name = ?')
      const getTaskTagId = db.prepare('SELECT id FROM task_tags WHERE name = ?')
      const getTaskBySyncId = db.prepare('SELECT id, updated_at FROM tasks WHERE sync_id = ?')
      const getTaskByCreatedAt = db.prepare(
        'SELECT id, updated_at FROM tasks WHERE created_at = ? ORDER BY id'
      )
      const adoptTaskSyncId = db.prepare('UPDATE tasks SET sync_id = ? WHERE id = ?')
      const claimedTasks = new Set<number>()
      const taskInsert = db.prepare(`
        INSERT INTO tasks (sync_id, title, description, status, priority, due_date, sort_order, category_id, created_at, updated_at)
        VALUES (COALESCE(?, lower(hex(randomblob(16)))), ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const taskUpdate = db.prepare(`
        UPDATE tasks SET title=?, description=?, status=?, priority=?, due_date=?, sort_order=?, category_id=?, updated_at=? WHERE id=?
      `)
      const clearTaskTags = db.prepare('DELETE FROM task_tag_map WHERE task_id = ?')
      const taskTagInsert = db.prepare('INSERT OR IGNORE INTO task_tag_map (task_id, tag_id) VALUES (?, ?)')

      for (const task of data.tasks) {
        const cat = task.categoryName ? (getTaskCatId.get(task.categoryName) as { id: number } | undefined) : null
        const { row: existing, matchedBySyncId } = matchLocalRow(
          getTaskBySyncId, getTaskByCreatedAt, task.sync_id, task.created_at, claimedTasks
        )
        let taskId: number
        if (existing) {
          if (task.updated_at > existing.updated_at) {
            taskUpdate.run(task.title, task.description, task.status, task.priority, task.due_date, task.sort_order, cat?.id ?? null, task.updated_at, existing.id)
          }
          if (!matchedBySyncId && task.sync_id) adoptTaskSyncId.run(task.sync_id, existing.id)
          taskId = existing.id
        } else {
          const info = taskInsert.run(
            task.sync_id ?? null,
            task.title, task.description, task.status, task.priority,
            task.due_date, task.sort_order, cat?.id ?? null,
            task.created_at, task.updated_at
          )
          taskId = info.lastInsertRowid as number
          claimedTasks.add(taskId)
        }
        clearTaskTags.run(taskId)
        for (const tagName of task.tagNames) {
          const tag = getTaskTagId.get(tagName) as { id: number } | undefined
          if (tag) taskTagInsert.run(taskId, tag.id)
        }
      }

      // Reminders — definitions only, merged by created_at like notes and tasks,
      // and never deleting local-only rows.
      //
      // MUST come after tasks: a reminder's entity link is resolved through the
      // task rows this same transaction may have just inserted.
      //
      // `?? []` is the staged-rollout guard: a payload written by the previous
      // build has no `reminders` key, and that has to mean "nothing to merge",
      // not a crash and not "the remote deleted them all".
      const remoteReminders = data.reminders ?? []
      if (remoteReminders.length > 0) {
        const getTaskIdBySyncId = db.prepare('SELECT id FROM tasks WHERE sync_id = ?')
        // Legacy: a payload from the build that exported the task's created_at.
        // Ambiguous by nature (that is the bug this replaced), so at least be
        // deterministic about which row wins.
        const getTaskIdByCreatedAt = db.prepare(
          'SELECT id FROM tasks WHERE created_at = ? ORDER BY id LIMIT 1'
        )
        const getReminderBySyncId = db.prepare(
          'SELECT id, updated_at FROM reminders WHERE sync_id = ?'
        )
        // Fallback for a payload with no sync_id — see SyncReminder.sync_id.
        const getReminderByCreatedAt = db.prepare(
          'SELECT id, updated_at FROM reminders WHERE created_at = ?'
        )
        // COALESCE rather than omitting the column: an explicit NULL would violate
        // NOT NULL (a column default only applies when the column is left out), and
        // this keeps one statement for both the normal and the fallback path.
        const reminderInsert = db.prepare(`
          INSERT INTO reminders
            (sync_id, title, body, entity_type, entity_id, fire_at, freq, interval, byweekday,
             lead_time_min, intensity, escalate_after_min, sound, auto_created, enabled,
             created_at, updated_at)
          VALUES (COALESCE(?, lower(hex(randomblob(16)))), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        const reminderUpdate = db.prepare(`
          UPDATE reminders SET title=?, body=?, entity_type=?, entity_id=?, fire_at=?, freq=?,
                 interval=?, byweekday=?, lead_time_min=?, intensity=?, escalate_after_min=?,
                 sound=?, auto_created=?, enabled=?, updated_at=?
          WHERE id=?
        `)
        // Only the schedule changes invalidate materialised occurrences; history
        // (fired / acknowledged / missed) is per-machine and stays put.
        const clearFutureOccurrences = db.prepare(
          "DELETE FROM reminder_occurrences WHERE reminder_id = ? AND state IN ('pending','snoozed')"
        )

        // Only needed for the created_at fallback path, where the key is not
        // guaranteed unique: without it, two remote reminders sharing a timestamp
        // would both match the same local row and the second would be dropped.
        const claimed = new Set<number>()

        for (const raw of remoteReminders) {
          // ONE BAD ROW MUST NOT COST THE WHOLE IMPORT. Only `title` and `fire_at`
          // used to be checked, and `created_at` went in raw — so a payload with a
          // missing timestamp raised NOT NULL and rolled back *everything*:
          // categories, tags, notes, tasks, favorites. A malformed reminder is now
          // skipped and counted, and the rest of the merge commits.
          const rem = normaliseSyncReminder(raw)
          if (!rem) {
            malformedReminders++
            continue
          }

          let entityType: string | null = null
          let entityId: number | null = null
          if (rem.entity_type === 'task' && rem.entity_ref) {
            // By sync_id, which is what makes the link land on the right task. The
            // created_at lookup is only for a payload from the older build.
            const task = (getTaskIdBySyncId.get(rem.entity_ref) ??
              getTaskIdByCreatedAt.get(rem.entity_ref)) as { id: number } | undefined
            // Unresolvable link (the task lives only on the other machine, or was
            // deleted here): keep the reminder, drop the link. It still fires.
            if (task) {
              entityType = 'task'
              entityId = task.id
            }
          }

          let existing: { id: number; updated_at: string } | undefined
          if (rem.sync_id) {
            existing = getReminderBySyncId.get(rem.sync_id) as typeof existing
          } else {
            const match = getReminderByCreatedAt.get(rem.created_at) as typeof existing
            existing = match && !claimed.has(match.id) ? match : undefined
          }
          if (existing) claimed.add(existing.id)

          if (existing) {
            // Last write wins, same rule as notes and tasks.
            if (rem.updated_at > existing.updated_at) {
              reminderUpdate.run(
                rem.title, rem.body, entityType, entityId, rem.fire_at,
                rem.freq, rem.interval, rem.byweekday,
                rem.lead_time_min, rem.intensity,
                rem.escalate_after_min, rem.sound,
                rem.auto_created, rem.enabled, rem.updated_at, existing.id
              )
              clearFutureOccurrences.run(existing.id)
            }
          } else {
            // A missing sync_id lets the column default generate one locally; the
            // row is then this machine's own from then on.
            const inserted = reminderInsert.run(
              rem.sync_id, rem.title, rem.body, entityType, entityId, rem.fire_at,
              rem.freq, rem.interval, rem.byweekday,
              rem.lead_time_min, rem.intensity,
              rem.escalate_after_min, rem.sound,
              rem.auto_created, rem.enabled, rem.created_at, rem.updated_at
            )
            claimed.add(Number(inserted.lastInsertRowid))
          }
        }

        // Collapse auto reminders that a previous build's delete-and-recreate cycle
        // duplicated on this machine. Inside the transaction, so an import either
        // leaves the reminder table consistent or does not touch it.
        const collapsed = dedupeAllAutoReminders()
        if (collapsed > 0) {
          console.log(`[sync] collapsed ${collapsed} duplicate auto reminder(s)`)
        }
      }
    })()

    // Surfaced, not swallowed: the merge succeeded, but the user should know some
    // of what the other machine sent could not be read. Uses the same banner
    // channel as every other persistence problem.
    if (malformedReminders > 0) {
      reportPersistenceIssue(
        'corrupt',
        filePath,
        `${malformedReminders} reminder${malformedReminders === 1 ? '' : 's'} in the sync file ` +
          `could not be read and ${malformedReminders === 1 ? 'was' : 'were'} skipped. ` +
          'Everything else was imported.'
      )
    }

    // Reminder behaviour settings travel with the payload so both machines make the
    // same automation decisions. Main-process owned, so applied here rather than
    // through the renderer's prefs path.
    applyImportedReminderPrefs(data.preferences)

    // Persist synced prefs so renderer can apply them on next startup.
    // backup:false — purely derived from the payload we just read, and consumed
    // (then deleted) by the renderer on next launch.
    writeJsonAtomic(syncedPrefsPath(), data.preferences, { backup: false })

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
  // Everything, including the config read, sits inside the try: this is called
  // from app.whenReady() with no catch, so a throw here would skip
  // createWindow / createTray / registerGlobalHotkey and leave a headless
  // process squatting on the single-instance lock.
  try {
    const config = getSyncConfig()
    if (!config.enabled || !config.autoSync || !config.syncPath) return false

    // This probe runs first at startup, so it is the one that reports a damaged
    // or unreachable share. It never repairs it — see readSharedPayload.
    const outcome = readSharedPayload<{ exportedAt?: string }>(syncFilePath(config.syncPath))
    // A skip must not import and must not record progress; the next launch (or
    // the next manual Sync Now) retries from the same lastSyncedAt.
    if (outcome.status !== 'ok') return false

    const exportedAt = outcome.data.exportedAt
    if (typeof exportedAt !== 'string') return false
    if (!config.lastSyncedAt) return true
    return new Date(exportedAt) > new Date(config.lastSyncedAt)
  } catch (err) {
    console.error(`[sync] auto-import check failed: ${(err as Error).message}`)
    return false
  }
}
