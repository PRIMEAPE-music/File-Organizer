import { AlertTriangle, X } from 'lucide-react'
import type { PersistenceIssue } from '../../../shared/types'

interface Props {
  issues: PersistenceIssue[]
  onDismiss: (id: number) => void
}

function baseName(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || filePath
}

function headline(issue: PersistenceIssue): string {
  switch (issue.kind) {
    case 'corrupt':
      return `Couldn't read ${baseName(issue.file)}`
    case 'unreachable':
      return `Couldn't reach ${baseName(issue.file)}`
    // `file` is a subject, not a path — see PersistenceIssueKind.
    case 'unavailable':
      return `${issue.file} is unavailable`
    case 'write-failed':
    default:
      return `Couldn't save ${baseName(issue.file)}`
  }
}

/**
 * Data-loss warnings from the main process. A failed save that looks like a
 * success is as damaging as a corrupt read, so both get a banner the user has
 * to dismiss deliberately.
 */
export default function PersistenceBanner({ issues, onDismiss }: Props) {
  if (issues.length === 0) return null

  return (
    <div className="shrink-0 no-drag">
      {issues.map((issue) => (
        <div
          key={issue.id}
          className="flex items-start gap-2.5 px-4 py-2.5 border-b border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/25 text-amber-900 dark:text-amber-200"
        >
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{headline(issue)}</div>
            <div className="text-xs opacity-80 mt-0.5 break-words">{issue.detail}</div>
            {issue.kind !== 'unavailable' && (
              <div className="text-[11px] opacity-60 mt-0.5 break-all" title={issue.file}>
                {issue.file}
              </div>
            )}
          </div>
          <button
            onClick={() => onDismiss(issue.id)}
            title="Dismiss"
            className="shrink-0 p-1 rounded hover:bg-amber-200/70 dark:hover:bg-amber-800/50 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
