import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type {
  FilterState,
  ScannedFolder,
  FileWithMeta,
  Category,
  Tag,
  FolderScanResult,
  PreviewData,
  NoteFilterState,
  NoteWithMeta,
  NoteCategory,
  NoteTag,
  TaskFilterState,
  TaskWithMeta,
  TaskCategory,
  TaskTag,
  TaskStatus,
  WindowMode,
  WidgetState,
  SyncConfig,
  SyncResult,
  SyncPreferences,
  SyncNowResult
} from '../shared/types'

const api = {
  // Folders
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.SELECT_FOLDER),
  addFolder: (path: string, recursive?: boolean): Promise<FolderScanResult> =>
    ipcRenderer.invoke(IPC.ADD_FOLDER, path, recursive ?? true),
  removeFolder: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC.REMOVE_FOLDER, id),
  getFolders: (): Promise<ScannedFolder[]> =>
    ipcRenderer.invoke(IPC.GET_FOLDERS),
  rescanFolder: (id: number): Promise<number> =>
    ipcRenderer.invoke(IPC.RESCAN_FOLDER, id),

  // Files
  getFiles: (filter: FilterState): Promise<FileWithMeta[]> =>
    ipcRenderer.invoke(IPC.GET_FILES, filter),
  searchFiles: (query: string): Promise<FileWithMeta[]> =>
    ipcRenderer.invoke(IPC.SEARCH_FILES, query),
  getFile: (id: number): Promise<FileWithMeta | undefined> =>
    ipcRenderer.invoke(IPC.GET_FILE, id),
  openFile: (fileId: number): Promise<boolean> =>
    ipcRenderer.invoke(IPC.OPEN_FILE, fileId),
  openFileLocation: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.OPEN_FILE_LOCATION, filePath),
  setFileCategory: (fileId: number, categoryId: number | null): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_FILE_CATEGORY, fileId, categoryId),

  // Categories
  getCategories: (): Promise<Category[]> =>
    ipcRenderer.invoke(IPC.GET_CATEGORIES),
  createCategory: (name: string, color: string): Promise<Category> =>
    ipcRenderer.invoke(IPC.CREATE_CATEGORY, name, color),
  updateCategory: (id: number, name: string, color: string): Promise<Category> =>
    ipcRenderer.invoke(IPC.UPDATE_CATEGORY, id, name, color),
  deleteCategory: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC.DELETE_CATEGORY, id),

  // Tags
  getTags: (): Promise<Tag[]> =>
    ipcRenderer.invoke(IPC.GET_TAGS),
  createTag: (name: string, color: string): Promise<Tag> =>
    ipcRenderer.invoke(IPC.CREATE_TAG, name, color),
  updateTag: (id: number, name: string, color: string): Promise<Tag> =>
    ipcRenderer.invoke(IPC.UPDATE_TAG, id, name, color),
  deleteTag: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC.DELETE_TAG, id),
  addFileTag: (fileId: number, tagId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.ADD_FILE_TAG, fileId, tagId),
  removeFileTag: (fileId: number, tagId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.REMOVE_FILE_TAG, fileId, tagId),
  getFileTags: (fileId: number): Promise<Tag[]> =>
    ipcRenderer.invoke(IPC.GET_FILE_TAGS, fileId),

  // Favorites
  toggleFavorite: (fileId: number): Promise<boolean> =>
    ipcRenderer.invoke(IPC.TOGGLE_FAVORITE, fileId),

  // Preview
  getPreview: (filePath: string): Promise<PreviewData> =>
    ipcRenderer.invoke(IPC.GET_PREVIEW, filePath),

  // ─── Notes ───
  getNotes: (filter: NoteFilterState): Promise<NoteWithMeta[]> =>
    ipcRenderer.invoke(IPC.GET_NOTES, filter),
  getNote: (id: number): Promise<NoteWithMeta | undefined> =>
    ipcRenderer.invoke(IPC.GET_NOTE, id),
  createNote: (title: string, content: string): Promise<NoteWithMeta> =>
    ipcRenderer.invoke(IPC.CREATE_NOTE, title, content),
  updateNote: (id: number, title: string, content: string): Promise<NoteWithMeta> =>
    ipcRenderer.invoke(IPC.UPDATE_NOTE, id, title, content),
  deleteNote: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC.DELETE_NOTE, id),
  setNoteCategory: (noteId: number, categoryId: number | null): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_NOTE_CATEGORY, noteId, categoryId),
  addNoteTag: (noteId: number, tagId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.ADD_NOTE_TAG, noteId, tagId),
  removeNoteTag: (noteId: number, tagId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.REMOVE_NOTE_TAG, noteId, tagId),

  // Note Categories
  getNoteCategories: (): Promise<NoteCategory[]> =>
    ipcRenderer.invoke(IPC.GET_NOTE_CATEGORIES),
  createNoteCategory: (name: string, color: string): Promise<NoteCategory> =>
    ipcRenderer.invoke(IPC.CREATE_NOTE_CATEGORY, name, color),
  updateNoteCategory: (id: number, name: string, color: string): Promise<NoteCategory> =>
    ipcRenderer.invoke(IPC.UPDATE_NOTE_CATEGORY, id, name, color),
  deleteNoteCategory: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC.DELETE_NOTE_CATEGORY, id),

  // Note Tags
  getNoteTags: (): Promise<NoteTag[]> =>
    ipcRenderer.invoke(IPC.GET_NOTE_TAGS),
  createNoteTag: (name: string, color: string): Promise<NoteTag> =>
    ipcRenderer.invoke(IPC.CREATE_NOTE_TAG, name, color),
  updateNoteTag: (id: number, name: string, color: string): Promise<NoteTag> =>
    ipcRenderer.invoke(IPC.UPDATE_NOTE_TAG, id, name, color),
  deleteNoteTag: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC.DELETE_NOTE_TAG, id),

  // ─── Tasks ───
  getTasks: (filter: TaskFilterState): Promise<TaskWithMeta[]> =>
    ipcRenderer.invoke(IPC.GET_TASKS, filter),
  getTask: (id: number): Promise<TaskWithMeta | undefined> =>
    ipcRenderer.invoke(IPC.GET_TASK, id),
  createTask: (data: { title: string; description?: string; status?: string; priority?: string; due_date?: string | null; category_id?: number | null }): Promise<TaskWithMeta> =>
    ipcRenderer.invoke(IPC.CREATE_TASK, data),
  updateTask: (id: number, data: { title?: string; description?: string; status?: string; priority?: string; due_date?: string | null; category_id?: number | null }): Promise<TaskWithMeta> =>
    ipcRenderer.invoke(IPC.UPDATE_TASK, id, data),
  deleteTask: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC.DELETE_TASK, id),
  reorderTask: (id: number, status: TaskStatus, sortOrder: number): Promise<void> =>
    ipcRenderer.invoke(IPC.REORDER_TASK, id, status, sortOrder),
  setTaskCategory: (taskId: number, categoryId: number | null): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_TASK_CATEGORY, taskId, categoryId),
  addTaskTag: (taskId: number, tagId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.ADD_TASK_TAG, taskId, tagId),
  removeTaskTag: (taskId: number, tagId: number): Promise<void> =>
    ipcRenderer.invoke(IPC.REMOVE_TASK_TAG, taskId, tagId),

  // Task Categories
  getTaskCategories: (): Promise<TaskCategory[]> =>
    ipcRenderer.invoke(IPC.GET_TASK_CATEGORIES),
  createTaskCategory: (name: string, color: string): Promise<TaskCategory> =>
    ipcRenderer.invoke(IPC.CREATE_TASK_CATEGORY, name, color),
  updateTaskCategory: (id: number, name: string, color: string): Promise<TaskCategory> =>
    ipcRenderer.invoke(IPC.UPDATE_TASK_CATEGORY, id, name, color),
  deleteTaskCategory: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC.DELETE_TASK_CATEGORY, id),

  // Task Tags
  getTaskTags: (): Promise<TaskTag[]> =>
    ipcRenderer.invoke(IPC.GET_TASK_TAGS),
  createTaskTag: (name: string, color: string): Promise<TaskTag> =>
    ipcRenderer.invoke(IPC.CREATE_TASK_TAG, name, color),
  updateTaskTag: (id: number, name: string, color: string): Promise<TaskTag> =>
    ipcRenderer.invoke(IPC.UPDATE_TASK_TAG, id, name, color),
  deleteTaskTag: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC.DELETE_TASK_TAG, id),

  // ─── Sync ───
  getSyncConfig: (): Promise<SyncConfig> =>
    ipcRenderer.invoke(IPC.SYNC_GET_CONFIG),
  setSyncConfig: (config: SyncConfig): Promise<void> =>
    ipcRenderer.invoke(IPC.SYNC_SET_CONFIG, config),
  syncSelectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.SYNC_SELECT_FOLDER),
  syncUpdatePrefs: (prefs: SyncPreferences): Promise<void> =>
    ipcRenderer.invoke(IPC.SYNC_UPDATE_PREFS, prefs),
  syncGetSyncedPrefs: (): Promise<SyncPreferences | null> =>
    ipcRenderer.invoke(IPC.SYNC_GET_SYNCED_PREFS),
  syncExport: (prefs: SyncPreferences): Promise<SyncResult> =>
    ipcRenderer.invoke(IPC.SYNC_EXPORT, prefs),
  syncImport: (): Promise<{ result: SyncResult; preferences: SyncPreferences | null }> =>
    ipcRenderer.invoke(IPC.SYNC_IMPORT),
  syncNow: (prefs: SyncPreferences): Promise<SyncNowResult> =>
    ipcRenderer.invoke(IPC.SYNC_NOW, prefs),

  // Drag
  startDrag: (filePaths: string[]): void => {
    ipcRenderer.send(IPC.START_DRAG, filePaths)
  },

  // ─── Window Management ───
  setWindowMode: (mode: WindowMode): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_WINDOW_MODE, mode),
  getWindowMode: (): Promise<WindowMode> =>
    ipcRenderer.invoke(IPC.GET_WINDOW_MODE),
  toggleWidgetState: (): Promise<void> =>
    ipcRenderer.invoke(IPC.TOGGLE_WIDGET),
  setWidgetWidth: (width: number): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_WIDGET_WIDTH, width),
  getWidgetState: (): Promise<WidgetState> =>
    ipcRenderer.invoke(IPC.GET_WIDGET_STATE),
  minimizeWindow: (): Promise<void> =>
    ipcRenderer.invoke(IPC.MINIMIZE_WINDOW),
  maximizeWindow: (): Promise<void> =>
    ipcRenderer.invoke(IPC.MAXIMIZE_WINDOW),
  closeWindow: (): Promise<void> =>
    ipcRenderer.invoke(IPC.CLOSE_WINDOW),

  // Events
  onFilesChanged: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on(IPC.FILES_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.FILES_CHANGED, handler)
  },
  onWindowModeChanged: (callback: (mode: WindowMode) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, mode: WindowMode): void => callback(mode)
    ipcRenderer.on(IPC.WINDOW_MODE_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.WINDOW_MODE_CHANGED, handler)
  },
  onWidgetStateChanged: (callback: (state: WidgetState) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, state: WidgetState): void => callback(state)
    ipcRenderer.on(IPC.WIDGET_STATE_CHANGED, handler)
    return () => ipcRenderer.removeListener(IPC.WIDGET_STATE_CHANGED, handler)
  }
}

export type ElectronAPI = typeof api

contextBridge.exposeInMainWorld('api', api)
