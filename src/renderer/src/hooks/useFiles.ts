import { useState, useEffect, useCallback, useRef } from 'react'
import type { FileWithMeta, FilterState } from '../../../shared/types'

export function useFiles(filter: FilterState) {
  const [files, setFiles] = useState<FileWithMeta[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.api.getFiles(filter)
      setFiles(result)
    } catch (err) {
      console.error('Failed to fetch files:', err)
    } finally {
      setLoading(false)
    }
  }, [
    filter.search,
    filter.extensions.join(','),
    filter.sortField,
    filter.sortDirection,
    JSON.stringify(filter.sidebarView)
  ])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Listen for file system changes — debounce to avoid flooding the renderer
  // when Word/Excel generates rapid FS events during save operations
  useEffect(() => {
    const unsubscribe = window.api.onFilesChanged(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        refresh()
      }, 500)
    })
    return () => {
      unsubscribe()
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [refresh])

  return { files, loading, refresh }
}
