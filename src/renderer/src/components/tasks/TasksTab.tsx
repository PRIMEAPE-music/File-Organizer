import { useState, useCallback } from 'react'
import { List, LayoutGrid, Plus } from 'lucide-react'
import type { TaskFilterState, TaskSidebarView, TaskViewMode, TaskWithMeta, TaskStatus } from '../../../../shared/types'
import { useTasks } from '../../hooks/useTasks'
import { useTaskCategories } from '../../hooks/useTaskCategories'
import { useTaskTags } from '../../hooks/useTaskTags'
import TaskSidebar from './TaskSidebar'
import TaskListView from './TaskListView'
import TaskBoardView from './TaskBoardView'
import TaskModal from './TaskModal'
import CategoryDialog from '../CategoryDialog'
import TagDialog from '../TagDialog'

interface TasksTabProps {
  sidebarCollapsed?: boolean
}

export default function TasksTab({ sidebarCollapsed = false }: TasksTabProps) {
  const [filter, setFilter] = useState<TaskFilterState>({
    search: '',
    sortField: 'sort_order',
    sortDirection: 'asc',
    sidebarView: { type: 'all' }
  })

  const [viewMode, setViewMode] = useState<TaskViewMode>(() => {
    return (localStorage.getItem('taskViewMode') as TaskViewMode) || 'board'
  })

  const { tasks, createTask, updateTask, deleteTask, reorderTask, addTaskTag, removeTaskTag, refresh } = useTasks(filter)
  const { categories, createCategory, updateCategory, deleteCategory } = useTaskCategories()
  const { tags, createTag, updateTag, deleteTag } = useTaskTags()

  const [taskModal, setTaskModal] = useState<{ mode: 'create' } | { mode: 'edit'; task: TaskWithMeta } | null>(null)
  const [categoryDialog, setCategoryDialog] = useState<{ mode: 'create' } | { mode: 'edit'; id: number; name: string; color: string } | null>(null)
  const [tagDialog, setTagDialog] = useState<{ mode: 'create' } | { mode: 'edit'; id: number; name: string; color: string } | null>(null)

  const setSidebarView = useCallback((view: TaskSidebarView) => {
    setFilter(f => ({ ...f, sidebarView: view }))
  }, [])

  const handleSetViewMode = useCallback((mode: TaskViewMode) => {
    setViewMode(mode)
    localStorage.setItem('taskViewMode', mode)
  }, [])

  const handleEditTask = useCallback((task: TaskWithMeta) => {
    setTaskModal({ mode: 'edit', task })
  }, [])

  const handleSaveTask = useCallback(async (data: {
    title: string
    description: string
    status: TaskStatus
    priority: string
    due_date: string | null
    category_id: number | null
    tagIds: number[]
    remindMe: boolean
    remindLeadMin: number
    remindChanged: boolean
  }) => {
    if (taskModal?.mode === 'edit') {
      const task = taskModal.task
      const updated = await updateTask(task.id, {
        title: data.title,
        description: data.description,
        status: data.status,
        priority: data.priority,
        due_date: data.due_date,
        category_id: data.category_id
      })

      // Sync tags
      const oldTagIds = new Set(task.tags.map(t => t.id))
      const newTagIds = new Set(data.tagIds)
      for (const tagId of data.tagIds) {
        if (!oldTagIds.has(tagId)) await addTaskTag(updated.id, tagId)
      }
      for (const tagId of oldTagIds) {
        if (!newTagIds.has(tagId)) await removeTaskTag(task.id, tagId)
      }

      // After the task write, so the reminder is derived from the saved due date —
      // and ONLY when something about the reminder changed. This ran on every save,
      // which rewrote the reminder every time: a `fire_at` clamped to "now" moved
      // again and re-fired, and the row's pending and snoozed occurrences were
      // discarded, so saving a task silently cancelled a snooze. `setTaskManualReminder`
      // now declines a write that would change nothing — that is the guarantee, and
      // this is defence in depth. See TaskModal for how `remindChanged` is decided.
      if (data.remindChanged) {
        await window.api.setTaskReminder(updated.id, data.remindMe, data.remindLeadMin)
      }
    } else {
      const created = await createTask({
        title: data.title,
        description: data.description,
        status: data.status,
        priority: data.priority,
        due_date: data.due_date,
        category_id: data.category_id
      })
      for (const tagId of data.tagIds) {
        await addTaskTag(created.id, tagId)
      }
      if (data.remindMe) {
        await window.api.setTaskReminder(created.id, true, data.remindLeadMin)
      }
    }
    setTaskModal(null)
    refresh()
  }, [taskModal, updateTask, createTask, addTaskTag, removeTaskTag, refresh])

  const handleReorderTask = useCallback(async (id: number, status: TaskStatus, sortOrder: number) => {
    await reorderTask(id, status, sortOrder)
  }, [reorderTask])

  return (
    <div className="flex flex-1 overflow-hidden">
      {!sidebarCollapsed && <TaskSidebar
        sidebarView={filter.sidebarView}
        onSetView={setSidebarView}
        categories={categories}
        tags={tags}
        onCreateCategory={() => setCategoryDialog({ mode: 'create' })}
        onEditCategory={(cat) => setCategoryDialog({ mode: 'edit', id: cat.id, name: cat.name, color: cat.color })}
        onDeleteCategory={deleteCategory}
        onCreateTag={() => setTagDialog({ mode: 'create' })}
        onEditTag={(tag) => setTagDialog({ mode: 'edit', id: tag.id, name: tag.name, color: tag.color })}
        onDeleteTag={deleteTag}
      />}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
          <div className="flex items-center gap-1">
            <button
              onClick={() => handleSetViewMode('list')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-accent/15 text-accent' : 'text-zinc-400 hover:text-zinc-600'}`}
              title="List view"
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleSetViewMode('board')}
              className={`p-1.5 rounded transition-colors ${viewMode === 'board' ? 'bg-accent/15 text-accent' : 'text-zinc-400 hover:text-zinc-600'}`}
              title="Board view"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <span className="text-xs text-zinc-400 ml-2">{tasks.length} tasks</span>
          </div>
          <button
            onClick={() => setTaskModal({ mode: 'create' })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Task
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {viewMode === 'list' ? (
            <TaskListView tasks={tasks} onEditTask={handleEditTask} />
          ) : (
            <TaskBoardView
              tasks={tasks}
              onEditTask={handleEditTask}
              onReorderTask={handleReorderTask}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      {taskModal && (
        <TaskModal
          task={taskModal.mode === 'edit' ? taskModal.task : null}
          categories={categories}
          tags={tags}
          onSave={handleSaveTask}
          onClose={() => setTaskModal(null)}
        />
      )}

      {categoryDialog && (
        <CategoryDialog
          mode={categoryDialog.mode}
          initial={categoryDialog.mode === 'edit' ? categoryDialog : undefined}
          onSave={async (name, color) => {
            if (categoryDialog.mode === 'create') {
              await createCategory(name, color)
            } else {
              await updateCategory(categoryDialog.id, name, color)
            }
            setCategoryDialog(null)
          }}
          onClose={() => setCategoryDialog(null)}
        />
      )}

      {tagDialog && (
        <TagDialog
          mode={tagDialog.mode}
          initial={tagDialog.mode === 'edit' ? tagDialog : undefined}
          onSave={async (name, color) => {
            if (tagDialog.mode === 'create') {
              await createTag(name, color)
            } else {
              await updateTag(tagDialog.id, name, color)
            }
            setTagDialog(null)
          }}
          onClose={() => setTagDialog(null)}
        />
      )}
    </div>
  )
}
