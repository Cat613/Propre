import { usePresentationStore as store } from '../store'
import { outputSnapshot, stageSnapshot } from './helpers'
import {
  DraftWriter,
  registerWriter,
  flushPersistence,
  persistentSettings,
  presentationFingerprint,
} from './persistence'
import { SettingsSchema, parseLibrary, boundedJSON } from '../../shared/schema'
import { DEFAULT_STYLE, slideText } from '../../shared/model'
import type { Presentation } from '../types'
import type { SaveState } from '../../shared/contracts'
import { installSongAutomation } from './song-automation'
import { installPreparationCommands } from './preparation'
let initialization: Promise<() => void> | undefined
let sequence = Date.now()
export function currentDocument(): Presentation | null {
  const s = store.getState()
  if (!s.currentPresentationId || (!s.slides.length && !s.currentPresentationTitle)) return null
  const old =
      s.setlistSongs.find((p) => p.presentation.id === s.currentPresentationId)?.presentation ||
      s.library.find((p) => p.id === s.currentPresentationId),
    now = new Date().toISOString()
  sequence = Math.max(sequence + 1, Date.now(), (old?.revision || 0) + 1)
  return {
    songForm: old?.songForm,
    id: s.currentPresentationId,
    title:
      s.currentPresentationTitle ||
      slideText(s.slides[0]).split('\n')[0].slice(0, 40) ||
      '새 프레젠테이션',
    slides: s.slides,
    globalSlideStyle: s.globalSlideStyle,
    schemaVersion: 1,
    revision: sequence,
    createdAt: old?.createdAt || now,
    updatedAt: now,
  }
}
export function initializeControl(): Promise<() => void> {
  initialization ||= boot().catch((error) => {
    initialization = undefined
    throw error
  })
  return initialization.then(() => () => {})
}
async function boot(): Promise<() => void> {
  let loaded = await window.ipcRenderer.bootstrap()
  let recoveryPending: Presentation[] = []
  try {
    const pending = parseLibrary(
      boundedJSON(localStorage.getItem('propre-pending-drafts-v1') || '[]'),
    ).sort((a, b) => (a.revision || 0) - (b.revision || 0))
    recoveryPending = pending
    for (const document of pending)
      if (
        (document.revision || 0) >
        ((
          loaded.setlistSongs.find((p) => p.presentation.id === document.id)?.presentation ||
          loaded.library.find((p) => p.id === document.id)
        )?.revision || 0)
      )
        await window.ipcRenderer.saveDraft(document)
    recoveryPending = []
    localStorage.removeItem('propre-pending-drafts-v1')
    if (pending.length) {
      loaded = await window.ipcRenderer.bootstrap()
      loaded.warnings.push('중단 직전의 편집 내용을 자동 저장 기록에서 복구했습니다.')
    }
  } catch {
    if (recoveryPending.length) {
      const recovered = new Map(
        [...loaded.library, ...loaded.setlistSongs.map((p) => p.presentation)].map((p) => [
          p.id,
          p,
        ]),
      )
      for (const document of recoveryPending)
        if ((document.revision || 0) > (recovered.get(document.id)?.revision || 0))
          recovered.set(document.id, document)
      const snapshotIds = new Set(loaded.setlistSongs.map((p) => p.presentation.id))
      loaded.library = [...recovered.values()].filter((p) => !snapshotIds.has(p.id))
      loaded.setlistSongs = loaded.setlistSongs.map((song) => ({
        ...song,
        presentation: recovered.get(song.presentation.id) || song.presentation,
      }))
      loaded.draft = recoveryPending.at(-1)!
    }
    loaded.warnings.push('복구한 편집 내용을 아직 저장하지 못했습니다. 복구 기록은 유지했습니다.')
  }

  sequence = Math.max(sequence, ...loaded.library.map((p) => p.revision || 0))
  let settings = loaded.settings
  // Read legacy renderer settings once and validate before migrating to durable main storage.
  if (!Object.keys(settings).length)
    try {
      const legacy = {
        globalStylePresets: JSON.parse(localStorage.getItem('propre-style-presets') || '[]'),
        defaultSongPresetId: localStorage.getItem('propre-default-song-preset') || null,
        defaultBiblePresetId: localStorage.getItem('propre-default-bible-preset') || null,
        stageCurrentFontSize: Number(localStorage.getItem('propre-stage-current-fontsize') || 80),
        stageNextFontSize: Number(localStorage.getItem('propre-stage-next-fontsize') || 36),
      }
      const parsed = SettingsSchema.safeParse(legacy)
      if (parsed.success) {
        settings = { ...settings, ...parsed.data }
        await window.ipcRenderer.saveSettings(settings)
      }
    } catch {
      /* Defaults remain valid; the original legacy values are preserved. */
    }
  const draft = loaded.draft
  store.setState({
    library: loaded.library,
    playlist: loaded.playlist,
    setlists: loaded.setlists,
    setlistSongs: loaded.setlistSongs,
    activeSetlistId: loaded.activeSetlistId,
    mediaBin: loaded.media,
    ...settings,
    isOutputEnabled: loaded.outputEnabled,
    isStageEnabled: loaded.stageEnabled,
    currentPresentationId: draft?.id || crypto.randomUUID(),
    currentPresentationTitle: draft?.title || null,
    lastSavedAt: draft?.updatedAt || null,
    slides: draft?.slides || [],
    globalSlideStyle: draft?.globalSlideStyle || { ...DEFAULT_STYLE },
    activeSlideId:
      loaded.live?.layers.slide && draft?.slides.some((s) => s.id === loaded.live?.layers.slide?.id)
        ? loaded.live.layers.slide.id
        : null,
    ...(loaded.live
      ? {
          activeBackground: loaded.live.layers.background,
          activeProps: loaded.live.layers.props,
          activeMessage: loaded.live.layers.message,
          activeAnnouncement: loaded.live.layers.announcement,
        }
      : {}),
    initialized: true,
  })
  store.temporal.getState().clear()
  let settingsJSON = JSON.stringify(persistentSettings(store.getState())),
    mediaJSON = JSON.stringify(store.getState().mediaBin),
    lastOutput = '',
    lastStage = ''
  let settingsTimer: ReturnType<typeof setTimeout> | undefined,
    settingsTail: Promise<void> = Promise.resolve()
  let draftStatus: SaveState = 'saved',
    draftError: string | undefined
  let settingsPending = false,
    settingsSaving = false,
    settingsError: string | undefined
  const updateSaveState = () => {
    const error = draftError || settingsError
    store.setState({
      saveState: error
        ? 'error'
        : draftStatus === 'saving' || settingsSaving
          ? 'saving'
          : draftStatus === 'pending' || settingsPending
            ? 'pending'
            : 'saved',
      saveError: error || null,
    })
  }
  const saveSettings = async () => {
    clearTimeout(settingsTimer)
    settingsTail = settingsTail
      .catch(() => {})
      .then(async () => {
        settingsSaving = true
        updateSaveState()
        try {
          for (;;) {
            const current = store.getState(),
              settings = persistentSettings(current),
              media = current.mediaBin
            const nextSettings = JSON.stringify(settings),
              nextMedia = JSON.stringify(media)
            if (nextSettings === settingsJSON && nextMedia === mediaJSON) break
            if (nextSettings !== settingsJSON) {
              await window.ipcRenderer.saveSettings(settings)
              store.setState({ lastSavedAt: new Date().toISOString() })
              settingsJSON = nextSettings
            }
            if (nextMedia !== mediaJSON) {
              await window.ipcRenderer.saveMedia(media)
              store.setState({ lastSavedAt: new Date().toISOString() })
              mediaJSON = nextMedia
            }
          }
          settingsPending = false
          settingsError = undefined
        } catch (error) {
          settingsError = '설정 또는 미디어 목록 저장에 실패했습니다. 재시도해주세요.'
          throw error
        } finally {
          settingsSaving = false
          updateSaveState()
        }
      })
    await settingsTail
  }
  const readJournal = (): Presentation[] => {
    try {
      return parseLibrary(boundedJSON(localStorage.getItem('propre-pending-drafts-v1') || '[]'))
    } catch {
      return []
    }
  }
  const writer = new DraftWriter(
    async (p) => {
      const library = await window.ipcRenderer.saveDraft(p)
      const workspace = await window.ipcRenderer.bootstrap()
      store.setState({ lastSavedAt: new Date().toISOString() })
      const pending = readJournal().filter(
        (x) => x.id !== p.id || (x.revision || 0) > (p.revision || 0),
      )
      try {
        if (pending.length)
          localStorage.setItem('propre-pending-drafts-v1', JSON.stringify(pending))
        else localStorage.removeItem('propre-pending-drafts-v1')
      } catch {
        /* Main storage already confirmed this checkpoint. */
      }
      store.setState((s) => {
        const pendingIds = new Set(pending.map((p) => p.id))
        const nextLibrary = [
          ...library.map((item) => {
            const local = s.library.find((x) => x.id === item.id)
            return local && (local.revision || 0) > (item.revision || 0) ? local : item
          }),
          ...s.library.filter((p) => pendingIds.has(p.id) && !library.some((x) => x.id === p.id)),
        ]
        return {
          library: nextLibrary,
          setlists: workspace.setlists,
          setlistSongs: workspace.setlistSongs.map((song) => {
            const local = s.setlistSongs.find((x) => x.presentation.id === song.presentation.id)
            return local && (local.presentation.revision || 0) > (song.presentation.revision || 0)
              ? local
              : song
          }),
          playlist: workspace.playlist.map((item) => {
            const local = s.setlistSongs.find(
              (x) => x.presentation.id === item.presentationId,
            )?.presentation
            return local && (local.revision || 0) > (item.presentation.revision || 0)
              ? { ...item, presentation: local }
              : item
          }),
        }
      })
    },
    (saveState, saveError) => {
      draftStatus = saveState
      draftError = saveError
      updateSaveState()
    },
  )
  registerWriter(writer, saveSettings)
  const publish = () => {
    const s = store.getState(),
      output = JSON.stringify(outputSnapshot(s)),
      stage = JSON.stringify(stageSnapshot(s))
    if (output !== lastOutput) {
      lastOutput = output
      window.ipcRenderer.send('route-screen-update', { screenId: 'main', data: JSON.parse(output) })
    }
    if (stage !== lastStage) {
      lastStage = stage
      window.ipcRenderer.send('update-stage', JSON.parse(stage))
    }
  }
  const unsub = store.subscribe((s, prev) => {
    const transition = s.currentPresentationId !== prev.currentPresentationId
    if (transition) void writer.flush().catch(() => {})
    const changed =
      s.slides !== prev.slides ||
      s.globalSlideStyle !== prev.globalSlideStyle ||
      s.currentPresentationTitle !== prev.currentPresentationTitle
    if (changed || transition) {
      const next = currentDocument()
      if (next) {
        // Optimistic document content is visible immediately; the save indicator confirms disk persistence.
        store.setState((state) =>
          state.setlistSongs.some((p) => p.presentation.id === next.id)
            ? {
                setlistSongs: state.setlistSongs.map((p) =>
                  p.presentation.id === next.id ? { ...p, presentation: next } : p,
                ),
                playlist: state.playlist.map((p) =>
                  p.presentationId === next.id ? { ...p, presentation: next } : p,
                ),
              }
            : { library: [...state.library.filter((p) => p.id !== next.id), next] },
        )
        try {
          localStorage.setItem(
            'propre-pending-drafts-v1',
            JSON.stringify([...readJournal().filter((p) => p.id !== next.id), next]),
          )
        } catch {
          store
            .getState()
            .addToast('중단 복구 기록을 기록하지 못했습니다. 저장 공간을 확인해주세요.', 'error')
        }
        writer.schedule({ presentation: next, fingerprint: presentationFingerprint(next) })
        if (transition) void writer.flush().catch(() => {})
      }
    }
    if (s.activeSlideId && !s.slides.some((x) => x.id === s.activeSlideId))
      store.setState({ activeSlideId: null })
    const settingsChanged =
      s.isGreenScreen !== prev.isGreenScreen ||
      s.screenLooks !== prev.screenLooks ||
      s.globalStylePresets !== prev.globalStylePresets ||
      s.defaultSongPresetId !== prev.defaultSongPresetId ||
      s.defaultBiblePresetId !== prev.defaultBiblePresetId ||
      s.stageCurrentFontSize !== prev.stageCurrentFontSize ||
      s.stageNextFontSize !== prev.stageNextFontSize
    if (settingsChanged || s.mediaBin !== prev.mediaBin) {
      settingsPending = true
      updateSaveState()
      clearTimeout(settingsTimer)
      settingsTimer = setTimeout(() => {
        void saveSettings().catch(() => {
          store
            .getState()
            .addToast('설정 또는 미디어 목록을 저장하지 못했습니다. 다시 시도해주세요.', 'error')
        })
      }, 400)
    }
    if (
      changed ||
      s.activeSlideId !== prev.activeSlideId ||
      s.activeAudio !== prev.activeAudio ||
      s.activeBackground !== prev.activeBackground ||
      s.activeAnnouncement !== prev.activeAnnouncement ||
      s.activeProps !== prev.activeProps ||
      s.activeMessage !== prev.activeMessage ||
      s.screenLooks !== prev.screenLooks ||
      s.isGreenScreen !== prev.isGreenScreen ||
      s.stageCurrentFontSize !== prev.stageCurrentFontSize ||
      s.stageNextFontSize !== prev.stageNextFontSize
    )
      publish()
  })
  const listeners = [
    installPreparationCommands(),
    installSongAutomation(),
    window.ipcRenderer.on('output-status-changed', (status) =>
      store.setState({ isOutputEnabled: status }),
    ),
    window.ipcRenderer.on('stage-status-changed', (status) =>
      store.setState({ isStageEnabled: status }),
    ),
    window.ipcRenderer.on('screen-health', (health) =>
      store.setState((s) => ({
        screenHealth: [...s.screenHealth.filter((h) => h.screen !== health.screen), health],
      })),
    ),
    window.ipcRenderer.on('operation-warning', (message) =>
      store.getState().addToast(message, 'error'),
    ),
    window.ipcRenderer.on('request-flush', () => {
      window.dispatchEvent(new Event('propre-flush-edits'))
      store.getState().clearLayer('audio')
      void flushPersistence().then(
        () => window.ipcRenderer.closeReady(true),
        () => window.ipcRenderer.closeReady(false),
      )
    }),
  ]
  for (const document of recoveryPending)
    writer.schedule({ presentation: document, fingerprint: presentationFingerprint(document) })
  for (const warning of loaded.warnings) store.getState().addToast(warning, 'error')
  publish()
  window.ipcRenderer.ready()
  return () => {
    unsub()
    listeners.forEach((f) => f())
    writer.dispose()
    clearTimeout(settingsTimer)
  }
}

export async function disposeControl() {
  const cleanup = await initialization
  cleanup?.()
  initialization = undefined
}
if (import.meta.hot) import.meta.hot.dispose(() => void disposeControl())
