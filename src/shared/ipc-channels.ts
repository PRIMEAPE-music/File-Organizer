export const IPC = {
  // Folders
  SELECT_FOLDER: 'folder:select',
  ADD_FOLDER: 'folder:add',
  REMOVE_FOLDER: 'folder:remove',
  GET_FOLDERS: 'folder:get-all',
  RESCAN_FOLDER: 'folder:rescan',

  // Files
  GET_FILES: 'files:get',
  SEARCH_FILES: 'files:search',
  OPEN_FILE: 'files:open',
  OPEN_FILE_LOCATION: 'files:open-location',
  GET_FILE: 'files:get-one',

  // Categories
  GET_CATEGORIES: 'categories:get-all',
  CREATE_CATEGORY: 'categories:create',
  UPDATE_CATEGORY: 'categories:update',
  DELETE_CATEGORY: 'categories:delete',
  SET_FILE_CATEGORY: 'files:set-category',

  // Tags
  GET_TAGS: 'tags:get-all',
  CREATE_TAG: 'tags:create',
  UPDATE_TAG: 'tags:update',
  DELETE_TAG: 'tags:delete',
  ADD_FILE_TAG: 'files:add-tag',
  REMOVE_FILE_TAG: 'files:remove-tag',
  GET_FILE_TAGS: 'files:get-tags',

  // Favorites
  TOGGLE_FAVORITE: 'favorites:toggle',
  GET_FAVORITES: 'favorites:get-all',
  IS_FAVORITE: 'favorites:is',

  // Recents
  GET_RECENTS: 'recents:get-all',
  ADD_RECENT: 'recents:add',

  // Preview
  GET_PREVIEW: 'preview:get',

  // ─── Notes ───
  GET_NOTES: 'notes:get-all',
  GET_NOTE: 'notes:get-one',
  CREATE_NOTE: 'notes:create',
  UPDATE_NOTE: 'notes:update',
  DELETE_NOTE: 'notes:delete',
  SET_NOTE_CATEGORY: 'notes:set-category',
  ADD_NOTE_TAG: 'notes:add-tag',
  REMOVE_NOTE_TAG: 'notes:remove-tag',

  // Note Categories
  GET_NOTE_CATEGORIES: 'note-categories:get-all',
  CREATE_NOTE_CATEGORY: 'note-categories:create',
  UPDATE_NOTE_CATEGORY: 'note-categories:update',
  DELETE_NOTE_CATEGORY: 'note-categories:delete',

  // Note Tags
  GET_NOTE_TAGS: 'note-tags:get-all',
  CREATE_NOTE_TAG: 'note-tags:create',
  UPDATE_NOTE_TAG: 'note-tags:update',
  DELETE_NOTE_TAG: 'note-tags:delete',

  // ─── Tasks ───
  GET_TASKS: 'tasks:get-all',
  GET_TASK: 'tasks:get-one',
  CREATE_TASK: 'tasks:create',
  UPDATE_TASK: 'tasks:update',
  DELETE_TASK: 'tasks:delete',
  REORDER_TASK: 'tasks:reorder',
  SET_TASK_CATEGORY: 'tasks:set-category',
  ADD_TASK_TAG: 'tasks:add-tag',
  REMOVE_TASK_TAG: 'tasks:remove-tag',

  // Task Categories
  GET_TASK_CATEGORIES: 'task-categories:get-all',
  CREATE_TASK_CATEGORY: 'task-categories:create',
  UPDATE_TASK_CATEGORY: 'task-categories:update',
  DELETE_TASK_CATEGORY: 'task-categories:delete',

  // Task Tags
  GET_TASK_TAGS: 'task-tags:get-all',
  CREATE_TASK_TAG: 'task-tags:create',
  UPDATE_TASK_TAG: 'task-tags:update',
  DELETE_TASK_TAG: 'task-tags:delete',

  // ─── Window Management ───
  SET_WINDOW_MODE: 'window:set-mode',
  GET_WINDOW_MODE: 'window:get-mode',
  TOGGLE_WIDGET: 'window:toggle-widget',
  GET_WIDGET_STATE: 'window:get-widget-state',
  SET_WIDGET_WIDTH: 'window:set-widget-width',
  MINIMIZE_WINDOW: 'window:minimize',
  MAXIMIZE_WINDOW: 'window:maximize',
  CLOSE_WINDOW: 'window:close',

  // Drag
  START_DRAG: 'drag:start',

  // Events (main → renderer)
  FILES_CHANGED: 'event:files-changed',
  SCAN_PROGRESS: 'event:scan-progress',
  WINDOW_MODE_CHANGED: 'event:window-mode-changed',
  WIDGET_STATE_CHANGED: 'event:widget-state-changed'
} as const
