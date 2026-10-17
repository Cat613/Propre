import { StoreSlice, LibrarySlice } from '../types'
import { usePresentationStore } from '../../store'
import { generateId } from '../../utils/generateId'
import { normalizePresentation, DEFAULT_STYLE } from '../../../shared/model'
import { flushPersistence } from '../persistence'
import { defaultPreset } from '../presets'
import { playlistRefs, playlistRevision, PreparationError } from '../../../shared/automation'
function isolateHistory(action: () => void) {
  const history = usePresentationStore.temporal.getState()
  history.pause()
  try {
    action()
    history.clear()
  } finally {
    history.resume()
  }
}
let playlistTail: Promise<void> = Promise.resolve()
export const createLibrarySlice: StoreSlice<LibrarySlice> = (set, get) => ({
  songJobOperation: async (operation, id, revision) => {
    playlistTail = playlistTail
      .catch(() => {})
      .then(async () => {
        window.dispatchEvent(new Event('propre-flush-edits'))
        await flushPersistence()
        if (operation === 'apply') await window.ipcRenderer.applySongJob(id, revision!)
        else if (operation === 'undo') await window.ipcRenderer.undoSongJob(id)
        else await window.ipcRenderer.rebaseSongJob(id)
        await get().refreshWorkspace()
      })
    await playlistTail
  },
  cuePresentations: [],
  cueResources: [],
  serviceSession: null,
  serviceTemplates: [],
  serviceTimer: null,
  stageMessage: { revision: 0, message: null, delivery: 'none', stage: null },
  serviceBlackout: false,
  serviceManualOutput: false,
  library: [],
  playlist: [],
  setlists: [],
  setlistSongs: [],
  activeSetlistId: null,
  refreshWorkspace: async () => {
    const loaded = await window.ipcRenderer.bootstrap()
    set({
      cuePresentations: loaded.cuePresentations,
      cueResources: loaded.cueResources,
      serviceSession: loaded.serviceSession,
      serviceTemplates: loaded.serviceTemplates,
      serviceTimer: loaded.serviceTimer,
      stageMessage: loaded.stageMessage,
      library: loaded.library,
      playlist: loaded.playlist,
      setlists: loaded.setlists,
      setlistSongs: loaded.setlistSongs,
      activeSetlistId: loaded.activeSetlistId,
      outputResources: loaded.outputResources,
      externalOutput: loaded.externalOutput,
      mediaBin: loaded.media,
    })
  },
  manageSetlist: async (command) => {
    playlistTail = playlistTail
      .catch(() => {})
      .then(async () => {
        window.dispatchEvent(new Event('propre-flush-edits'))
        await flushPersistence()
        const workspace = await window.ipcRenderer.manageSetlist(command)
        if (command.operation === 'create' && workspace.activeSetlistId)
          try {
            localStorage.setItem(`propre-setlist-view-v1:${workspace.activeSetlistId}`, 'all')
          } catch {
            /* Optional view preference. */
          }
        set(workspace)
      })
    await playlistTail
  },
  publishSetlistSong: async (id) => {
    let result: import('../../../shared/contracts').FileResult = { success: false }
    playlistTail = playlistTail
      .catch(() => {})
      .then(async () => {
        window.dispatchEvent(new Event('propre-flush-edits'))
        await flushPersistence()
        result = await window.ipcRenderer.publishSetlistSong(id)
        if (result.success) await get().refreshWorkspace()
      })
    await playlistTail
    return result
  },
  serviceFile: async (operation) => {
    let result: import('../../../shared/contracts').FileResult = { success: false }
    playlistTail = playlistTail
      .catch(() => {})
      .then(async () => {
        window.dispatchEvent(new Event('propre-flush-edits'))
        await flushPersistence()
        await get().refreshWorkspace()
        const list = get().setlists.find((entry) => entry.id === get().activeSetlistId)
        if (operation === 'save' && !list) throw new Error('저장할 예배를 먼저 열어주세요.')
        result =
          operation === 'save'
            ? await window.ipcRenderer.saveServiceFile({ id: list!.id, revision: list!.revision })
            : await window.ipcRenderer.loadServiceFile({
                activeId: get().activeSetlistId,
                revision: list?.revision ?? null,
              })
        if (result.success && operation === 'load') {
          const loaded = await window.ipcRenderer.bootstrap()
          try {
            localStorage.setItem(`propre-setlist-view-v1:${loaded.activeSetlistId}`, 'all')
          } catch {
            /* View preference is optional. */
          }
          await get().refreshWorkspace()
        }
      })
    await playlistTail
    return result
  },
  manageServiceTemplate: async (command) => {
    playlistTail = playlistTail
      .catch(() => {})
      .then(async () => {
        window.dispatchEvent(new Event('propre-flush-edits'))
        await flushPersistence()
        const workspace = await window.ipcRenderer.manageServiceTemplate(command)
        if (command.action === 'instantiate' && workspace.activeSetlistId) {
          try {
            localStorage.setItem(`propre-setlist-view-v1:${workspace.activeSetlistId}`, 'all')
          } catch {
            /* Optional preference. */
          }
        }
        set(workspace)
        await get().refreshWorkspace()
      })
    await playlistTail
  },
  templateFile: async (operation, expected) => {
    let result: import('../../../shared/contracts').FileResult = { success: false }
    playlistTail = playlistTail
      .catch(() => {})
      .then(async () => {
        window.dispatchEvent(new Event('propre-flush-edits'))
        await flushPersistence()
        result =
          operation === 'save'
            ? await window.ipcRenderer.saveTemplateFile(expected!)
            : await window.ipcRenderer.loadTemplateFile()
        if (result.success && operation === 'load') await get().refreshWorkspace()
      })
    await playlistTail
    return result
  },
  playlistFile: async (operation, append = false) => {
    let result: import('../../../shared/contracts').FileResult = { success: false }
    playlistTail = playlistTail
      .catch(() => {})
      .then(async () => {
        window.dispatchEvent(new Event('propre-flush-edits'))
        await flushPersistence()
        const expected = playlistRefs(get().playlist)
        result = await (operation === 'save'
          ? window.ipcRenderer.savePlaylistFile(expected)
          : window.ipcRenderer.loadPlaylistFile(expected, append))
        if (result.success && operation === 'load') {
          await get().refreshWorkspace()
        }
      })
    await playlistTail
    return result
  },
  savePreparedPresentation: async (presentation, expectedRevision) => {
    const result = await window.ipcRenderer.savePreparedPresentation(presentation, expectedRevision)
    if (result.error) throw new PreparationError(result.error.code, result.error.message)
    if (!result.presentation)
      throw new PreparationError('SAVE_FAILED', '자료 저장 결과를 확인하지 못했습니다.')
    const saved = result.presentation
    await get().refreshWorkspace()
    return saved
  },
  replacePreparedPlaylist: async (ids, expectedRevision) => {
    playlistTail = playlistTail
      .catch(() => {})
      .then(async () => {
        await flushPersistence()
        const before = get().playlist
        if ((await playlistRevision(before)) !== expectedRevision || get().playlist !== before)
          throw new PreparationError(
            'REVISION_CONFLICT',
            '진행 순서가 변경되었습니다. 다시 조회해주세요.',
          )
        const playlist = ids.map((id) => {
          const presentation =
            get().library.find((p) => p.id === id) ||
            get().setlistSongs.find((p) => p.presentation.id === id)?.presentation
          if (!presentation)
            throw new PreparationError('NOT_FOUND', '진행 순서의 자료를 찾지 못했습니다.')
          return { id: generateId(), presentationId: id, presentation }
        })
        const result = await window.ipcRenderer.savePreparedPlaylist(
          playlistRefs(playlist),
          playlistRefs(before),
        )
        if (result.error) throw new PreparationError(result.error.code, result.error.message)
        await get().refreshWorkspace()
      })
    await playlistTail
  },
  loadLibrary: async () => get().refreshWorkspace(),
  importPresentations: async (presentations) => {
    try {
      await flushPersistence()
      const library = await window.ipcRenderer.mergeToLibrary(presentations)
      set({ library })
    } catch (error) {
      get().addToast('불러오기에 실패했습니다. 기존 자료는 유지됩니다.', 'error')
      throw error
    }
  },
  saveCurrentPresentation: async () => {
    window.dispatchEvent(new Event('propre-flush-edits'))
    await flushPersistence()
    get().addToast('자동 저장을 완료했습니다.', 'success')
  },
  createNewPresentation: () => {
    const preset = defaultPreset(get())
    isolateHistory(() =>
      set({
        currentPresentationId: generateId(),
        currentPresentationTitle: null,
        slides: [],
        activeSlideId: null,
        selectedSlideIds: [],
        globalSlideStyle: { ...(preset?.style || DEFAULT_STYLE) },
        activePresetId: preset?.id || null,
      }),
    )
  },
  deletePresentation: async (id) => {
    try {
      await flushPersistence()
      const library = await window.ipcRenderer.deleteFromLibrary(id)
      set({ library })
      if (get().currentPresentationId === id) get().createNewPresentation()
    } catch (error) {
      get().addToast('자료 삭제에 실패했습니다.', 'error')
      throw error
    }
  },
  addToPlaylist: async (id) => {
    playlistTail = playlistTail
      .catch(() => {})
      .then(async () => {
        await flushPersistence()
        const presentation = get().library.find((p) => p.id === id)
        if (!presentation) return
        const playlist = [...get().playlist, { id: generateId(), presentationId: id, presentation }]
        await window.ipcRenderer.savePlaylist(playlist)
        await get().refreshWorkspace()
      })
    await playlistTail.catch((error) => {
      get().addToast('순서 저장에 실패했습니다.', 'error')
      throw error
    })
  },
  removeFromPlaylist: async (id) => {
    playlistTail = playlistTail
      .catch(() => {})
      .then(async () => {
        const playlist = get().playlist.filter((x) => x.id !== id)
        await window.ipcRenderer.savePlaylist(playlist)
        await get().refreshWorkspace()
      })
    await playlistTail.catch((error) => {
      get().addToast('순서 저장에 실패했습니다.', 'error')
      throw error
    })
  },
  reorderPlaylist: async (oldIndex, newIndex) => {
    playlistTail = playlistTail
      .catch(() => {})
      .then(async () => {
        const playlist = [...get().playlist]
        if (!playlist[oldIndex] || newIndex < 0 || newIndex >= playlist.length) return
        const [item] = playlist.splice(oldIndex, 1)
        playlist.splice(newIndex, 0, item)
        await window.ipcRenderer.savePlaylist(playlist)
        await get().refreshWorkspace()
      })
    await playlistTail.catch((error) => {
      get().addToast('순서 저장에 실패했습니다.', 'error')
      throw error
    })
  },
  selectPresentation: (id) => {
    const snapshot = get().setlistSongs.find((p) => p.presentation.id === id)
    const saved = snapshot?.presentation || get().library.find((p) => p.id === id)
    if (!saved || get().currentPresentationId === id) return
    const p = normalizePresentation(saved)
    const preset = defaultPreset(get(), p.slides[0])
    isolateHistory(() =>
      set({
        currentPresentationId: p.id,
        currentPresentationTitle: p.title,
        slides: p.slides,
        globalSlideStyle: { ...(preset?.style || p.globalSlideStyle!) },
        activeSlideId: null,
        selectedSlideIds: [],
        activePresetId: preset?.id || null,
      }),
    )
  },
  openPresentation: (raw) => {
    const p = normalizePresentation({ ...raw, id: generateId(), revision: 0 })
    const preset = defaultPreset(get(), p.slides[0])
    isolateHistory(() =>
      set({
        currentPresentationId: p.id,
        currentPresentationTitle: p.title,
        slides: p.slides,
        globalSlideStyle: { ...(preset?.style || p.globalSlideStyle!) },
        activeSlideId: null,
        selectedSlideIds: [],
        activePresetId: preset?.id || null,
      }),
    )
  },
})
