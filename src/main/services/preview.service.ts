import path from 'path'
import fs from 'fs'
import type { PreviewData, ExcelSheet } from '../../shared/types'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import pdfParse from 'pdf-parse'
import * as XLSX from 'xlsx'

export async function getPreview(filePath: string): Promise<PreviewData> {
  const ext = path.extname(filePath).toLowerCase()

  try {
    if (ext === '.xlsx') {
      return await getExcelPreview(filePath)
    } else if (ext === '.xlsb') {
      return getXlsbPreview(filePath)
    } else if (ext === '.xls') {
      return { type: 'unsupported', message: 'Preview for .xls files is limited. Try saving as .xlsx for full preview support.' }
    } else if (ext === '.docx') {
      return await getWordPreview(filePath)
    } else if (ext === '.doc') {
      return { type: 'unsupported', message: 'Preview for .doc files is not available. Try saving as .docx for preview support.' }
    } else if (ext === '.pdf') {
      return await getPdfPreview(filePath)
    } else if (['.txt', '.log', '.md', '.csv', '.json', '.xml'].includes(ext)) {
      return getTextPreview(filePath)
    }
    return { type: 'unsupported', message: `Unsupported file type: ${ext}` }
  } catch (err) {
    return { type: 'unsupported', message: `Failed to generate preview: ${(err as Error).message}` }
  }
}

async function getExcelPreview(filePath: string): Promise<PreviewData> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  const sheets: ExcelSheet[] = []
  const MAX_ROWS = 100

  workbook.eachSheet((worksheet) => {
    const headers: string[] = []
    const rows: string[][] = []
    let totalRows = 0

    worksheet.eachRow((row, rowNumber) => {
      totalRows++
      const values = row.values as (string | number | null | undefined)[]
      // ExcelJS row.values is 1-indexed, first element is undefined
      const cells = values.slice(1).map(v => {
        if (v === null || v === undefined) return ''
        if (typeof v === 'object' && 'result' in v) return String((v as { result: unknown }).result ?? '')
        if (typeof v === 'object' && 'text' in v) return String((v as { text: string }).text)
        return String(v)
      })

      if (rowNumber === 1) {
        headers.push(...cells)
      } else if (rows.length < MAX_ROWS) {
        rows.push(cells)
      }
    })

    sheets.push({
      name: worksheet.name,
      headers,
      rows,
      totalRows: Math.max(0, totalRows - 1) // Exclude header row
    })
  })

  return { type: 'excel', sheets }
}

async function getWordPreview(filePath: string): Promise<PreviewData> {
  const result = await mammoth.convertToHtml({ path: filePath })
  return { type: 'word', html: result.value }
}

async function getPdfPreview(filePath: string): Promise<PreviewData> {
  const buffer = fs.readFileSync(filePath)
  const MAX_PAGES = 10

  const data = await pdfParse(buffer, { max: MAX_PAGES })

  // pdf-parse gives us all text concatenated; split by page via form feed or
  // fall back to a single "page" with the full text
  const rawPages = data.text.split(/\f/)
  const pages = rawPages
    .slice(0, MAX_PAGES)
    .map((text, i) => ({ pageNumber: i + 1, text: text.trim() }))
    .filter(p => p.text.length > 0)

  // If no pages extracted (empty PDF), return at least a placeholder
  if (pages.length === 0) {
    pages.push({ pageNumber: 1, text: '(No text content found)' })
  }

  return {
    type: 'pdf',
    pages,
    totalPages: data.numpages
  }
}

function getTextPreview(filePath: string): PreviewData {
  const MAX_BYTES = 50 * 1024 // 50 KB
  const stat = fs.statSync(filePath)
  const fd = fs.openSync(filePath, 'r')
  const readSize = Math.min(stat.size, MAX_BYTES)
  const buf = Buffer.alloc(readSize)
  fs.readSync(fd, buf, 0, readSize, 0)
  fs.closeSync(fd)

  let content = buf.toString('utf-8')
  if (stat.size > MAX_BYTES) {
    content += '\n\n... (truncated)'
  }

  const lineCount = content.split('\n').length

  return { type: 'text', content, lineCount }
}

function getXlsbPreview(filePath: string): PreviewData {
  const workbook = XLSX.readFile(filePath, { type: 'file' })
  const sheets: ExcelSheet[] = []
  const MAX_ROWS = 100

  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName]
    const jsonRows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })

    const headers = jsonRows.length > 0 ? jsonRows[0].map(v => String(v ?? '')) : []
    const dataRows = jsonRows.slice(1, MAX_ROWS + 1).map(row =>
      row.map(v => String(v ?? ''))
    )

    sheets.push({
      name: sheetName,
      headers,
      rows: dataRows,
      totalRows: Math.max(0, jsonRows.length - 1)
    })
  }

  return { type: 'excel', sheets }
}
