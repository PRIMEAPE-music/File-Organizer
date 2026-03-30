import { useState, useEffect } from 'react'
import type { PreviewData } from '../../../shared/types'

export function usePreview(filePath: string | null) {
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!filePath) {
      setPreview(null)
      return
    }

    let cancelled = false
    setLoading(true)

    window.api.getPreview(filePath).then(data => {
      if (!cancelled) {
        setPreview(data)
        setLoading(false)
      }
    }).catch(() => {
      if (!cancelled) {
        setPreview({ type: 'unsupported', message: 'Failed to load preview' })
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [filePath])

  return { preview, loading }
}
