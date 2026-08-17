import { useState, useEffect, useCallback } from 'react'
import type { AppTab, ViewMode, SyncPreferences } from '../../shared/types'
import { useTheme } from './hooks/useTheme'
import { useWindowMode } from './hooks/useWindowMode'
import TabBar from './components/TabBar'
import GrabTab from './components/GrabTab'
import FloatingParticles from './components/FloatingParticles'
import FilesTab from './components/FilesTab'
import NotesTab from './components/notes/NotesTab'
import TasksTab from './components/tasks/TasksTab'
import SyncModal from './components/SyncModal'

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

  const [syncModalOpen, setSyncModalOpen] = useState(false)

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

  // On startup: apply any synced prefs from auto-import that happened before renderer loaded
  useEffect(() => {
    window.api.syncGetSyncedPrefs().then(prefs => {
      if (prefs) applyImportedPrefs(prefs)
    })
  }, [])

  // Keep main process updated with current prefs (used for auto-export on close)
  const currentPrefs: SyncPreferences = { theme, viewMode, sidebarCollapsed, activeTab }
  useEffect(() => {
    window.api.syncUpdatePrefs(currentPrefs)
  }, [theme, viewMode, sidebarCollapsed, activeTab])

  const applyImportedPrefs = useCallback((prefs: SyncPreferences) => {
    localStorage.setItem('theme', prefs.theme)
    localStorage.setItem('viewMode', prefs.viewMode)
    localStorage.setItem('sidebarCollapsed', String(prefs.sidebarCollapsed))
    localStorage.setItem('activeTab', prefs.activeTab)
    // Reload so all state initialises fresh from the updated localStorage
    window.location.reload()
  }, [])

  const syncModal = syncModalOpen && (
    <SyncModal
      onClose={() => setSyncModalOpen(false)}
      currentPrefs={currentPrefs}
      onSyncImport={applyImportedPrefs}
    />
  )

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
              onOpenSync={() => setSyncModalOpen(true)}
            />
            {activeTab === 'files' && <FilesTab viewMode={viewMode} onSetViewMode={setViewMode} sidebarCollapsed={sidebarCollapsed} />}
            {activeTab === 'notes' && <NotesTab sidebarCollapsed={sidebarCollapsed} />}
            {activeTab === 'tasks' && <TasksTab sidebarCollapsed={sidebarCollapsed} />}
          </div>
        )}
        <GrabTab widgetState={widgetState} onToggle={toggleWidget} />
        {syncModal}
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
        onOpenSync={() => setSyncModalOpen(true)}
      />
      {activeTab === 'files' && <FilesTab viewMode={viewMode} onSetViewMode={setViewMode} sidebarCollapsed={sidebarCollapsed} />}
      {activeTab === 'notes' && <NotesTab sidebarCollapsed={sidebarCollapsed} />}
      {activeTab === 'tasks' && <TasksTab sidebarCollapsed={sidebarCollapsed} />}
      {syncModal}
    </div>
  )
}
