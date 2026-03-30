import type { TextPreviewData } from '../../../shared/types'

interface Props {
  data: TextPreviewData
}

export default function TextPreview({ data }: Props) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-400">
        {data.lineCount} line{data.lineCount !== 1 ? 's' : ''}
      </div>

      <div className="overflow-auto border border-zinc-200 dark:border-zinc-700 rounded p-3 max-h-[500px]">
        <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-zinc-700 dark:text-zinc-300">
          {data.content}
        </pre>
      </div>
    </div>
  )
}
