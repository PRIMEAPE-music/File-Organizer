import { useState } from 'react'
import type { PdfPreviewData } from '../../../shared/types'

interface Props {
  data: PdfPreviewData
}

export default function PdfPreview({ data }: Props) {
  const [activePage, setActivePage] = useState(0)

  if (data.pages.length === 0) {
    return <p className="text-sm text-zinc-400 italic">No text content in this PDF</p>
  }

  const page = data.pages[activePage]

  return (
    <div className="space-y-2">
      {/* Page tabs */}
      {data.pages.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {data.pages.map((p, i) => (
            <button
              key={i}
              onClick={() => setActivePage(i)}
              className={`px-2 py-1 text-xs rounded whitespace-nowrap transition-colors
                ${i === activePage
                  ? 'bg-red-500/15 text-red-600 font-medium'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
            >
              Page {p.pageNumber}
            </button>
          ))}
        </div>
      )}

      {/* Page content */}
      <div className="overflow-auto border border-zinc-200 dark:border-zinc-700 rounded p-3 max-h-[500px]">
        <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-zinc-700 dark:text-zinc-300">
          {page.text}
        </pre>
      </div>

      {data.totalPages > data.pages.length && (
        <p className="text-xs text-zinc-400 text-center">
          Showing {data.pages.length} of {data.totalPages} pages
        </p>
      )}
    </div>
  )
}
