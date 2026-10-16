import { contextBridge, ipcRenderer, webUtils } from 'electron'
const role = process.argv.find((a) => a.startsWith('--propre-role='))?.split('=')[1] || 'main'
const control = role === 'control'
const receiving = control
  ? [
      'app-update-changed',
      'service-session-changed',
      'service-cue-applied',
      'stage-message-status',
      'preflight-changed',
      'service-timer-changed',
      'output-status-changed',
      'external-output-status',
      'output-resources-changed',
      'browser-output-frame',
      'external-output-stop',
      'stage-status-changed',
      'screen-health',
      'displays-changed',
      'operation-warning',
      'request-flush',
      'ai-command',
      'ai-connection-changed',
      'song-job-changed',
    ]
  : role === 'pdf-helper'
    ? ['pdf-output-render']
    : role === 'stage'
      ? ['update-stage', 'stage-message', 'service-timer-stage']
      : role === 'preview'
        ? ['ai-preview']
        : ['update-screen']
const sending = control ? ['route-screen-update', 'update-stage'] : []
const methods: Record<string, string> = {
  previewCuesheet: 'preview-cuesheet',
  getCuesheetStatus: 'get-cuesheet-status',
  closeCuesheet: 'close-cuesheet',
  saveCuesheet: 'save-cuesheet',
  printCuesheet: 'print-cuesheet',
  revealCuesheet: 'reveal-cuesheet',
  manageServiceTemplate: 'manage-service-template',
  saveTemplateFile: 'save-template-file',
  loadTemplateFile: 'load-template-file',
  serviceTimer: 'service-timer-command',
  takeSection: 'take-section',
  preflight: 'preflight-command',
  stageMessage: 'stage-message-command',
  getAppUpdate: 'get-app-update',
  checkAppUpdate: 'check-app-update',
  downloadAppUpdate: 'download-app-update',
  pdfOutputThumbnails: 'pdf-output-thumbnails',
  listOutputResources: 'list-output-resources',
  manageOutputResource: 'manage-output-resource',
  selectOutputPDFs: 'select-output-pdfs',
  prepareOutputResource: 'prepare-output-resource',
  commitOutputResource: 'commit-output-resource',
  returnToSlides: 'return-to-slides',
  stopExternalOutput: 'stop-external-output',
  browserOutputCommand: 'browser-output-command',
  getExternalOutput: 'get-external-output',
  listAIProfiles: 'list-ai-profiles',
  saveAIProfile: 'save-ai-profile',
  removeAIProfile: 'remove-ai-profile',
  listSongJobs: 'list-song-jobs',
  selectSongFiles: 'select-song-files',
  songSource: 'song-source',
  switchSongAI: 'switch-song-ai',
  analyzeSongJob: 'analyze-song-job',
  cancelSongJob: 'cancel-song-job',
  editSongJob: 'edit-song-job',
  rebaseSongJob: 'rebase-song-job',
  applySongJob: 'apply-song-job',
  undoSongJob: 'undo-song-job',
  songReceipt: 'song-receipt',
  retainSongSources: 'retain-song-sources',
  removeSongJob: 'remove-song-job',
  songPreview: 'song-preview',
  bootstrap: 'bootstrap',
  getLibrary: 'get-library',
  getPlaylist: 'get-playlist',
  manageSetlist: 'manage-setlist',
  saveServicePlan: 'save-service-plan',
  saveServiceFile: 'save-service-file',
  loadServiceFile: 'load-service-file',
  attachServiceCue: 'attach-service-cue',
  prepareServiceCue: 'prepare-service-cue',
  commitServiceCue: 'commit-service-cue',
  finishService: 'finish-service',
  publishSetlistSong: 'publish-setlist-song',
  saveToLibrary: 'save-to-library',
  saveDraft: 'save-draft',
  mergeToLibrary: 'merge-to-library',
  restoreDeleted: 'restore-deleted',
  deleteFromLibrary: 'delete-from-library',
  savePlaylist: 'save-playlist',
  saveSettings: 'save-settings',
  saveMedia: 'save-media',
  selectMediaFiles: 'dialog:openFile',
  cleanupMedia: 'cleanup-media',
  relinkMedia: 'relink-media',
  saveProject: 'save-project',
  loadProject: 'load-project',
  savePlaylistFile: 'save-playlist-file',
  loadPlaylistFile: 'load-playlist-file',
  createBackup: 'create-backup',
  restoreBackup: 'restore-backup',
  recoverPrevious: 'recover-previous',
  getDisplays: 'get-displays',
  getActiveDisplays: 'get-active-displays',
  setOutputDisplay: 'set-output-display',
  setStageDisplay: 'set-stage-display',
  toggleStage: 'toggle-stage',
  toggleOutput: 'toggle-output',
  getOutputStatus: 'get-output-status',
  getStageStatus: 'get-stage-status',
  getAIConnection: 'get-ai-connection',
  setAIConnection: 'set-ai-connection',
  copyAIConnectionConfig: 'copy-ai-connection-config',
  completeAICommand: 'complete-ai-command',
  checkAICommand: 'check-ai-command',
  savePreparedPresentation: 'save-prepared-presentation',
  savePreparedPlaylist: 'save-prepared-playlist',
}
contextBridge.exposeInMainWorld('ipcRenderer', {
  role,
  acknowledgeStageMessage: (id: string, revision: number, fits: boolean) => {
    if (role === 'stage') ipcRenderer.send('stage-message-applied', { id, revision, fits })
  },
  pdfOutputReady: () => {
    if (role === 'pdf-helper') ipcRenderer.send('pdf-output-ready')
  },
  pdfOutputResult: (result: unknown) => {
    if (role === 'pdf-helper') ipcRenderer.send('pdf-output-result', result)
  },
  send: (channel: string, data: unknown) => {
    if (sending.includes(channel)) ipcRenderer.send(channel, data)
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (!receiving.includes(channel)) return () => {}
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  ready: () => ipcRenderer.send(role === 'preview' ? 'ai-preview-ready' : 'screen-ready'),
  acknowledge: (version: number) => {
    if (!control) ipcRenderer.send('screen-applied', version)
  },
  reportMediaError: () => ipcRenderer.send(role === 'preview' ? 'ai-preview-error' : 'media-error'),
  ...(role === 'preview'
    ? { previewRendered: (id: string) => ipcRenderer.send('ai-preview-rendered', id) }
    : {}),
  ...(control
    ? {
        ...Object.fromEntries(
          Object.entries(methods).map(([method, channel]) => [
            method,
            (...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
          ]),
        ),
        dropSongFiles: (files: File[], options: unknown) =>
          ipcRenderer.invoke(
            'drop-song-files',
            files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
            options,
          ),
        closeReady: (success: boolean) => ipcRenderer.send('close-ready', success),
      }
    : {}),
})
