import { contextBridge, ipcRenderer, webUtils } from 'electron'
const role = process.argv.find((a) => a.startsWith('--propre-role='))?.split('=')[1] || 'main'
const control = role === 'control'
const receiving = control
  ? [
      'output-status-changed',
      'stage-status-changed',
      'screen-health',
      'displays-changed',
      'operation-warning',
      'request-flush',
      'ai-command',
      'ai-connection-changed',
      'song-job-changed',
    ]
  : role === 'stage'
    ? ['update-stage']
    : role === 'preview'
      ? ['ai-preview']
      : ['update-screen']
const sending = control ? ['route-screen-update', 'update-stage'] : []
const methods: Record<string, string> = {
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
  publishSetlistSong: 'publish-setlist-song',
  saveToLibrary: 'save-to-library',
  saveDraft: 'save-draft',
  mergeToLibrary: 'merge-to-library',
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
