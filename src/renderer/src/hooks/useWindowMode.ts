import { useState, useEffect, useCallback } from 'react'
import type { WindowMode, WidgetState } from '../../../shared/types'

export function useWindowMode() {
  const [windowMode, setWindowMode] = useState<WindowMode>('normal')
  const [widgetState, setWidgetState] = useState<WidgetState>('collapsed')

  useEffect(() => {
    // Load initial state
    window.api.getWindowMode().then(setWindowMode)
    window.api.getWidgetState().then(setWidgetState)

    // Listen for changes from main process
    const unsubMode = window.api.onWindowModeChanged(setWindowMode)
    const unsubWidget = window.api.onWidgetStateChanged(setWidgetState)

    return () => {
      unsubMode()
      unsubWidget()
    }
  }, [])

  const toggleMode = useCallback(() => {
    const newMode: WindowMode = windowMode === 'normal' ? 'widget' : 'normal'
    window.api.setWindowMode(newMode)
  }, [windowMode])

  const toggleWidget = useCallback(() => {
    window.api.toggleWidgetState()
  }, [])

  return {
    windowMode,
    widgetState,
    isWidget: windowMode === 'widget',
    isExpanded: widgetState === 'expanded',
    toggleMode,
    toggleWidget
  }
}
