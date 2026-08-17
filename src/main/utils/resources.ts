import { app } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * The single resolver for anything under `resources/`.
 *
 * Packaged, electron-builder's `extraResources` maps `resources/` → `resources/`
 * inside the app resources dir. In dev, main bundles to `out/main/`, so the repo
 * copy is two levels up. Candidates are probed with existsSync rather than
 * assumed.
 *
 * Lives here rather than in index.ts because the tray icon is no longer the only
 * consumer — the alert sounds and the amber tray icon resolve through the same
 * function. A second path resolver would be a second thing to get wrong when
 * packaging changes.
 */
/**
 * A resource name is a BARE FILENAME, never a path.
 *
 * This is the containment check for the `path.join` below. One caller's input is
 * `reminders.sound`, which is a synced field: it arrives inside a JSON payload on
 * a shared network folder, so it is untrusted input in the ordinary sense. Joined
 * unchecked, `../../../../Windows/win.ini` resolved outside the resources
 * directory and was read synchronously and base64-encoded — an arbitrary file
 * read, and a hang or OOM if the target was large.
 *
 * Reminder sounds are additionally restricted to a fixed allowlist by their
 * callers (see shared/reminder-sounds.ts). This is the second, general layer, and
 * it covers every future consumer of this resolver too.
 */
function isBareFileName(fileName: unknown): fileName is string {
  return (
    typeof fileName === 'string' &&
    fileName.length > 0 &&
    fileName === path.basename(fileName) &&
    !fileName.includes('..') &&
    // basename() on Windows already rejects both separators, but the resolver runs
    // on whatever platform Electron gives us, so check both explicitly.
    !fileName.includes('/') &&
    !fileName.includes('\\') &&
    !path.isAbsolute(fileName)
  )
}

export function resolveResourcePath(fileName: string): string | null {
  if (!isBareFileName(fileName)) {
    console.error(`[resources] refused a resource name that is not a bare filename: ${fileName}`)
    return null
  }

  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'resources', fileName),
        path.join(process.resourcesPath, fileName)
      ]
    : [
        path.join(__dirname, '../../resources', fileName),
        path.join(app.getAppPath(), 'resources', fileName)
      ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  console.error(`[resources] not found: ${fileName} (tried ${candidates.join(', ')})`)
  return null
}

/** Read once per process — these files never change while we run. */
const dataUriCache = new Map<string, string | null>()

/**
 * Read a resource as a base64 `data:` URI.
 *
 * WHY not hand the renderer a `file://` path: the renderer's CSP blocks loading
 * local resources that way (a lesson this project has already paid for once), and
 * the main process cannot play audio itself. So the bytes travel over IPC and the
 * alert window plays them from a data URI.
 */
export function readResourceDataUri(fileName: string, mimeType: string): string | null {
  // Ahead of the cache on purpose: a rejected name must not take up a cache entry,
  // or a payload naming a thousand different bad paths would grow this map for the
  // life of the process.
  if (!isBareFileName(fileName)) {
    console.error(`[resources] refused to read a non-filename resource: ${fileName}`)
    return null
  }

  const cached = dataUriCache.get(fileName)
  if (cached !== undefined) return cached

  let result: string | null = null
  const filePath = resolveResourcePath(fileName)
  if (filePath) {
    try {
      result = `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`
    } catch (err) {
      console.error(`[resources] could not read ${fileName}: ${(err as Error).message}`)
    }
  }

  dataUriCache.set(fileName, result)
  return result
}
