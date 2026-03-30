import { useState, useEffect, useCallback } from 'react'
import type { AppTab, ViewMode } from '../../shared/types'
import { useTheme } from './hooks/useTheme'
import { useWindowMode } from './hooks/useWindowMode'
import TabBar from './components/TabBar'
import GrabTab from './components/GrabTab'
import FloatingParticles from './components/FloatingParticles'
import FilesTab from './components/FilesTab'
import NotesTab from './components/notes/NotesTab'
import TasksTab from './components/tasks/TasksTab'

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const { windowMode, widgetState, isWidget, isExpanded, toggleMode, toggleWidget } = useWindowMode()

  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    return (localStorage.getItem('activeTab') as AppTab) || 'files'
  })

  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    return (localStorage.getItem('viewMode') as ViewMode) || 'list'
  })

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebarCollapsed') === 'true'
  })

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
    localStorage.setItem('viewMode', mode)
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev
      localStorage.setItem('sidebarCollapsed', String(next))
      return next
    })
  }, [])

  useEffect(() => {
    localStorage.setItem('activeTab', activeTab)
  }, [activeTab])

  // Widget mode layout
  if (isWidget) {
    return (
      <div className="flex h-screen overflow-hidden select-none">
        <FloatingParticles />
        {isExpanded && (
          <div className="flex flex-col flex-1 min-w-0">
            <TabBar
              activeTab={activeTab}
              onSetTab={setActiveTab}
              theme={theme}
              onToggleTheme={toggleTheme}
              windowMode={windowMode}
              onToggleMode={toggleMode}
              sidebarCollapsed={sidebarCollapsed}
              onToggleSidebar={toggleSidebar}
            />
            {activeTab === 'files' && <FilesTab viewMode={viewMode} onSetViewMode={setViewMode} sidebarCollapsed={sidebarCollapsed} />}
            {activeTab === 'notes' && <NotesTab sidebarCollapsed={sidebarCollapsed} />}
            {activeTab === 'tasks' && <TasksTab sidebarCollapsed={sidebarCollapsed} />}
          </div>
        )}
        <GrabTab widgetState={widgetState} onToggle={toggleWidget} />
      </div>
    )
  }

  // Normal mode layout
  return (
    <div className="flex flex-col h-screen overflow-hidden select-none">
      <FloatingParticles />
      <TabBar
        activeTab={activeTab}
        onSetTab={setActiveTab}
        theme={theme}
        onToggleTheme={toggleTheme}
        windowMode={windowMode}
        onToggleMode={toggleMode}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
      />
      {activeTab === 'files' && <FilesTab viewMode={viewMode} onSetViewMode={setViewMode} sidebarCollapsed={sidebarCollapsed} />}
      {activeTab === 'notes' && <NotesTab sidebarCollapsed={sidebarCollapsed} />}
      {activeTab === 'tasks' && <TasksTab sidebarCollapsed={sidebarCollapsed} />}
    </div>
  )
}
