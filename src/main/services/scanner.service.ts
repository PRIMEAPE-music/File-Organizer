import fs from 'fs'
import path from 'path'
import { upsertFile } from '../db/repositories/files.repo'

const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.xls', '.xlsb', '.docx', '.doc', '.pdf', '.txt', '.log', '.md', '.csv', '.json', '.xml'])

interface ScanCallbacks {
  onFile?: (filePath: string) => void
  onError?: (error: Error, filePath: string) => void
}

export function scanFolder(folderPath: string, folderId: number, recursive: boolean = true, callbacks?: ScanCallbacks): number {
  let count = 0

  function walk(dir: string, depth: number): void {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        // Only recurse into subdirectories if recursive is enabled
        if (recursive && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          walk(fullPath, depth + 1)
        }
        continue
      }

      if (!entry.isFile()) continue

      const ext = path.extname(entry.name).toLowerCase()
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue

      try {
        const stat = fs.statSync(fullPath)
        upsertFile({
          folder_id: folderId,
          name: entry.name,
          extension: ext,
          path: fullPath,
          size: stat.size,
          modified_at: stat.mtime.toISOString(),
          created_at: stat.birthtime.toISOString()
        })
        count++
        callbacks?.onFile?.(fullPath)
      } catch (err) {
        callbacks?.onError?.(err as Error, fullPath)
      }
    }
  }

  walk(folderPath, 0)
  return count
}
