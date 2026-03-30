import { useRef, useCallback } from 'react'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import type { WidgetState } from '../../../shared/types'

interface GrabTabProps {
  widgetState: WidgetState
  onToggle: () => void
}

const CLICK_THRESHOLD = 5

export default function GrabTab({ widgetState, onToggle }: GrabTabProps) {
  const isExpanded = widgetState === 'expanded'
  const dragRef = useRef<{ startX: number; startWidth: number; dragging: boolean } | null>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Get current window width as starting point
    const startWidth = window.innerWidth
    dragRef.current = { startX: e.clientX, startWidth, dragging: false }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX

    if (!dragRef.current.dragging && Math.abs(dx) > CLICK_THRESHOLD) {
      dragRef.current.dragging = true
    }

    if (dragRef.current.dragging) {
      // The grab tab is on the RIGHT edge, so dragging right = wider
      const newWidth = dragRef.current.startWidth + dx
      window.api.setWidgetWidth(Math.round(newWidth))
    }
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    const wasDrag = dragRef.current.dragging
    dragRef.current = null
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)

    // If it wasn't a drag, treat as click toggle
    if (!wasDrag) onToggle()
  }, [onToggle])

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className={`flex flex-col items-center justify-center h-full shrink-0 transition-colors cursor-col-resize select-none ${
        isExpanded
          ? 'w-5 border-l border-emerald-600/30'
          : 'flex-1'
      }`}
      style={{
        background: 'linear-gradient(to top, #4a7c59, #2d5a3f, #1a3a28, #0f2418)'
      }}
    >
      {isExpanded ? (
        <ChevronLeft size={12} className="text-white/80" />
      ) : (
        <ChevronRight size={12} className="text-white/80" />
      )}
    </div>
  )
}
