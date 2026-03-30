import { useState, useEffect, useCallback } from 'react'
import type { ScannedFolder } from '../../../shared/types'

export function useFolders() {
  const [folders, setFolders] = useState<ScannedFolder[]>([])

  const refresh = useCallback(async () => {
    const result = await window.api.getFolders()
    setFolders(result)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const addFolder = useCallback(async (recursive: boolean = true) => {
    const path = await window.api.selectFolder()
    if (!path) return null
    const result = await window.api.addFolder(path, recursive)
    await refresh()
    return result
  }, [refresh])

  const removeFolder = useCallback(async (id: number) => {
    await window.api.removeFolder(id)
    await refresh()
  }, [refresh])

  const rescanFolder = useCallback(async (id: number) => {
    await window.api.rescanFolder(id)
  }, [])

  return { folders, addFolder, removeFolder, rescanFolder, refresh }
}
