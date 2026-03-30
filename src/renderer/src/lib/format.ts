import { format, parseISO } from 'date-fns'

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDate(isoString: string): string {
  try {
    return format(parseISO(isoString), 'MMM d, yyyy h:mm a')
  } catch {
    return isoString
  }
}
