import { contextBridge, ipcRenderer } from 'electron'
import type { Presentation, PlaylistItem } from '../src/types'

interface SaveResult {
    success: boolean
    canceled?: boolean
    filePath?: string
    error?: string
}

interface LoadResult {
    success: boolean
    canceled?: boolean
    data?: string
    filePath?: string
    error?: string
}

contextBridge.exposeInMainWorld('ipcRenderer', {
    send: (channel: string, data: any) => {
        const validChannels = ['update-output', 'update-stage', 'route-screen-update', 'update-screen']
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data)
        }
    },
    on: (channel: string, func: (...args: any[]) => void) => {
        const validChannels = ['update-output', 'update-stage', 'route-screen-update', 'update-screen']
        if (validChannels.includes(channel)) {
            // Remove _event arg as requested previously to fix undefined data issue
            const subscription = (_event: any, ...args: any[]) => func(...args)
            ipcRenderer.on(channel, subscription)
            return () => {
                ipcRenderer.removeListener(channel, subscription)
            }
        }
        return () => { }
    },
    off: (channel: string, func: (...args: any[]) => void) => {
        ipcRenderer.removeListener(channel, func)
    },

    selectMediaFiles: async (): Promise<string[]> => {
        return ipcRenderer.invoke('dialog:openFile')
    },

    saveProject: async (data: string): Promise<SaveResult> => {
        return ipcRenderer.invoke('save-project', data)
    },

    loadProject: async (): Promise<LoadResult> => {
        return ipcRenderer.invoke('load-project')
    },

    // Library & Playlist API
    getLibrary: async (): Promise<Presentation[]> => ipcRenderer.invoke('get-library'),
    saveToLibrary: async (presentation: Presentation): Promise<boolean> => ipcRenderer.invoke('save-to-library', presentation),
    deleteFromLibrary: async (id: string): Promise<Presentation[]> => ipcRenderer.invoke('delete-from-library', id),
    getPlaylist: async (): Promise<PlaylistItem[]> => ipcRenderer.invoke('get-playlist'),
    savePlaylist: async (playlist: PlaylistItem[]): Promise<boolean> => ipcRenderer.invoke('save-playlist', playlist),

    // Stage & Display API
    getDisplays: async () => ipcRenderer.invoke('get-displays'),
    getActiveDisplays: async () => ipcRenderer.invoke('get-active-displays'),
    setOutputDisplay: async (displayId: number) => ipcRenderer.invoke('set-output-display', displayId),
    setStageDisplay: async (displayId: number) => ipcRenderer.invoke('set-stage-display', displayId),
    invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
    // Explicit is safer usually but user pattern used invoke directly in store.ts: window.ipcRenderer.invoke('toggle-stage')
    // Wait, let's check store.ts usage.
    // store.ts used: result = await window.ipcRenderer.invoke('toggle-stage')
    // But currently exposeInMainWorld does NOT expose a raw 'invoke' method. It exposes specific methods.
    // So store.ts is calling a non-existent method on window.ipcRenderer!
    // We should fix typescript definition likely too.
    // Let's add specific method or expose invoke generically (less safe).
    // Given the previous pattern, let's add specific method AND update type definition if needed.
    toggleStage: async () => ipcRenderer.invoke('toggle-stage'),
    toggleOutput: async () => ipcRenderer.invoke('toggle-output'),
    // Security API
    getApiKey: async (): Promise<string | null> => ipcRenderer.invoke('get-api-key'),
    setApiKey: async (key: string | null): Promise<void> => ipcRenderer.invoke('set-api-key', key)
})
