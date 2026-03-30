import { useState } from 'react'
import type { ExcelPreviewData } from '../../../shared/types'

interface Props {
  data: ExcelPreviewData
}

export default function ExcelPreview({ data }: Props) {
  const [activeSheet, setActiveSheet] = useState(0)

  if (data.sheets.length === 0) {
    return <p className="text-sm text-zinc-400 italic">No data in this spreadsheet</p>
  }

  const sheet = data.sheets[activeSheet]

  return (
    <div className="space-y-2">
      {/* Sheet tabs */}
      {data.sheets.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {data.sheets.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveSheet(i)}
              className={`px-2 py-1 text-xs rounded whitespace-nowrap transition-colors
                ${i === activeSheet
                  ? 'bg-emerald-500/15 text-emerald-600 font-medium'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="overflow-auto border border-zinc-200 dark:border-zinc-700 rounded">
        <table className="text-xs w-full border-collapse">
          {sheet.headers.length > 0 && (
            <thead>
              <tr className="bg-zinc-100 dark:bg-zinc-800">
                {sheet.headers.map((h, i) => (
                  <th
                    key={i}
                    className="px-2 py-1.5 text-left font-semibold border-b border-r border-zinc-200 dark:border-zinc-700 whitespace-nowrap"
                  >
                    {h || '\u00A0'}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {sheet.rows.map((row, ri) => (
              <tr key={ri} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="px-2 py-1 border-b border-r border-zinc-100 dark:border-zinc-800 whitespace-nowrap max-w-[200px] truncate"
                    title={cell}
                  >
                    {cell || '\u00A0'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sheet.totalRows > sheet.rows.length && (
        <p className="text-xs text-zinc-400 text-center">
          Showing {sheet.rows.length} of {sheet.totalRows} rows
        </p>
      )}
    </div>
  )
}
