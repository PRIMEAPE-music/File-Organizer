import { Calendar } from 'lucide-react'
import { format } from 'date-fns'
import type { TaskWithMeta, TaskStatus, TaskPriority } from '../../../../shared/types'

const statusIcons: Record<TaskStatus, string> = {
  todo: '\u25CB',
  in_progress: '\u25D0',
  done: '\u25CF'
}

const statusLabels: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done'
}

const priorityColors: Record<TaskPriority, string> = {
  low: 'text-zinc-500',
  medium: 'text-blue-500',
  high: 'text-orange-500',
  urgent: 'text-red-500'
}

interface Props {
  tasks: TaskWithMeta[]
  onEditTask: (task: TaskWithMeta) => void
}

export default function TaskListView({ tasks, onEditTask }: Props) {
  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-400">
        <div className="text-center">
          <p className="text-lg mb-1">No tasks found</p>
          <p className="text-sm">Create a new task to get started</p>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 uppercase tracking-wider">
            <th className="text-left py-2 px-3 font-medium">Status</th>
            <th className="text-left py-2 px-3 font-medium">Title</th>
            <th className="text-left py-2 px-3 font-medium">Priority</th>
            <th className="text-left py-2 px-3 font-medium">Due Date</th>
            <th className="text-left py-2 px-3 font-medium">Category</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(task => (
            <tr
              key={task.id}
              onClick={() => onEditTask(task)}
              className="border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
            >
              <td className="py-2.5 px-3">
                <span className="text-lg" title={statusLabels[task.status]}>
                  {statusIcons[task.status]}
                </span>
              </td>
              <td className="py-2.5 px-3">
                <div className="font-medium text-zinc-800 dark:text-zinc-200">
                  {task.title}
                </div>
                {task.tags.length > 0 && (
                  <div className="flex gap-1 mt-0.5">
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
                )}
              </td>
              <td className="py-2.5 px-3">
                <span className={`font-medium capitalize ${priorityColors[task.priority]}`}>
                  {task.priority}
                </span>
              </td>
              <td className="py-2.5 px-3 text-zinc-500">
                {task.due_date ? (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {format(new Date(task.due_date), 'MMM d, yyyy')}
                  </span>
                ) : (
                  <span className="text-zinc-300 dark:text-zinc-600">—</span>
                )}
              </td>
              <td className="py-2.5 px-3">
                {task.category ? (
                  <span className="flex items-center gap-1 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: task.category.color }} />
                    {task.category.name}
                  </span>
                ) : (
                  <span className="text-zinc-300 dark:text-zinc-600">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
