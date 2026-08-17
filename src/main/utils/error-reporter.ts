import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type { PersistenceIssue, PersistenceIssueKind } from '../../shared/types'

/**
 * Surfaces persistence failures to the user.
 *
 * A failed write that looks like success is the same class of bug as a corrupt
 * read silently returning defaults, so neither is allowed to pass quietly.
 *
 * Delivery has to cope with issues raised before any window exists — the
 * startup auto-import runs before `createWindow()`. So every issue is queued;
 * the renderer drains the queue on mount and also listens for live events. The
 * `id` makes a double delivery idempotent in the UI.
 */

let nextId = 1
const pending: PersistenceIssue[] = []

const MAX_PENDING = 50

export function reportPersistenceIssue(
  kind: PersistenceIssueKind,
  file: string,
  detail: string
): void {
  const issue: PersistenceIssue = { id: nextId++, kind, file, detail }
  console.error(`[persistence] ${kind}: ${file} — ${detail}`)

  pending.push(issue)
  if (pending.length > MAX_PENDING) pending.shift()

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.PERSISTENCE_ISSUE, issue)
    }
  }
}

/** Wraps a write so a throw becomes a user-visible issue instead of silence. */
export function guardWrite(file: string, write: () => void): boolean {
  try {
    write()
    return true
  } catch (err) {
    reportPersistenceIssue('write-failed', file, (err as Error).message)
    return false
  }
}

export function registerPersistenceHandlers(): void {
  ipcMain.handle(IPC.PERSISTENCE_GET_PENDING, (): PersistenceIssue[] => {
    return pending.splice(0, pending.length)
  })
}
