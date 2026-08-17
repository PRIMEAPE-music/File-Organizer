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

  // ─── Reminders ───
  GET_REMINDERS: 'reminders:get-all',
  GET_REMINDER: 'reminders:get-one',
  CREATE_REMINDER: 'reminders:create',
  UPDATE_REMINDER: 'reminders:update',
  DELETE_REMINDER: 'reminders:delete',
  SET_REMINDER_ENABLED: 'reminders:set-enabled',
  /** Hand a reminder detached by a timing edit back to its task's due date. */
  RESET_REMINDER_TO_AUTO: 'reminders:reset-to-auto',
  SNOOZE_OCCURRENCE: 'reminders:snooze-occurrence',
  DISMISS_OCCURRENCE: 'reminders:dismiss-occurrence',
  SNOOZE_ALL_REMINDERS: 'reminders:snooze-all',
  TEST_FIRE_REMINDER: 'reminders:test-fire',
  GET_TASK_REMINDER: 'reminders:get-for-task',
  SET_TASK_REMINDER: 'reminders:set-for-task',

  // Alert window (the popup/blackout surface talks over these)
  REMINDER_ALERT_GET: 'reminder-alert:get',
  REMINDER_ALERT_ACK: 'reminder-alert:ack',
  REMINDER_ALERT_SNOOZE: 'reminder-alert:snooze',

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

  // ─── Sync ───
  SYNC_GET_CONFIG: 'sync:get-config',
  SYNC_SET_CONFIG: 'sync:set-config',
  SYNC_SELECT_FOLDER: 'sync:select-folder',
  SYNC_UPDATE_PREFS: 'sync:update-prefs',
  SYNC_GET_SYNCED_PREFS: 'sync:get-synced-prefs',
  SYNC_EXPORT: 'sync:export',
  SYNC_IMPORT: 'sync:import',
  SYNC_NOW: 'sync:now',

  // ─── App Preferences (tray / autostart) ───
  APP_PREFS_GET: 'app-prefs:get',
  APP_PREFS_SET: 'app-prefs:set',

  // ─── Persistence Failures ───
  PERSISTENCE_GET_PENDING: 'persistence:get-pending',

  // Events (main → renderer)
  FILES_CHANGED: 'event:files-changed',
  SCAN_PROGRESS: 'event:scan-progress',
  WINDOW_MODE_CHANGED: 'event:window-mode-changed',
  WIDGET_STATE_CHANGED: 'event:widget-state-changed',
  PERSISTENCE_ISSUE: 'event:persistence-issue',
  REMINDERS_CHANGED: 'event:reminders-changed',
  REMINDER_ALERT_CHANGED: 'event:reminder-alert-changed'
} as const
