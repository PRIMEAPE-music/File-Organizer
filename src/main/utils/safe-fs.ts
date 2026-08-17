import fs from 'fs'
import os from 'os'
import crypto from 'crypto'

/**
 * Crash- and corruption-safe JSON persistence.
 *
 * WHY THIS EXISTS: the previous pattern was `JSON.parse(fs.readFileSync(...))`
 * inside a bare `catch` that returned an empty default, paired with a plain
 * `fs.writeFileSync`. Two failure modes came out of that:
 *
 *   1. A torn/partial file is indistinguishable from a missing file, so it
 *      silently reads as "empty", and the next write persists that emptiness
 *      over real data.
 *   2. `writeFileSync` truncates first and writes second, so an interruption
 *      mid-write leaves exactly the torn file from (1).
 *
 * This matters most for the LAN-sync payload, which lives on a network share —
 * the likeliest place to catch a half-written read. It is also the place where
 * "recovery" must be at its most timid: see `Ownership` below.
 */

/** Windows AV / Search Indexer can transiently hold the target of a rename. */
const RENAME_ATTEMPTS = 5
const RENAME_DELAY_MS = 40

/**
 * Who writes the file we are reading.
 *
 * - `'local'`  — this process is the sole writer (everything under `userData`).
 *   A file that doesn't parse really is damaged, so the aggressive recovery is
 *   correct: quarantine it to `<path>.corrupt-<ts>` and restore `<path>.bak`.
 *
 * - `'shared'` — other machines write this file too (the sync payload on a
 *   network share). A short read there is far more likely to be another machine
 *   mid-write than genuine corruption, and the two are indistinguishable from
 *   here. Renaming would delete that machine's live data for every machine on
 *   the share; restoring a stale `.bak` would silently republish an older
 *   generation over a newer one. So for shared files: never rename, never
 *   quarantine, never read or write a `.bak`. Report and skip — a transient
 *   partial read costs nothing to retry next cycle.
 *
 * Defaults to `'shared'`, because the destructive behaviour is the one that
 * should have to be asked for by name.
 */
export type Ownership = 'local' | 'shared'

export interface WriteJsonOptions {
  /**
   * Roll the previous contents to `<path>.bak` before overwriting.
   * Default true. Pass false for derived/cache-like files that are trivially
   * regenerable, and always for files on a share (a `.bak` there is a loaded
   * gun: any reader could republish it over newer data).
   */
  backup?: boolean
}

export interface ReadJsonOptions {
  /** See `Ownership`. Defaults to the non-destructive `'shared'`. */
  ownership?: Ownership
}

export type ReadJsonResult<T> =
  /** Parsed, and it is a JSON object. */
  | { status: 'ok'; data: T }
  /** Genuinely not there (ENOENT/ENOTDIR) — caller should use its default. */
  | { status: 'missing' }
  /**
   * The path could not be reached or read at all: share offline, host name
   * unresolvable, permissions. Distinct from `missing` on purpose — treating an
   * outage as "no data yet" is how empty defaults get written over real data.
   */
  | { status: 'unreachable'; detail: string }
  /** Locally-owned file was damaged: it has been quarantined (see fields). */
  | { status: 'corrupt'; quarantinedTo: string; restoredFromBackup: boolean }
  /**
   * Shared file did not parse. NOTHING was renamed, restored or written — the
   * file is exactly as we found it. Caller must skip this cycle and retry.
   */
  | { status: 'damaged'; detail: string }

// ─── Internals ───────────────────────────────────────────────────────────────

function sleepSync(ms: number): void {
  try {
    // Blocking sleep without spinning the CPU. Node allows this on the main
    // thread; the total budget here is a few hundred ms worst case.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    const until = Date.now() + ms
    while (Date.now() < until) {
      /* spin — SharedArrayBuffer unavailable */
    }
  }
}

function backupPath(filePath: string): string {
  return `${filePath}.bak`
}

/**
 * Host tag for temp file names. Stable per machine (so it is worth caching) and
 * sanitised, because a hostname is not guaranteed to be filename-safe.
 */
let hostTag: string | null = null
function hostSlug(): string {
  if (hostTag === null) {
    let name = ''
    try {
      name = os.hostname()
    } catch {
      /* fall through to the placeholder */
    }
    hostTag = name.replace(/[^A-Za-z0-9-]/g, '_').slice(0, 32) || 'host'
  }
  return hostTag
}

/**
 * A temp path that cannot collide with any other writer, anywhere.
 *
 * The pid alone is not enough: the sync payload lives on a network share, pids
 * are per-machine and small, so two machines exporting at the same moment would
 * pick the same `<file>.tmp-<pid>`, interleave their writes into one file, and
 * publish the mixture. Hostname removes the cross-machine collision; the random
 * suffix (fresh on every call, never per module load) removes same-host races
 * and pid reuse.
 */
function tempPath(filePath: string): string {
  const rand = crypto.randomBytes(6).toString('hex')
  return `${filePath}.tmp-${hostSlug()}-${process.pid}-${rand}`
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

type Inspection =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string }

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return `a ${typeof value}`
}

/**
 * Parse `raw` and insist the result is a JSON object.
 *
 * Valid-JSON-but-not-an-object (`null`, `3`, `"hi"`, `[]`) used to come back as
 * a successful read, so the caller's fallback never applied and a `null` sailed
 * straight into `config.enabled` — which threw out of an uncaught startup path
 * and left the app permanently unlaunchable. Every file this module persists is
 * an object, so anything else is damage.
 */
function inspect(raw: string): Inspection {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { ok: false, reason: `not valid JSON (${(err as Error).message})` }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: `contained ${describe(parsed)} where a JSON object was expected` }
  }
  return { ok: true, value: parsed as Record<string, unknown> }
}

/**
 * Write `text` to `target` such that `target` is never observed half-written:
 * write to a sibling temp file, fsync it so the bytes are actually on the
 * device, then rename over the target (atomic within a filesystem).
 * Throws — and cleans up its temp file — if the rename cannot be completed.
 */
function writeTextAtomic(target: string, text: string): void {
  const tmp = tempPath(target)

  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, text, 'utf-8')
    // Without fsync the rename can land before the data does, which on a
    // crash yields a renamed-but-empty file: the very corruption we're avoiding.
    fs.fsyncSync(fd)
  } catch (err) {
    fs.closeSync(fd)
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* nothing more we can do */
    }
    throw err
  }
  fs.closeSync(fd)

  let lastErr: unknown
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(tmp, target)
      return
    } catch (err) {
      lastErr = err
      if (attempt < RENAME_ATTEMPTS) sleepSync(RENAME_DELAY_MS)
    }
  }

  // Never leave temp litter behind, even on the failure path.
  try {
    fs.unlinkSync(tmp)
  } catch {
    /* ignore */
  }
  throw new Error(
    `Atomic write failed for ${target} after ${RENAME_ATTEMPTS} rename attempts: ` +
      `${(lastErr as Error)?.message ?? String(lastErr)}`
  )
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Serialize `data` and write it atomically to `filePath`.
 * Throws on failure — callers must surface it rather than let a failed write
 * look like a successful one.
 */
export function writeJsonAtomic(filePath: string, data: unknown, opts: WriteJsonOptions = {}): void {
  const json = JSON.stringify(data, null, 2)

  if (opts.backup !== false) {
    // Roll the previous contents aside — but ONLY if they parse as an object.
    // Backing up corrupt (or non-object) bytes would poison the one copy we'd
    // recover from later.
    try {
      const prev = fs.readFileSync(filePath, 'utf-8')
      if (inspect(prev).ok) writeTextAtomic(backupPath(filePath), prev)
    } catch {
      /* missing, unreadable, or corrupt — leave any existing good .bak alone */
    }
  }

  writeTextAtomic(filePath, json)
}

/**
 * Read and parse JSON, distinguishing "not there yet" from "unreachable" from
 * "damaged" — and, for damaged, distinguishing files we may repair from files
 * we must not touch.
 *
 * See `Ownership` and `ReadJsonResult`. Never throws.
 */
export function readJsonSafe<T>(filePath: string, opts: ReadJsonOptions = {}): ReadJsonResult<T> {
  const ownership: Ownership = opts.ownership ?? 'shared'

  let raw: string
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    if (isMissing(err)) return { status: 'missing' }
    // Measured on Windows: a dead UNC host surfaces as code 'UNKNOWN', a
    // reachable host with a bad share likewise — never ENOENT. So this branch
    // really is the "outage" branch and not a disguised missing file.
    return {
      status: 'unreachable',
      detail:
        `Could not be opened — the location may be offline or the access denied. ` +
        `(${(err as Error).message})`
    }
  }

  const parsed = inspect(raw)
  if (parsed.ok) return { status: 'ok', data: parsed.value as T }

  // ── Shared: look, report, touch nothing. ──
  if (ownership === 'shared') {
    return {
      status: 'damaged',
      detail:
        `${parsed.reason}. Left untouched — another machine may be writing it right now. ` +
        `Will retry on the next sync.`
    }
  }

  // ── Locally owned: we are the only writer, so this is real damage. ──
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const quarantine = `${filePath}.corrupt-${stamp}`
  let quarantinedTo = ''
  try {
    fs.renameSync(filePath, quarantine)
    quarantinedTo = quarantine
  } catch (err) {
    console.error(
      `[safe-fs] could not quarantine corrupt ${filePath}: ${(err as Error).message}`
    )
  }

  let restoredFromBackup = false
  const bak = backupPath(filePath)
  try {
    const prev = fs.readFileSync(bak, 'utf-8')
    if (inspect(prev).ok) {
      writeTextAtomic(filePath, prev)
      restoredFromBackup = true
    }
  } catch {
    /* no usable backup — caller falls back to its default */
  }

  return { status: 'corrupt', quarantinedTo, restoredFromBackup }
}

/**
 * What `loadJson` actually did, so callers can tell "there is no data" from
 * "I could not read the data this time".
 *
 * `skipped` and `unreachable` both mean **do not act and do not record
 * progress** — `data` is only the fallback, not the file's contents.
 */
export type LoadJsonStatus =
  | 'ok'
  | 'missing'
  /** Was damaged, and the `.bak` was put back: `data` is the recovered content. */
  | 'recovered'
  /** Was damaged with no usable backup: `data` is the fallback. */
  | 'defaulted'
  /** Shared file did not parse and was deliberately left alone. Retry later. */
  | 'skipped'
  /** Path unreachable (share offline, permissions). Retry later. */
  | 'unreachable'

export interface LoadJsonOutcome<T> {
  data: T
  status: LoadJsonStatus
  /** Set when something went wrong; suitable for surfacing to the user. */
  issue?: { file: string; detail: string }
}

/**
 * `readJsonSafe` plus the recovery follow-through every caller needs:
 * falls back to `fallback` when missing, and after a successful restore from
 * `.bak` performs the single bounded re-read that hands back the recovered
 * data. Never throws.
 */
export function loadJson<T>(
  filePath: string,
  fallback: T,
  opts: ReadJsonOptions = {}
): LoadJsonOutcome<T> {
  const result = readJsonSafe<T>(filePath, opts)

  if (result.status === 'ok') return { data: result.data, status: 'ok' }
  if (result.status === 'missing') return { data: fallback, status: 'missing' }

  if (result.status === 'unreachable') {
    return { data: fallback, status: 'unreachable', issue: { file: filePath, detail: result.detail } }
  }

  if (result.status === 'damaged') {
    return { data: fallback, status: 'skipped', issue: { file: filePath, detail: result.detail } }
  }

  const where = result.quarantinedTo
    ? `moved aside to ${result.quarantinedTo}`
    : 'could not be moved aside'

  if (result.restoredFromBackup) {
    const retry = readJsonSafe<T>(filePath, opts)
    if (retry.status === 'ok') {
      return {
        data: retry.data,
        status: 'recovered',
        issue: { file: filePath, detail: `File was damaged (${where}) and restored from backup.` }
      }
    }
  }

  return {
    data: fallback,
    status: 'defaulted',
    issue: {
      file: filePath,
      detail: `File was damaged (${where}) and no usable backup existed — defaults were used.`
    }
  }
}
