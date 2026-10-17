import type { Presentation } from '../types'
import type { StoreState } from './types'
import type { SaveState, Settings } from '../../shared/contracts'
export interface Checkpoint {
  presentation: Presentation
  fingerprint: string
}
export class DraftWriter {
  private pending = new Map<string, Checkpoint>()
  private tail: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined
  private error: unknown
  constructor(
    private save: (p: Presentation) => Promise<void>,
    private status: (state: SaveState, error?: string) => void,
    private delay = 400,
  ) {}
  schedule(checkpoint: Checkpoint): void {
    this.pending.set(checkpoint.presentation.id, structuredClone(checkpoint))
    this.status('pending')
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {})
    }, this.delay)
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    this.tail = this.tail
      .catch(() => {})
      .then(async () => {
        while (this.pending.size) {
          const [id, checkpoint] = this.pending.entries().next().value!
          this.pending.delete(id)
          this.status('saving')
          try {
            await this.save(checkpoint.presentation)
            this.error = undefined
          } catch (error) {
            const newer = this.pending.get(id)
            if (
              !newer ||
              (newer.presentation.revision || 0) < (checkpoint.presentation.revision || 0)
            )
              this.pending.set(id, checkpoint)
            this.error = error
            this.status('error', '자동 저장에 실패했습니다. 재시도하거나 백업을 내보내주세요.')
            throw error
          }
        }
        if (!this.error) this.status('saved')
      })
    await this.tail
  }
  dispose() {
    clearTimeout(this.timer)
  }
}
let writer: DraftWriter | undefined
let settingsSave: () => Promise<void> = async () => {}
export function registerWriter(value: DraftWriter, saveSettings: () => Promise<void>) {
  writer = value
  settingsSave = saveSettings
}
export async function flushPersistence() {
  await writer?.flush()
  await settingsSave()
}
export async function saveCheckpoint(p: Presentation) {
  const library = await window.ipcRenderer.saveDraft(p)
  return library
}
export function presentationFingerprint(p: {
  slides: Presentation['slides']
  globalSlideStyle?: Presentation['globalSlideStyle']
  title?: string | null
}) {
  return JSON.stringify({ slides: p.slides, style: p.globalSlideStyle, title: p.title || null })
}
export function persistentSettings(state: StoreState): Settings {
  return {
    interfaceTheme: state.interfaceTheme,
    showAudioPlayer: state.showAudioPlayer,
    isGreenScreen: state.isGreenScreen,
    screenLooks: { main: state.screenLooks.main, chroma: state.screenLooks.chroma },
    globalStylePresets: state.globalStylePresets,
    defaultSongPresetId: state.defaultSongPresetId,
    defaultBiblePresetId: state.defaultBiblePresetId,
    stageCurrentFontSize: state.stageCurrentFontSize,
    stageNextFontSize: state.stageNextFontSize,
  }
}
