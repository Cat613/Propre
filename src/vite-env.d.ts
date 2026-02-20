export interface IpcRenderer {
    send: (channel: string, data: any) => void
    on: (channel: string, func: (...args: any[]) => void) => () => void
    off: (channel: string, func: (...args: any[]) => void) => void
    invoke: (channel: string, ...args: any[]) => Promise<any> // Allow raw invoke for now or strict?

    // Specific methods
    selectMediaFiles: () => Promise<string[]>
    saveProject: (data: string) => Promise<{ success: boolean; filePath?: string; error?: string; canceled?: boolean }>
    loadProject: () => Promise<{ success: boolean; data?: string; filePath?: string; error?: string; canceled?: boolean }>

    getLibrary: () => Promise<any[]>
    saveToLibrary: (presentation: any) => Promise<boolean>
    deleteFromLibrary: (id: string) => Promise<any[]>
    getPlaylist: () => Promise<any[]>
    savePlaylist: (playlist: any[]) => Promise<boolean>

    // New
    toggleStage: () => Promise<boolean>

    // Display Management
    getDisplays: () => Promise<{ id: number, label: string, bounds: { x: number, y: number, width: number, height: number } }[]>
    getActiveDisplays: () => Promise<{ output: number | null, stage: number | null }>
    setOutputDisplay: (displayId: number) => Promise<boolean>
    setStageDisplay: (displayId: number) => Promise<boolean>
}

declare global {
    interface Window {
        ipcRenderer: IpcRenderer
    }
}
