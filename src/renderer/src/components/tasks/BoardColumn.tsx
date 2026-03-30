import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { TaskWithMeta, TaskStatus } from '../../../../shared/types'
import TaskCard from './TaskCard'

const statusLabels: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done'
}

const statusColors: Record<TaskStatus, string> = {
  todo: 'bg-zinc-400',
  in_progress: 'bg-blue-500',
  done: 'bg-green-500'
}

interface Props {
  status: TaskStatus
  tasks: TaskWithMeta[]
  onEditTask: (task: TaskWithMeta) => void
}

export default function BoardColumn({ status, tasks, onEditTask }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[250px] flex flex-col rounded-lg border transition-colors
        ${isOver
          ? 'border-accent bg-accent/5'
          : 'border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30'}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-200 dark:border-zinc-700">
        <span className={`w-2.5 h-2.5 rounded-full ${statusColors[status]}`} />
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {statusLabels[status]}
        </span>
        <span className="ml-auto text-xs text-zinc-400 bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <SortableContext
          items={tasks.map(t => t.id.toString())}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onEditTask(task)}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs text-zinc-400 border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-lg">
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  )
}
