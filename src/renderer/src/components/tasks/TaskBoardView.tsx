import { useCallback } from 'react'
import { DndContext, DragEndEvent, DragOverEvent, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { TaskWithMeta, TaskStatus } from '../../../../shared/types'
import BoardColumn from './BoardColumn'

const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done']

interface Props {
  tasks: TaskWithMeta[]
  onEditTask: (task: TaskWithMeta) => void
  onReorderTask: (id: number, status: TaskStatus, sortOrder: number) => void
}

export default function TaskBoardView({ tasks, onEditTask, onReorderTask }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const getTasksByStatus = (status: TaskStatus) =>
    tasks.filter(t => t.status === status).sort((a, b) => a.sort_order - b.sort_order)

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return

    const taskId = Number(active.id)
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    // Determine target status - either from the droppable column or from the over task
    let targetStatus: TaskStatus
    const overTask = tasks.find(t => t.id.toString() === over.id.toString())

    if (STATUSES.includes(over.id as TaskStatus)) {
      targetStatus = over.id as TaskStatus
    } else if (overTask) {
      targetStatus = overTask.status
    } else {
      return
    }

    // Calculate sort order
    const columnTasks = getTasksByStatus(targetStatus)
      .filter(t => t.id !== taskId)
      .sort((a, b) => a.sort_order - b.sort_order)

    let newSortOrder: number
    if (columnTasks.length === 0) {
      newSortOrder = 1000
    } else if (overTask && overTask.status === targetStatus) {
      const overIndex = columnTasks.findIndex(t => t.id === overTask.id)
      if (overIndex === 0) {
        newSortOrder = columnTasks[0].sort_order / 2
      } else if (overIndex === -1) {
        newSortOrder = columnTasks[columnTasks.length - 1].sort_order + 1000
      } else {
        newSortOrder = (columnTasks[overIndex - 1].sort_order + columnTasks[overIndex].sort_order) / 2
      }
    } else {
      newSortOrder = columnTasks.length > 0
        ? columnTasks[columnTasks.length - 1].sort_order + 1000
        : 1000
    }

    onReorderTask(taskId, targetStatus, newSortOrder)
  }, [tasks, onReorderTask]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 h-full p-4 overflow-x-auto">
        {STATUSES.map(status => (
          <BoardColumn
            key={status}
            status={status}
            tasks={getTasksByStatus(status)}
            onEditTask={onEditTask}
          />
        ))}
      </div>
    </DndContext>
  )
}
