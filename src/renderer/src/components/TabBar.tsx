import { FileText, StickyNote, CheckSquare, Sun, Moon, Minus, Square, X, PanelLeft, PanelLeftClose, PanelLeftOpen, Wifi } from 'lucide-react'
import type { AppTab, ThemeMode, WindowMode } from '../../../shared/types'

const tabs: { id: AppTab; label: string; icon: typeof FileText }[] = [
  { id: 'files', label: 'Files', icon: FileText },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare }
]

interface TabBarProps {
  activeTab: AppTab
  onSetTab: (tab: AppTab) => void
  theme: ThemeMode
  onToggleTheme: () => void
  windowMode: WindowMode
  onToggleMode: () => void
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onOpenSync: () => void
}

export default function TabBar({ activeTab, onSetTab, theme, onToggleTheme, windowMode, onToggleMode, sidebarCollapsed, onToggleSidebar, onOpenSync }: TabBarProps) {
  return (
    <div className="flex items-center h-11 px-4 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0 drag-region">
      <div className="flex gap-1 no-drag">
        {tabs.map(tab => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => onSetTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                active
                  ? 'bg-accent text-white'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Icon size={15} />
              {tab.label}
            </button>
          )
        })}
      </div>
      <div className="ml-auto flex items-center gap-1 no-drag">
        <button
          onClick={onOpenSync}
          className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title="LAN Sync settings"
        >
          <Wifi size={15} />
        </button>
        <button
          onClick={onToggleSidebar}
          className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <button
          onClick={onToggleMode}
          className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title={windowMode === 'normal' ? 'Switch to widget mode' : 'Switch to normal mode'}
        >
          <PanelLeft size={16} />
        </button>
        <button
          onClick={onToggleTheme}
          className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
        >
          {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
        </button>
        <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />
        <button
          onClick={() => window.api.minimizeWindow()}
          className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => window.api.maximizeWindow()}
          className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title="Maximize"
        >
          <Square size={13} />
        </button>
        <button
          onClick={() => window.api.closeWindow()}
          className="p-1.5 rounded-md text-zinc-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-colors"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
