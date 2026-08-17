import { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import type { TaskWithMeta, TaskStatus, TaskPriority, TaskCategory, TaskTag } from '../../../../shared/types'
import { useInFlight } from '../../hooks/useInFlight'

interface Props {
  task?: TaskWithMeta | null
  categories: TaskCategory[]
  tags: TaskTag[]
  /** Awaited, so the submit button can stay disabled until the write finishes. */
  onSave: (data: {
    title: string
    description: string
    status: TaskStatus
    priority: TaskPriority
    due_date: string | null
    category_id: number | null
    tagIds: number[]
    /** "Remind me" — always a hand-made (auto_created = 0) reminder. */
    remindMe: boolean
    remindLeadMin: number
  }) => void | Promise<void>
  onClose: () => void
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' }
]

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' }
]

export default function TaskModal({ task, categories, tags, onSave, onClose }: Props) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium')
  const [dueDate, setDueDate] = useState(task?.due_date ?? '')
  const [categoryId, setCategoryId] = useState<number | null>(task?.category_id ?? null)
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set(task?.tags.map(t => t.id) ?? []))

  // "Remind me": an explicit opt-in, so a low-priority task can still get a
  // reminder. This path always produces auto_created = 0, which is what makes it
  // survive every later priority change.
  const [remindMe, setRemindMe] = useState(false)
  const [remindLeadMin, setRemindLeadMin] = useState('0')
  const [hasAutoReminder, setHasAutoReminder] = useState(false)

  // The modal is closed by the parent only after its save resolves, so without
  // this a double-click on Create created the task twice.
  const { inFlight: saving, run: runSave } = useInFlight('save task')

  useEffect(() => {
    if (!task) return
    let cancelled = false
    window.api.getTaskReminder(task.id).then(({ manual, auto }) => {
      if (cancelled) return
      setRemindMe(manual !== null)
      if (manual) setRemindLeadMin(String(manual.lead_time_min))
      setHasAutoReminder(auto !== null)
    })
    return () => {
      cancelled = true
    }
  }, [task?.id])

  const toggleTag = (tagId: number) => {
    setSelectedTagIds(prev => {
      const next = new Set(prev)
      if (next.has(tagId)) next.delete(tagId)
      else next.add(tagId)
      return next
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    runSave(() =>
      onSave({
        title: title.trim(),
        description,
        status,
        priority,
        due_date: dueDate || null,
        category_id: categoryId,
        tagIds: Array.from(selectedTagIds),
        remindMe,
        remindLeadMin: Math.max(0, Number(remindLeadMin) || 0)
      })
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-800 rounded-xl shadow-2xl w-[480px] max-h-[80vh] overflow-y-auto p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">{task ? 'Edit Task' : 'New Task'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Title</label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Task title"
              className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Task description (optional)"
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
            />
          </div>

          {/* Status + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as TaskStatus)}
                className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                {STATUS_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value as TaskPriority)}
                className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                {PRIORITY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>

          {/* Remind me */}
          <div className="rounded-md border border-zinc-200 dark:border-zinc-700 p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={remindMe}
                disabled={!dueDate}
                onChange={e => setRemindMe(e.target.checked)}
              />
              <Bell className="w-3.5 h-3.5 text-zinc-400" />
              Remind me about this task
            </label>
            {!dueDate && (
              <p className="text-[11px] text-zinc-400">Set a due date to enable a reminder.</p>
            )}
            {remindMe && dueDate && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-500">Minutes before</span>
                <input
                  type="number"
                  min={0}
                  max={43200}
                  value={remindLeadMin}
                  onChange={e => setRemindLeadMin(e.target.value)}
                  className="w-24 px-2 py-1 text-xs rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
                <span className="text-[11px] text-zinc-400">
                  a due date with no time counts as 9am
                </span>
              </div>
            )}
            {hasAutoReminder && (
              <p className="text-[11px] text-zinc-400">
                This task also has an automatic reminder from its priority.
              </p>
            )}
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Category</label>
            <select
              value={categoryId ?? ''}
              onChange={e => setCategoryId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 text-sm rounded-md border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              <option value="">None</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Tags</label>
              <div className="flex flex-wrap gap-2">
                {tags.map(tag => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all
                      ${selectedTagIds.has(tag.id) ? 'ring-2 ring-accent' : 'opacity-60 hover:opacity-100'}`}
                    style={{ backgroundColor: tag.color + '25', color: tag.color }}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || saving}
              className="px-3 py-1.5 text-sm rounded-md bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {task ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
