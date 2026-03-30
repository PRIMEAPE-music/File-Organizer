import { FileSpreadsheet, FileText } from 'lucide-react'

interface Props {
  extension: string
  size?: number
}

export default function FileIcon({ extension, size = 24 }: Props) {
  const isExcel = extension === '.xlsx' || extension === '.xls'
  return isExcel
    ? <FileSpreadsheet className="text-emerald-600 dark:text-emerald-500 flex-shrink-0" style={{ width: size, height: size }} />
    : <FileText className="text-blue-600 dark:text-blue-500 flex-shrink-0" style={{ width: size, height: size }} />
}
