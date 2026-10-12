import {
  AI_TOOL_SCHEMAS,
  AI_WRITE_TOOLS,
  playlistRevision,
  PreparationError,
  type AICommand,
  type AICommandResult,
  type AITool,
} from '../../shared/automation'
import { DEFAULT_STYLE, normalizePresentation, patchSlide, slideText } from '../../shared/model'
import { GlobalStyle, parsePresentation } from '../../shared/schema'
import type { Presentation } from '../types'
import { partLabelColor } from '../types'
import { usePresentationStore as store } from '../store'
import { flushPersistence } from './persistence'
import { BibleService } from '../services/BibleService'
import { defaultPreset, presetKind } from './presets'

const summary = (p: Presentation) => ({
  id: p.id,
  title: p.title,
  revision: p.revision || 0,
  slideCount: p.slides.length,
})
function find(id: string): Presentation {
  const p =
    store.getState().setlistSongs.find((p) => p.presentation.id === id)?.presentation ||
    store.getState().library.find((p) => p.id === id)
  if (!p)
    throw new PreparationError(
      'NOT_FOUND',
      '자료를 찾지 못했습니다. 자료 목록을 다시 조회해주세요.',
    )
  return p
}
function assertEditable(id: string) {
  const s = store.getState()
  if (
    s.currentPresentationId === id &&
    (s.isOutputEnabled ||
      s.isStageEnabled ||
      s.activeSlideId ||
      s.activeAudio ||
      s.activeBackground.type !== 'none' ||
      s.activeAnnouncement ||
      s.activeMessage ||
      s.activeProps.length)
  )
    throw new PreparationError(
      'LIVE_PROTECTED',
      '현재 자료가 송출에 사용되고 있습니다. 새 자료를 준비하거나 송출을 중단한 뒤 수정해주세요.',
    )
}
function operatorBusy(): boolean {
  const el = document.activeElement as HTMLElement | null
  return (
    store.getState().isModalOpen ||
    !!document.querySelector('[data-modal="true"]') ||
    (!!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable))
  )
}
export async function withOperatorLock<T>(
  action: () => Promise<T>,
  ownDialog?: HTMLElement,
): Promise<T> {
  const dialogs = document.querySelectorAll('[data-modal="true"]')
  const own =
    !!ownDialog &&
    ownDialog.matches('[data-song-preparation="true"]') &&
    dialogs.length === 1 &&
    dialogs[0] === ownDialog
  if (operatorBusy() && !own)
    throw new PreparationError(
      'OPERATOR_BUSY',
      '운영자가 편집 중입니다. 입력이나 편집창을 닫은 뒤 다시 요청해주세요.',
    )
  const root = document.querySelector<HTMLElement>('[data-control-root]')
  const previous = root?.inert || false
  if (root) root.inert = true
  const block = (e: Event) => {
    // Keep the operator's emergency stop available even during disk writes.
    if (e instanceof KeyboardEvent && e.key === 'F2') return
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  window.addEventListener('keydown', block, true)
  window.addEventListener('pointerdown', block, true)
  store.setState({ preparationBusy: true })
  try {
    return await action()
  } finally {
    if (root) root.inert = previous
    window.removeEventListener('keydown', block, true)
    window.removeEventListener('pointerdown', block, true)
    store.setState({ preparationBusy: false })
  }
}
export async function executePreparation(
  tool: AITool,
  raw: unknown,
  authorize: () => Promise<boolean> = async () => true,
): Promise<AICommandResult> {
  if (!store.getState().initialized)
    throw new PreparationError('CONTROL_UNAVAILABLE', '컨트롤 창의 자료 초기화를 기다려주세요.')
  const write = AI_WRITE_TOOLS.has(tool)
  const run = async (): Promise<AICommandResult> => {
    if (write) {
      await flushPersistence()
      if (!(await authorize()))
        throw new PreparationError(
          'CONNECTION_REVOKED',
          'AI 연결이 해제되었거나 권한이 변경되었습니다.',
        )
    }
    if (tool === 'get_app_state') {
      AI_TOOL_SCHEMAS.get_app_state.parse(raw)
      const s = store.getState()
      return {
        data: {
          ready: true,
          operatorBusy: operatorBusy(),
          selectedPresentationId: s.currentPresentationId,
          selectedDocumentScope: s.setlistSongs.some(
            (p) => p.presentation.id === s.currentPresentationId,
          )
            ? 'setlist'
            : 'library',
          liveSlideId: s.activeSlideId,
          saveState: s.saveState,
          outputEnabled: s.isOutputEnabled,
          stageEnabled: s.isStageEnabled,
          screens: s.screenHealth,
          capabilities: ['read', 'prepare', 'preview'],
          liveControlAvailable: false,
          stylePolicy: {
            defaultSongPresetId: s.defaultSongPresetId,
            defaultBiblePresetId: s.defaultBiblePresetId,
            defaultPresetsOverrideSavedStyleOnSelection: true,
            setlistSnapshotsPreserveSavedStyle: true,
          },
        },
      }
    }
    if (tool === 'search_presentations') {
      const args = AI_TOOL_SCHEMAS.search_presentations.parse(raw)
      const q = args.query.toLocaleLowerCase()
      const matches = store
        .getState()
        .library.filter(
          (p) =>
            p.title.toLocaleLowerCase().includes(q) ||
            p.slides.some((s) => slideText(s).toLocaleLowerCase().includes(q)),
        )
      const items = matches.slice(args.offset, args.offset + args.limit).map(summary)
      return {
        data: {
          items,
          total: matches.length,
          nextOffset:
            args.offset + items.length < matches.length ? args.offset + items.length : null,
        },
      }
    }
    if (tool === 'get_presentation') {
      const args = AI_TOOL_SCHEMAS.get_presentation.parse(raw),
        p = find(args.presentationId)
      return {
        data: {
          ...summary(p),
          globalSlideStyle: p.globalSlideStyle,
          saveState: store.getState().saveState,
          slides: p.slides.slice(args.offset, args.offset + args.limit).map((s) => ({
            id: s.id,
            type: s.type,
            content: slideText(s),
            label: s.label,
            labelColor: s.labelColor,
            borderColor: s.borderColor,
            bibleReference: s.bibleReference,
          })),
          nextOffset: args.offset + args.limit < p.slides.length ? args.offset + args.limit : null,
        },
      }
    }
    if (tool === 'lookup_bible') {
      const args = AI_TOOL_SCHEMAS.lookup_bible.parse(raw)
      let verses
      try {
        verses = await BibleService.searchVerses(args.query)
      } catch {
        throw new PreparationError(
          'BIBLE_NOT_FOUND',
          '앱 성경 자료에서 위치를 찾지 못했습니다. 장·절 범위를 확인해주세요.',
        )
      }
      return { data: { source: 'ProPre에 포함된 개역개정 자료', sourceVerified: false, verses } }
    }
    if (tool === 'create_presentation') {
      const args = AI_TOOL_SCHEMAS.create_presentation.parse(raw),
        now = new Date().toISOString()
      const s = store.getState(),
        preset = s.globalStylePresets.find(
          (p) =>
            p.id ===
            (args.slides[0].type === 'bible' ? s.defaultBiblePresetId : s.defaultSongPresetId),
        )
      const p = parsePresentation({
        id: crypto.randomUUID(),
        title: args.title,
        slides: args.slides.map((slide) => ({ ...slide, id: crypto.randomUUID() })),
        globalSlideStyle: args.style || preset?.style || DEFAULT_STYLE,
        createdAt: now,
        updatedAt: now,
        schemaVersion: 1,
        revision: Date.now(),
      })
      const saved = await s.savePreparedPresentation(p, null)
      s.addToast('AI가 새 자료를 준비하고 저장했습니다.', 'success')
      return {
        data: { requestId: args.requestId, ...summary(saved), saved: true, selected: false },
      }
    }
    if (tool === 'update_presentation') {
      const args = AI_TOOL_SCHEMAS.update_presentation.parse(raw),
        p = find(args.presentationId)
      assertEditable(p.id)
      if ((p.revision || 0) !== args.expectedRevision)
        throw new PreparationError(
          'REVISION_CONFLICT',
          '자료가 변경되었습니다. 다시 조회한 뒤 수정해주세요.',
        )
      if (!args.title && !args.patches?.length && !args.appendSlides?.length && !args.style)
        throw new PreparationError('INVALID_ARGUMENT', '수정할 내용을 지정해주세요.')
      const patches = args.patches || []
      if (
        new Set(patches.map((x) => x.slideId)).size !== patches.length ||
        patches.some((x) => !p.slides.some((s) => s.id === x.slideId))
      )
        throw new PreparationError('INVALID_ARGUMENT', '슬라이드 ID가 없거나 중복되었습니다.')
      const edited = normalizePresentation({
        ...p,
        title: args.title ?? p.title,
        slides: [
          ...p.slides.map((s) => {
            const patch = patches.find((x) => x.slideId === s.id)
            if (patch?.content !== undefined && !['text', 'bible'].includes(s.type))
              throw new PreparationError(
                'UNSUPPORTED_SLIDE',
                '본문 수정은 텍스트·성경 슬라이드에만 지원됩니다.',
              )
            return patch
              ? patchSlide(s, {
                  ...(patch.content !== undefined ? { content: patch.content } : {}),
                  ...(patch.label !== undefined
                    ? {
                        label: patch.label,
                        ...(partLabelColor(patch.label)
                          ? {
                              labelColor: partLabelColor(patch.label),
                              borderColor: partLabelColor(patch.label),
                            }
                          : {}),
                      }
                    : {}),
                })
              : s
          }),
          ...(args.appendSlides || []).map((s) => ({ ...s, id: crypto.randomUUID() })),
        ],
        globalSlideStyle: GlobalStyle.parse({ ...p.globalSlideStyle, ...args.style }),
        updatedAt: new Date().toISOString(),
        revision: Math.max(Date.now(), (p.revision || 0) + 1),
      })
      // Full validation occurs before changing any visible state or creating an Undo checkpoint.
      const checked = parsePresentation(edited)
      let saved: Presentation
      if (store.getState().currentPresentationId === p.id) {
        store.setState({
          slides: checked.slides,
          currentPresentationTitle: checked.title,
          globalSlideStyle: checked.globalSlideStyle!,
          activePresetId: args.style ? null : store.getState().activePresetId,
        })
        try {
          await flushPersistence()
        } catch {
          throw new PreparationError(
            'SAVE_FAILED',
            '편집 내용은 앱에 반영되었지만 저장하지 못했습니다. 앱에서 저장을 재시도해주세요.',
            true,
          )
        }
        saved = find(p.id)
      } else saved = await store.getState().savePreparedPresentation(checked, args.expectedRevision)
      store.getState().addToast('AI가 자료를 수정하고 저장했습니다.', 'success')
      return {
        data: {
          requestId: args.requestId,
          ...summary(saved),
          saved: true,
          undoAvailable: store.getState().currentPresentationId === p.id,
        },
      }
    }
    if (tool === 'get_playlist') {
      AI_TOOL_SCHEMAS.get_playlist.parse(raw)
      const items = store.getState().playlist
      return {
        data: {
          revision: await playlistRevision(items),
          items: items.map((item) => ({
            id: item.id,
            presentationId: item.presentationId,
            sourcePresentationId: store
              .getState()
              .setlistSongs.find((p) => p.presentation.id === item.presentationId)
              ?.sourcePresentationId,
            title: item.presentation.title,
          })),
        },
      }
    }
    if (tool === 'set_playlist') {
      const args = AI_TOOL_SCHEMAS.set_playlist.parse(raw)
      await store.getState().replacePreparedPlaylist(args.presentationIds, args.expectedRevision)
      store.getState().addToast('AI가 진행 순서를 저장했습니다.', 'success')
      return {
        data: {
          requestId: args.requestId,
          saved: true,
          revision: await playlistRevision(store.getState().playlist),
          itemCount: args.presentationIds.length,
        },
      }
    }
    const args = AI_TOOL_SCHEMAS.get_preview.parse(raw),
      p = find(args.presentationId),
      slide = p.slides.find((s) => s.id === args.slideId)
    if (!slide) throw new PreparationError('NOT_FOUND', '슬라이드를 찾지 못했습니다.')
    const s = store.getState()
    const active = s.slides.find((item) => item.id === s.activeSlideId)
    const applyDefault =
      s.currentPresentationId !== p.id || !active || presetKind(active) !== presetKind(slide)
    const preset = applyDefault ? defaultPreset(s, slide) : undefined
    const style =
      preset?.style ||
      (s.currentPresentationId === p.id ? s.globalSlideStyle : p.globalSlideStyle) ||
      DEFAULT_STYLE
    return {
      data: {
        presentationId: p.id,
        slideId: slide.id,
        revision: p.revision || 0,
        kind: 'prepared-slide',
        transmitted: false,
        effectiveGlobalSlideStyle: style,
        styleSource: preset
          ? 'default-preset'
          : s.currentPresentationId === p.id
            ? 'current-style'
            : 'saved-style',
      },
      preview: { slide, style },
    }
  }
  return write ? withOperatorLock(run) : run()
}
export function installPreparationCommands(): () => void {
  let tail: Promise<unknown> = Promise.resolve()
  return window.ipcRenderer.on('ai-command', (command: AICommand) => {
    tail = tail
      .catch(() => {})
      .then(async () => {
        let result: AICommandResult
        try {
          result = await executePreparation(command.tool, command.arguments, () =>
            window.ipcRenderer.checkAICommand(command.id),
          )
        } catch (e) {
          result = {
            error:
              e instanceof PreparationError
                ? { code: e.code, message: e.message, applied: e.applied }
                : {
                    code: 'OPERATION_FAILED',
                    message:
                      '자료 준비를 완료하지 못했습니다. 앱의 저장 상태와 요청 내용을 확인해주세요.',
                  },
          }
        }
        if (new TextEncoder().encode(JSON.stringify(result)).length > 1024 * 1024)
          result = {
            error: {
              code: 'RESULT_TOO_LARGE',
              message: '결과가 너무 큽니다. 조회 limit을 줄이거나 앱에서 자료를 확인해주세요.',
            },
          }
        await window.ipcRenderer.completeAICommand(command.id, result).catch(() => {})
      })
  })
}
