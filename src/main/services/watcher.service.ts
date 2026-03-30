import chokidar from 'chokidar'
import path from 'path'
import { upsertFile, removeFileByPath } from '../db/repositories/files.repo'
import { getAllFolders } from '../db/repositories/folders.repo'
import fs from 'fs'

const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsb', '.docx', '.doc', '.pdf', '.txt', '.log', '.md', '.csv', '.json', '.xml'])

let watcher: chokidar.FSWatcher | null = null
let onChange: (() => void) | null = null

// Debounce change notifications to avoid flooding the renderer
let notifyTimeout: ReturnType<typeof setTimeout> | null = null
const NOTIFY_DEBOUNCE_MS = 300

// Pending deletes — delays removal so atomic saves (delete + re-create) don't
// destroy file metadata.  Word and Excel save by writing a temp file, deleting
// the original, then renaming the temp.  Chokidar reports this as unlink → add.
// By deferring the delete we let the subsequent add's upsert hit the existing
// row (ON CONFLICT … DO UPDATE) which preserves category_id and file_tags.
const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>()
const UNLINK_DELAY_MS = 1500

export function setChangeCallback(cb: () => void): void {
  onChange = cb
}

function isSupported(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function findFolderId(filePath: string): number | null {
  const folders = getAllFolders()
  for (const folder of folders) {
    if (filePath.startsWith(folder.path)) {
      return folder.id
    }
  }
  return null
}

/** Batched change notification — collapses rapid events into one renderer refresh */
function notifyChange(): void {
  if (!onChange) return
  if (notifyTimeout) clearTimeout(notifyTimeout)
  notifyTimeout = setTimeout(() => {
    notifyTimeout = null
    onChange?.()
  }, NOTIFY_DEBOUNCE_MS)
}

/** Cancel a pending delete if the file reappeared (atomic save pattern) */
function cancelPendingDelete(filePath: string): boolean {
  const timeout = pendingDeletes.get(filePath)
  if (timeout) {
    clearTimeout(timeout)
    pendingDeletes.delete(filePath)
    return true
  }
  return false
}

export function startWatching(folderPaths: string[]): void {
  stopWatching()

  if (folderPaths.length === 0) return

  watcher = chokidar.watch(folderPaths, {
    ignoreInitial: true,
    ignored: [
      /(^|[/\\])\../,   // hidden files / dirs
      /node_modules/,
      /~\$/              // Word / Excel temp lock files (~$filename.docx)
    ],
    persistent: true,
    depth: 20,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100
    }
  })

  watcher.on('add', (filePath: string) => {
    if (!isSupported(filePath)) return
    const folderId = findFolderId(filePath)
    if (!folderId) return

    // If this path had a pending delete, cancel it — the file was atomically
    // replaced (Word/Excel save).  The upsert below will update the existing
    // row, preserving its category_id and file_tags.
    cancelPendingDelete(filePath)

    try {
      const stat = fs.statSync(filePath)
      upsertFile({
        folder_id: folderId,
        name: path.basename(filePath),
        extension: path.extname(filePath).toLowerCase(),
        path: filePath,
        size: stat.size,
        modified_at: stat.mtime.toISOString(),
        created_at: stat.birthtime.toISOString()
      })
      notifyChange()
    } catch {
      // File may have been removed before we could stat it
    }
  })

  watcher.on('change', (filePath: string) => {
    if (!isSupported(filePath)) return
    const folderId = findFolderId(filePath)
    if (!folderId) return
    try {
      const stat = fs.statSync(filePath)
      upsertFile({
        folder_id: folderId,
        name: path.basename(filePath),
        extension: path.extname(filePath).toLowerCase(),
        path: filePath,
        size: stat.size,
        modified_at: stat.mtime.toISOString(),
        created_at: stat.birthtime.toISOString()
      })
      notifyChange()
    } catch {
      // ignore — file may be mid-write or locked
    }
  })

  watcher.on('unlink', (filePath: string) => {
    if (!isSupported(filePath)) return

    // Defer the delete so that an atomic save's subsequent "add" event can
    // cancel it before the DB row (and its cascaded tags / favorites) is removed.
    const timeout = setTimeout(() => {
      pendingDeletes.delete(filePath)
      removeFileByPath(filePath)
      notifyChange()
    }, UNLINK_DELAY_MS)
    pendingDeletes.set(filePath, timeout)
  })

  watcher.on('error', (error: Error) => {
    console.error('File watcher error:', error)
  })
}

export function addWatchPath(folderPath: string): void {
  if (watcher) {
    watcher.add(folderPath)
  } else {
    startWatching([folderPath])
  }
}

export function removeWatchPath(folderPath: string): void {
  if (watcher) {
    watcher.unwatch(folderPath)
  }
}

export function stopWatching(): void {
  // Clean up pending deletes
  for (const timeout of pendingDeletes.values()) {
    clearTimeout(timeout)
  }
  pendingDeletes.clear()

  if (notifyTimeout) {
    clearTimeout(notifyTimeout)
    notifyTimeout = null
  }

  if (watcher) {
    watcher.close()
    watcher = null
  }
}
