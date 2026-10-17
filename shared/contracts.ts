import type { AttachCue, CueRequest, PreparedCue, ServiceSessionView } from './service-session'
import type { SaveServicePlan } from './service-plan'
import type { AppUpdateState } from './app-update'
import type { OutputResource, PreparedOutput, ExternalOutputStatus } from './output-resources'
import type { ConnectionProfile, SongJob, ApplyReceipt } from './song-preparation'
import type { SetlistCommand, SetlistWorkspace } from './setlists'
import type { Presentation, PlaylistItem, MediaItem, OutputState } from '../src/types'
import type { z } from 'zod'
import type { SettingsSchema, DeletedLibrarySchema, DeletedMediaSchema } from './schema'
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
  serviceTimer: import('./service-timer').TimerRuntime | null
  stageMessage: import('./stage-message').StageMessageStatus
  serviceSession: ServiceSessionView | null
  deletedLibrary: z.infer<typeof DeletedLibrarySchema>
  deletedMedia: z.infer<typeof DeletedMediaSchema>
  outputResources: OutputResource[]
  externalOutput: ExternalOutputStatus
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
  previewCuesheet(
    request: import('zod').z.infer<typeof import('./cuesheet').CuesheetRequest>,
  ): Promise<import('./cuesheet').CuesheetJob>
  getCuesheetStatus(id: string): Promise<import('./cuesheet').CuesheetJob>
  closeCuesheet(id: string): Promise<void>
  saveCuesheet(id: string): Promise<FileResult>
  printCuesheet(id: string): Promise<FileResult>
  revealCuesheet(id: string): Promise<void>
  manageServiceTemplate(
    command: import('./service-template').TemplateAction,
  ): Promise<SetlistWorkspace>
  saveTemplateFile(expected: { id: string; revision: number }): Promise<FileResult>
  loadTemplateFile(): Promise<FileResult>
  serviceTimer(
    command: import('./service-timer').TimerAction,
  ): Promise<import('./service-timer').TimerRuntime | null>
  takeSection(command: import('./sections').SectionTake): Promise<void>
  preflight(
    command: import('./preflight').PreflightAction,
  ): Promise<import('./preflight').PreflightRun | null>
  stageMessage(
    command: import('./stage-message').StageMessageAction,
  ): Promise<import('./stage-message').StageMessageStatus>
  acknowledgeStageMessage(id: string, revision: number, fits: boolean): void
  saveServiceFile(expected: { id: string; revision: number }): Promise<FileResult>
  loadServiceFile(expected: import('./service-session').ServiceFileTarget): Promise<FileResult>
  attachServiceCue(command: AttachCue): Promise<SetlistWorkspace>
  prepareServiceCue(command: CueRequest): Promise<PreparedCue>
  commitServiceCue(token: string): Promise<ServiceSessionView>
  finishService(skip?: boolean): Promise<ServiceSessionView | null>
  getAppUpdate(): Promise<AppUpdateState>
  checkAppUpdate(): Promise<AppUpdateState>
  downloadAppUpdate(): Promise<AppUpdateState>
  pdfOutputThumbnails(request: {
    id: string
    revision: number
    start: number
    rotation?: 0 | 90 | 180 | 270
  }): Promise<{ page: number; url: string }[]>
  pdfOutputReady(): void
  pdfOutputResult(result: { id: string; png?: string; pages?: number; error?: boolean }): void
  listOutputResources(): Promise<OutputResource[]>
  manageOutputResource(command: unknown): Promise<OutputResource[]>
  selectOutputPDFs(): Promise<{ resources: OutputResource[]; errors: string[] }>
  prepareOutputResource(request: {
    resourceId: string
    revision: number
    page?: number
    rotation?: 0 | 90 | 180 | 270
  }): Promise<PreparedOutput>
  commitOutputResource(token: string, generation: number): Promise<ExternalOutputStatus>
  returnToSlides(): Promise<void>
  stopExternalOutput(): Promise<void>
  browserOutputCommand(command: unknown): Promise<ExternalOutputStatus>
  getExternalOutput(): Promise<ExternalOutputStatus>
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
  role: 'control' | 'main' | 'stage' | 'preview' | 'pdf-helper'
  send(channel: string, data?: unknown): void
  on(channel: string, callback: (...args: any[]) => void): () => void
  ready(): void
  acknowledge(version: number): void
  reportMediaError(): void
  bootstrap(): Promise<Bootstrap>
  getLibrary(): Promise<Presentation[]>
  getPlaylist(): Promise<PlaylistItem[]>
  saveServicePlan(command: SaveServicePlan): Promise<SetlistWorkspace>
  manageSetlist(command: SetlistCommand): Promise<SetlistWorkspace>
  publishSetlistSong(id: string): Promise<FileResult>
  saveToLibrary(p: Presentation): Promise<boolean>
  saveDraft(p: Presentation): Promise<Presentation[]>
  mergeToLibrary(p: Presentation[]): Promise<Presentation[]>
  deleteFromLibrary(id: string): Promise<Presentation[]>
  restoreDeleted(kind: 'library' | 'media', id: string): Promise<void>
  savePlaylist(p: PlaylistItem[]): Promise<boolean>
  saveSettings(settings: Settings): Promise<void>
  saveMedia(media: MediaItem[]): Promise<void>
  saveMusic(command: import('./music').SaveMusic): Promise<SetlistWorkspace>
  musicBridge(
    action: 'status' | 'pause' | 'play' | 'setup' | 'disconnect' | 'confirm-stop',
    args?: { url?: string; extensionId?: string; bindingId?: string },
  ): Promise<import('./music').MusicBridgeState>
  openMusicURL(url: string): Promise<void>
  prepareMusicURL(url: string): Promise<import('./music').MusicBridgeState>
  showMusicExtension(): Promise<void>
  pinMusic(urls: string[]): Promise<void>
  selectMediaFiles(): Promise<string[]>
  cleanupMedia(): Promise<number>
  relinkMedia(): Promise<void>
  saveProject(data: string): Promise<FileResult>
  loadProject(): Promise<FileResult>
  savePlaylistFile(expected: Pick<PlaylistItem, 'id' | 'presentationId'>[]): Promise<FileResult>
  loadPlaylistFile(
    expected: Pick<PlaylistItem, 'id' | 'presentationId'>[],
    append?: boolean,
  ): Promise<FileResult>
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
