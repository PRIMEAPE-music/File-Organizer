import { ipcMain, nativeImage } from 'electron'
import { IPC } from '../../shared/ipc-channels'

export function registerDragHandlers(): void {
  ipcMain.on(IPC.START_DRAG, (event, filePaths: string[]) => {
    // Create a small generic file icon for the drag operation
    const icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAABhSURBVFhH7c4xDQAgDETRsgBLOMACFrCMBQxgAQtYYIAFGIDJX6BJk37TXO5LRmY2N3fvB+0BRGaGqv7QHkBkZqjqD+0BRGaGqv7QHkBkZqjqD+0BRGaGqv7QHkBk9gAeD1yh+pMvegAAAABJRU5ErkJggg=='
    )

    if (filePaths.length === 1) {
      event.sender.startDrag({
        file: filePaths[0],
        icon
      })
    } else if (filePaths.length > 1) {
      event.sender.startDrag({
        files: filePaths,
        icon
      })
    }
  })
}
