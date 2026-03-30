import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc-channels'
import type { NoteFilterState } from '../../shared/types'
import * as notesRepo from '../db/repositories/notes.repo'
import * as noteCatsRepo from '../db/repositories/note-categories.repo'

export function registerNoteHandlers(): void {
  // Notes
  ipcMain.handle(IPC.GET_NOTES, async (_event, filter: NoteFilterState) => {
    return notesRepo.getNotes(filter)
  })

  ipcMain.handle(IPC.GET_NOTE, async (_event, id: number) => {
    return notesRepo.getNoteById(id)
  })

  ipcMain.handle(IPC.CREATE_NOTE, async (_event, title: string, content: string) => {
    return notesRepo.createNote(title, content)
  })

  ipcMain.handle(IPC.UPDATE_NOTE, async (_event, id: number, title: string, content: string) => {
    return notesRepo.updateNote(id, title, content)
  })

  ipcMain.handle(IPC.DELETE_NOTE, async (_event, id: number) => {
    notesRepo.deleteNote(id)
  })

  ipcMain.handle(IPC.SET_NOTE_CATEGORY, async (_event, noteId: number, categoryId: number | null) => {
    notesRepo.setNoteCategory(noteId, categoryId)
  })

  ipcMain.handle(IPC.ADD_NOTE_TAG, async (_event, noteId: number, tagId: number) => {
    noteCatsRepo.addNoteTag(noteId, tagId)
  })

  ipcMain.handle(IPC.REMOVE_NOTE_TAG, async (_event, noteId: number, tagId: number) => {
    noteCatsRepo.removeNoteTag(noteId, tagId)
  })

  // Note Categories
  ipcMain.handle(IPC.GET_NOTE_CATEGORIES, async () => {
    return noteCatsRepo.getAllNoteCategories()
  })

  ipcMain.handle(IPC.CREATE_NOTE_CATEGORY, async (_event, name: string, color: string) => {
    return noteCatsRepo.createNoteCategory(name, color)
  })

  ipcMain.handle(IPC.UPDATE_NOTE_CATEGORY, async (_event, id: number, name: string, color: string) => {
    return noteCatsRepo.updateNoteCategory(id, name, color)
  })

  ipcMain.handle(IPC.DELETE_NOTE_CATEGORY, async (_event, id: number) => {
    noteCatsRepo.deleteNoteCategory(id)
  })

  // Note Tags
  ipcMain.handle(IPC.GET_NOTE_TAGS, async () => {
    return noteCatsRepo.getAllNoteTags()
  })

  ipcMain.handle(IPC.CREATE_NOTE_TAG, async (_event, name: string, color: string) => {
    return noteCatsRepo.createNoteTag(name, color)
  })

  ipcMain.handle(IPC.UPDATE_NOTE_TAG, async (_event, id: number, name: string, color: string) => {
    return noteCatsRepo.updateNoteTag(id, name, color)
  })

  ipcMain.handle(IPC.DELETE_NOTE_TAG, async (_event, id: number) => {
    noteCatsRepo.deleteNoteTag(id)
  })
}
