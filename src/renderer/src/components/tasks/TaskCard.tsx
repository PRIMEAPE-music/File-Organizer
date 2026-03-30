import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Calendar, GripVertical } from 'lucide-react'
import { format } from 'date-fns'
import type { TaskWithMeta, TaskPriority } from '../../../../shared/types'

const priorityColors: Record<TaskPriority, string> = {
  low: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
}

interface Props {
  task: TaskWithMeta
  onClick: () => void
}

export default function TaskCard({ task, onClick }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: task.id.toString() })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer group"
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <button
          className="mt-0.5 p-0.5 text-zinc-300 hover:text-zinc-500 dark:text-zinc-600 dark:hover:text-zinc-400 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
            {task.title}
          </div>
          {task.description && (
            <div className="text-xs text-zinc-400 truncate mt-0.5">
              {task.description.slice(0, 80)}
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${priorityColors[task.priority]}`}>
              {task.priority}
            </span>
            {task.due_date && (
              <span className="flex items-center gap-0.5 text-[10px] text-zinc-400">
                <Calendar className="w-3 h-3" />
                {format(new Date(task.due_date), 'MMM d')}
              </span>
            )}
            {task.category && (
              <span className="flex items-center gap-1 text-[10px]">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: task.category.color }} />
                {task.category.name}
              </span>
            )}
            {task.tags.map(tag => (
              <span
                key={tag.id}
                className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                style={{ backgroundColor: tag.color + '25', color: tag.color }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
