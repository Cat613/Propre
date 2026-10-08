import type { ConnectionProfile, SongJob, ApplyReceipt } from './song-preparation'
import type { SetlistCommand, SetlistWorkspace } from './setlists'
import type { Presentation, PlaylistItem, MediaItem, OutputState } from '../src/types'
import type { z } from 'zod'
import type { SettingsSchema } from './schema'
import type { AIConnectionState, AICommandResult } from './automation'
export type Settings = z.infer<typeof SettingsSchema>
export type SaveState = 'saved' | 'pending' | 'saving' | 'error'
export interface FileResult {
  success: boolean
  canceled?: boolean
  data?: string
  filePath?: string
  error?: string
  restored?: boolean
  added?: number
  reused?: number
  itemCount?: number
}
export interface Bootstrap extends SetlistWorkspace {
  live?: OutputState | null
  library: Presentation[]
  playlist: PlaylistItem[]
  draft: Presentation | null
  settings: Settings
  media: MediaItem[]
  warnings: string[]
  outputEnabled: boolean
  stageEnabled: boolean
}
export interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  isPrimary: boolean
}
export interface ScreenHealth {
  screen: 'main' | 'stage'
  version: number
  applied: number
  status: 'closed' | 'loading' | 'applied' | 'error'
  error?: string
}
export interface API {
  listAIProfiles(): Promise<{
    profiles: (ConnectionProfile & { configured: boolean })[]
    defaultId: string | null
  }>
  saveAIProfile(
    profile: ConnectionProfile,
    key: string | null,
    defaultConnection: boolean,
  ): Promise<{
    profiles: (ConnectionProfile & { configured: boolean })[]
    defaultId: string | null
  }>
  removeAIProfile(id: string): Promise<{
    profiles: (ConnectionProfile & { configured: boolean })[]
    defaultId: string | null
  }>
  listSongJobs(): Promise<SongJob[]>
  selectSongFiles(options: {
    profileId: string
    instruction: string
    mode: 'append' | 'replace'
    automatic: boolean
  }): Promise<SongJob | null>
  dropSongFiles(
    files: File[],
    options: {
      profileId: string
      instruction: string
      mode: 'append' | 'replace'
      automatic: boolean
    },
  ): Promise<SongJob | null>
  songSource(id: string, sourceId: string): Promise<{ mime: string; data: string; pages: number }>
  switchSongAI(id: string, profileId: string): Promise<SongJob>
  analyzeSongJob(id: string, sourceIds?: string[]): Promise<SongJob>
  cancelSongJob(id: string): Promise<SongJob>
  editSongJob(id: string, args: unknown): Promise<SongJob>
  rebaseSongJob(id: string): Promise<SongJob>
  applySongJob(id: string, revision: number): Promise<{ job: SongJob; receipt: ApplyReceipt }>
  undoSongJob(id: string): Promise<ApplyReceipt | null>
  songReceipt(id: string): Promise<ApplyReceipt | null>
  retainSongSources(id: string, keep: boolean): Promise<SongJob>
  removeSongJob(id: string): Promise<void>
  songPreview(
    id: string,
    songId: string,
    index: number,
  ): Promise<{ png: string; slideCount: number }>
  role: 'control' | 'main' | 'stage' | 'preview'
  send(channel: string, data?: unknown): void
  on(channel: string, callback: (...args: any[]) => void): () => void
  ready(): void
  acknowledge(version: number): void
  reportMediaError(): void
  bootstrap(): Promise<Bootstrap>
  getLibrary(): Promise<Presentation[]>
  getPlaylist(): Promise<PlaylistItem[]>
  manageSetlist(command: SetlistCommand): Promise<SetlistWorkspace>
  publishSetlistSong(id: string): Promise<FileResult>
  saveToLibrary(p: Presentation): Promise<boolean>
  saveDraft(p: Presentation): Promise<Presentation[]>
  mergeToLibrary(p: Presentation[]): Promise<Presentation[]>
  deleteFromLibrary(id: string): Promise<Presentation[]>
  savePlaylist(p: PlaylistItem[]): Promise<boolean>
  saveSettings(settings: Settings): Promise<void>
  saveMedia(media: MediaItem[]): Promise<void>
  selectMediaFiles(): Promise<string[]>
  cleanupMedia(): Promise<number>
  relinkMedia(): Promise<void>
  saveProject(data: string): Promise<FileResult>
  loadProject(): Promise<FileResult>
  savePlaylistFile(expected: Pick<PlaylistItem, 'id' | 'presentationId'>[]): Promise<FileResult>
  loadPlaylistFile(expected: Pick<PlaylistItem, 'id' | 'presentationId'>[]): Promise<FileResult>
  createBackup(): Promise<FileResult>
  restoreBackup(): Promise<FileResult>
  recoverPrevious(): Promise<void>
  getDisplays(): Promise<DisplayInfo[]>
  getActiveDisplays(): Promise<{ outputDisplayId: number | null; stageDisplayId: number | null }>
  setOutputDisplay(id: number): Promise<void>
  setStageDisplay(id: number): Promise<void>
  toggleStage(): Promise<boolean>
  toggleOutput(): Promise<boolean>
  getOutputStatus(): Promise<boolean>
  getStageStatus(): Promise<boolean>
  closeReady(success: boolean): void
  getAIConnection(): Promise<AIConnectionState>
  setAIConnection(enabled: boolean, permission: 'read' | 'prepare'): Promise<AIConnectionState>
  copyAIConnectionConfig(format: 'codex' | 'json'): Promise<void>
  completeAICommand(id: string, result: AICommandResult): Promise<void>
  checkAICommand(id: string): Promise<boolean>
  savePreparedPresentation(
    presentation: Presentation,
    expectedRevision: number | null,
  ): Promise<{ presentation?: Presentation; error?: { code: string; message: string } }>
  savePreparedPlaylist(
    items: Pick<PlaylistItem, 'id' | 'presentationId'>[],
    expected: Pick<PlaylistItem, 'id' | 'presentationId'>[],
  ): Promise<{ error?: { code: string; message: string } }>
  previewRendered(id: string): void
}
