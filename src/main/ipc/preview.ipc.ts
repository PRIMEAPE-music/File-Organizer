import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import { getPreview } from '../services/preview.service'

export function registerPreviewHandlers(): void {
  ipcMain.handle(IPC.GET_PREVIEW, async (_event, filePath: string) => {
    return getPreview(filePath)
  })
}
