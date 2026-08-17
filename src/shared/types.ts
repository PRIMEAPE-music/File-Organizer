// ─── Database Entities ───

export interface ScannedFolder {
  id: number
  path: string
  recursive: number // 1 = include subfolders, 0 = top-level only
  added_at: string
}

export interface FileEntry {
  id: number
  folder_id: number
  name: string
  extension: string
  path: string
  size: number
  modified_at: string
  created_at: string
  category_id: number | null
  indexed_at: string
}

export interface Category {
  id: number
  name: string
  color: string
}

export interface Tag {
  id: number
  name: string
  color: string
}

export interface FileTag {
  file_id: number
  tag_id: number
}

export interface Favorite {
  id: number
  file_id: number
  added_at: string
}

export interface RecentEntry {
  id: number
  file_id: number
  opened_at: string
}

// ─── UI / Renderer Types ───

export interface FileWithMeta extends FileEntry {
  tags: Tag[]
  category: Category | null
  is_favorite: boolean
}

export type ViewMode = 'grid' | 'list'
export type SortField = 'name' | 'modified_at' | 'size' | 'extension' | 'folder'
export type SortDirection = 'asc' | 'desc'
export type ThemeMode = 'light' | 'dark'

export type SidebarView =
  | { type: 'all' }
  | { type: 'favorites' }
  | { type: 'recent' }
  | { type: 'category'; id: number }
  | { type: 'tag'; id: number }
  | { type: 'folder'; id: number }

export interface FilterState {
  search: string
  extensions: string[]
  sortField: SortField
  sortDirection: SortDirection
  sidebarView: SidebarView
}

// ─── Preview Types ───

export interface ExcelPreviewData {
  type: 'excel'
  sheets: ExcelSheet[]
}

export interface ExcelSheet {
  name: string
  headers: string[]
  rows: string[][]
  totalRows: number
}

export interface WordPreviewData {
  type: 'word'
  html: string
}

export interface PdfPreviewData {
  type: 'pdf'
  pages: { pageNumber: number; text: string }[]
  totalPages: number
}

export interface TextPreviewData {
  type: 'text'
  content: string
  lineCount: number
}

export type PreviewData = ExcelPreviewData | WordPreviewData | PdfPreviewData | TextPreviewData | { type: 'unsupported'; message: string }

// ─── App Tab ───

export type AppTab = 'files' | 'notes' | 'tasks'

// ─── Notes Domain ───

export interface Note {
  id: number
  title: string
  content: string
  category_id: number | null
  created_at: string
  updated_at: string
}

export interface NoteWithMeta extends Note {
  tags: NoteTag[]
  category: NoteCategory | null
}

export interface NoteCategory {
  id: number
  name: string
  color: string
}

export interface NoteTag {
  id: number
  name: string
  color: string
}

export type NoteSortField = 'title' | 'updated_at' | 'created_at'

export type NoteSidebarView =
  | { type: 'all' }
  | { type: 'category'; id: number }
  | { type: 'tag'; id: number }

export interface NoteFilterState {
  search: string
  sortField: NoteSortField
  sortDirection: SortDirection
  sidebarView: NoteSidebarView
}

// ─── Tasks Domain ───

export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskViewMode = 'list' | 'board'

export interface Task {
  id: number
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  sort_order: number
  category_id: number | null
  created_at: string
  updated_at: string
}

export interface TaskWithMeta extends Task {
  tags: TaskTag[]
  category: TaskCategory | null
}

export interface TaskCategory {
  id: number
  name: string
  color: string
}

export interface TaskTag {
  id: number
  name: string
  color: string
}

export type TaskSortField = 'title' | 'priority' | 'due_date' | 'created_at' | 'sort_order'

export type TaskSidebarView =
  | { type: 'all' }
  | { type: 'status'; status: TaskStatus }
  | { type: 'priority'; priority: TaskPriority }
  | { type: 'category'; id: number }
  | { type: 'tag'; id: number }

export interface TaskFilterState {
  search: string
  sortField: TaskSortField
  sortDirection: SortDirection
  sidebarView: TaskSidebarView
}

// ─── Window Mode ───

export type WindowMode = 'normal' | 'widget'
export type WidgetState = 'collapsed' | 'expanded'

// ─── Sync ───

export interface SyncConfig {
  enabled: boolean
  syncPath: string
  lastSyncedAt: string | null
  autoSync: boolean
}

export interface SyncResult {
  success: boolean
  message: string
  exportedAt?: string
}

export interface SyncPreferences {
  theme: string
  viewMode: string
  sidebarCollapsed: boolean
  activeTab: string
}

export interface SyncNowResult {
  success: boolean
  message: string
  importedNewData: boolean
  preferences: SyncPreferences | null
  exportedAt?: string
}

// ─── IPC Return Types ───

export interface FolderScanResult {
  folder: ScannedFolder
  fileCount: number
}

export interface PaginatedFiles {
  files: FileWithMeta[]
  total: number
}
