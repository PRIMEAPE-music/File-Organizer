import { useState, useCallback, useEffect } from 'react'

interface ContextMenuState {
  x: number
  y: number
  fileId: number
  selectedFileIds: Set<number>
}

export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)

  const openMenu = useCallback((e: React.MouseEvent, fileId: number, selectedFileIds?: Set<number>) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, fileId, selectedFileIds: selectedFileIds ?? new Set([fileId]) })
  }, [])

  const closeMenu = useCallback(() => setMenu(null), [])

  useEffect(() => {
    if (menu) {
      const handler = () => closeMenu()
      window.addEventListener('click', handler)
      return () => window.removeEventListener('click', handler)
    }
  }, [menu, closeMenu])

  return { menu, openMenu, closeMenu }
}
