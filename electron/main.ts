import { app, ipcMain, dialog, protocol, session, net, clipboard } from 'electron'
import fs from 'node:fs/promises'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { Repository, atomicWrite } from './services/repository'
import { KeyVault } from './services/security'
import { AIProfiles } from './services/ai-profiles'
import { SongJobs } from './services/song-jobs'
import { StartJobSchema } from '../shared/song-preparation'
import { WindowManager } from './services/windows'
import {
  Id,
  MAX_FILE_BYTES,
  MAX_STATE_BYTES,
  PlaylistRefsSchema,
  parseProject,
} from '../shared/schema'
import type { FileResult } from '../shared/contracts'
import { contentSecurityPolicy } from '../shared/content-security-policy'
import { AutomationService } from './services/automation'
import { PreparationPreview } from './services/preparation-preview'
import {
  PreparationError,
  AI_REQUEST_BYTES,
  type AICommand,
  type AICommandResult,
} from '../shared/automation'
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const devURL = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL
app.setName('pro-presenter-lite')
// Keep the original application directory; changing branding must not hide existing user data.
app.setPath(
  'userData',
  !app.isPackaged && process.env.PROPRE_TEST === '1' && process.env.PROPRE_TEST_USER_DATA
    ? path.resolve(process.env.PROPRE_TEST_USER_DATA)
    : path.join(app.getPath('appData'), 'pro-presenter-lite'),
)
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])
const lock = app.requestSingleInstanceLock()
if (!lock) app.quit()
let windows: WindowManager
let automation: AutomationService | undefined
let preparationPreview: PreparationPreview | undefined
let allowClose = false,
  closing = false,
  quitting = false
let closeResolver: ((success: boolean) => void) | undefined
if (lock)
  void app
    .whenReady()
    .then(async () => {
      const repo = new Repository(app.getPath('userData'))
      await repo.open()
      const vault = new KeyVault(repo.directory)
      await vault.open()
      windows = new WindowManager(repo, root, devURL)
      const pendingCommands = new Map<
        string,
        { resolve: (result: AICommandResult) => void; timer: ReturnType<typeof setTimeout> }
      >()
      const dispatchPreparation = (command: AICommand): Promise<AICommandResult> => {
        if (closing || quitting || !windows.isControlReady() || !windows.windows.has('control'))
          return Promise.reject(
            new PreparationError(
              'CONTROL_UNAVAILABLE',
              '컨트롤 창을 열고 자료 초기화를 기다려주세요.',
            ),
          )
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            pendingCommands.delete(command.id)
            resolve({
              error: {
                code: 'RESULT_UNCERTAIN',
                message: '컨트롤 창의 결과를 확인하지 못했습니다. 앱 상태를 조회해주세요.',
              },
            })
          }, 20000)
          pendingCommands.set(command.id, { resolve, timer })
          windows.notify('ai-command', command)
        })
      }
      preparationPreview = new PreparationPreview(root, devURL)
      automation = new AutomationService(
        repo.directory,
        dispatchPreparation,
        (snapshot) => preparationPreview!.render(snapshot),
        (state) => windows.notify('ai-connection-changed', state),
      )
      await automation.initialize()
      const profiles = new AIProfiles(repo.directory, vault)
      await profiles
        .open()
        .catch(() =>
          repo.warnings.push(
            'AI 연결 설정을 읽지 못했습니다. 기존 AI 연결 설정 파일을 보존했으며 파일 분석 연결을 다시 확인해주세요.',
          ),
        )
      const songJobs = new SongJobs(
        repo,
        profiles,
        (job) => windows.notify('song-job-changed', job),
        (snapshot) => preparationPreview!.render(snapshot),
      )
      await songJobs.open()
      ipcMain.on('ai-preview-ready', (event) => preparationPreview?.onReady(event))
      ipcMain.on('ai-preview-rendered', (event, id) => preparationPreview?.onRendered(event, id))
      ipcMain.on('ai-preview-error', (event) => preparationPreview?.onMediaError(event))
      protocol.handle('app', async (request) => {
        try {
          const url = new URL(request.url),
            pathname = decodeURIComponent(url.pathname)
          if (url.hostname !== 'propre' || pathname.includes('\0'))
            return new Response('', { status: 403 })
          const file = path.resolve(root, 'dist', '.' + pathname)
          const base = path.resolve(root, 'dist')
          if (!file.startsWith(base + path.sep)) return new Response('', { status: 403 })
          return await net.fetch(pathToFileURL(file).toString())
        } catch {
          return new Response('', { status: 404 })
        }
      })
      protocol.handle('media', async (request) => {
        try {
          return await net.fetch(pathToFileURL(await repo.assetPath(request.url)).toString(), {
            headers: request.headers,
          })
        } catch {
          return new Response('', { status: 404 })
        }
      })
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      )
      session.defaultSession.setPermissionCheckHandler(() => false)
      const csp = contentSecurityPolicy(devURL, process.env.PROPRE_DEV_CSP_NONCE)
      session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
        callback({
          responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
        }),
      )
      function handle(channel: string, handler: (...args: any[]) => unknown) {
        ipcMain.handle(channel, async (event, ...args: unknown[]) => {
          windows.authorize(event, ['control'])
          try {
            if (Buffer.byteLength(JSON.stringify(args)) > MAX_STATE_BYTES)
              throw new Error('요청 크기가 너무 큽니다.')
            return await handler(...args)
          } catch (e) {
            throw new Error(
              e instanceof z.ZodError
                ? '자료 형식이 올바르지 않습니다.'
                : e instanceof Error && 'code' in e
                  ? '파일 작업을 완료하지 못했습니다. 파일·저장 공간을 확인해주세요.'
                  : e instanceof Error
                    ? e.message
                    : '작업을 완료하지 못했습니다.',
            )
          }
        })
      }
      handle('bootstrap', () => ({
        live: windows.live(),
        ...repo.workspace(),
        draft: repo.state.draft,
        settings: repo.state.settings,
        media: repo.state.media,
        warnings: repo.warnings,
        outputEnabled: windows.status('main'),
        stageEnabled: windows.status('stage'),
      }))
      handle('list-ai-profiles', () => profiles.list())
      handle('save-ai-profile', (profile, key, defaultConnection) =>
        profiles.save(profile, key, defaultConnection),
      )
      handle('remove-ai-profile', (id) => profiles.remove(Id.parse(id)))
      handle('list-song-jobs', () => songJobs.list())
      handle('select-song-files', async (raw) => {
        const options = StartJobSchema.parse(raw)
        const selected = await dialog.showOpenDialog(windows.windows.get('control')!, {
          properties: ['openFile', 'multiSelections'],
          filters: [
            { name: '찬양 PDF · 이미지', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp'] },
          ],
        })
        return selected.canceled ? null : songJobs.files(selected.filePaths, options)
      })
      handle('drop-song-files', (paths, raw) =>
        songJobs.files(z.array(z.string().max(4096)).min(1).max(20).parse(paths), raw),
      )
      handle('song-source', (id, sourceId) => songJobs.source(Id.parse(id), Id.parse(sourceId)))
      handle('switch-song-ai', (id, profileId) =>
        songJobs.switchProfile(Id.parse(id), Id.parse(profileId)),
      )
      handle('analyze-song-job', (id, sources) => songJobs.analyze(Id.parse(id), sources))
      handle('cancel-song-job', (id) => songJobs.cancel(Id.parse(id)))
      handle('edit-song-job', (id, args) => songJobs.edit(Id.parse(id), args))
      handle('rebase-song-job', (id) => songJobs.rebase(Id.parse(id)))
      handle('apply-song-job', (id, revision) =>
        songJobs.apply(Id.parse(id), z.number().int().nonnegative().parse(revision)),
      )
      handle('undo-song-job', (id) => songJobs.undo(Id.parse(id)))
      handle('song-receipt', (id) => songJobs.receipt(Id.parse(id)))
      handle('retain-song-sources', (id, keep) =>
        songJobs.retain(Id.parse(id), z.boolean().parse(keep)),
      )
      handle('remove-song-job', (id) => songJobs.remove(Id.parse(id)))
      handle('song-preview', (id, songId, index) =>
        songJobs.previewDraft(
          Id.parse(id),
          Id.parse(songId),
          z.number().int().nonnegative().parse(index),
        ),
      )
      handle('get-library', () => repo.library())
      handle('get-playlist', () => repo.playlist())
      handle('manage-setlist', (command) => repo.manageSetlist(command))
      handle('publish-setlist-song', async (rawId) => {
        try {
          const id = Id.parse(rawId)
          const song = repo.state.setlistSongs.find((x) => x.presentation.id === id)
          if (!song) throw new Error('콘티의 곡을 찾지 못했습니다.')
          const original = repo.state.library.find((x) => x.id === song.sourcePresentationId)
          const revision = song.presentation.revision || 0,
            sourceRevision = original?.revision ?? null
          const answer = await dialog.showMessageBox(windows.windows.get('control')!, {
            type: 'question',
            message: original
              ? `찬양 목록의 “${original.title}”에 반영할까요?`
              : '찬양 목록에 새 곡으로 저장할까요?',
            detail: `${original && original.revision !== song.sourceRevision ? '이 콘티를 만든 뒤 원곡이 변경되었습니다. 내용을 확인해주세요.\n\n' : ''}${original ? `현재 원곡 (${original.slides.length}슬라이드):\n${original.slides.find((x) => x.content?.trim())?.content?.slice(0, 240) || '(빈 본문)'}\n\n` : ''}콘티 (${song.presentation.slides.length}슬라이드):\n${song.presentation.slides.find((x) => x.content?.trim())?.content?.slice(0, 240) || '(빈 본문)'}\n\n콘티의 “${song.presentation.title}” 가사·반복 구성·색상·스타일을 ${original ? '원곡에 반영합니다.' : '새 곡으로 저장합니다.'} 다른 콘티의 곡 사본은 그대로 유지됩니다.`,
            buttons: ['취소', original ? '원곡에 반영' : '새 곡으로 저장'],
            defaultId: 0,
            cancelId: 0,
          })
          if (answer.response !== 1) return { success: false, canceled: true }
          await repo.publishSetlistSong(id, revision, sourceRevision)
          return { success: true }
        } catch (e) {
          return {
            success: false,
            error:
              e instanceof Error && !('code' in e) && !(e instanceof z.ZodError)
                ? e.message
                : '원곡 저장에 실패했습니다. 저장 상태를 확인해주세요.',
          }
        }
      })
      handle('save-to-library', async (p) => {
        await repo.saveDraft(p)
        return true
      })
      handle('save-draft', (p) => repo.saveDraft(p))
      handle('merge-to-library', (p) => repo.merge(p))
      handle('delete-from-library', (id) => repo.delete(Id.parse(id)))
      handle('save-playlist', async (p) => {
        await repo.setPlaylist(p)
        return true
      })
      handle('save-settings', (s) => repo.setSettings(s))
      handle('save-media', (s) => repo.setMedia(s))
      handle('dialog:openFile', async () => {
        const result = await dialog.showOpenDialog(windows.windows.get('control')!, {
          title: '미디어 등록',
          properties: ['openFile', 'multiSelections'],
          filters: [
            {
              name: '미디어',
              extensions: [
                'png',
                'jpg',
                'jpeg',
                'webp',
                'gif',
                'mp4',
                'webm',
                'mov',
                'm4v',
                'mp3',
                'wav',
                'ogg',
                'm4a',
                'aac',
                'flac',
              ],
            },
          ],
        })
        if (result.canceled) return []
        const urls: string[] = [],
          failures: string[] = []
        for (const file of result.filePaths)
          try {
            urls.push(repo.assetURL(await repo.register(file)))
          } catch {
            failures.push(path.basename(file))
          }
        if (failures.length)
          windows.notify(
            'operation-warning',
            `${failures.length}개 파일을 등록하지 못했습니다. 파일 크기·형식·저장 공간을 확인해주세요.`,
          )
        return urls
      })
      handle('cleanup-media', () => repo.cleanup())
      handle('relink-media', async () => {
        for (const asset of repo.state.assets) {
          try {
            await repo.assetPath(repo.assetURL(asset))
            continue
          } catch {
            /* Ask only for a missing registered asset. */
          }
          const selected = await dialog.showOpenDialog(windows.windows.get('control')!, {
            title: `미디어 다시 연결: ${asset.name}`,
            properties: ['openFile'],
            filters: [{ name: '기존 형식', extensions: [asset.extension.slice(1)] }],
          })
          if (selected.canceled) break
          await repo.relink(asset.id, selected.filePaths[0])
        }
      })
      async function saveFile(data?: string): Promise<FileResult> {
        try {
          const result = await dialog.showSaveDialog(windows.windows.get('control')!, {
            defaultPath: data ? 'presentation.ppros' : 'ProPre-backup.ppros',
            filters: [{ name: 'ProPre 프로젝트', extensions: ['ppros'] }],
          })
          if (result.canceled || !result.filePath) return { success: false, canceled: true }
          await atomicWrite(result.filePath, await repo.exportProject(data))
          return { success: true, filePath: result.filePath }
        } catch {
          return {
            success: false,
            error: '내보내기에 실패했습니다. 미디어 누락·파일 크기·저장 공간을 확인해주세요.',
          }
        }
      }
      async function loadFile(restore = false): Promise<FileResult> {
        try {
          const selected = await dialog.showOpenDialog(windows.windows.get('control')!, {
            properties: ['openFile'],
            filters: [{ name: 'ProPre 프로젝트', extensions: ['ppros', 'json'] }],
          })
          if (selected.canceled) return { success: false, canceled: true }
          const file = selected.filePaths[0],
            info = await fs.stat(file)
          if (info.size > MAX_FILE_BYTES) throw new Error('size')
          if (restore) {
            const answer = await dialog.showMessageBox(windows.windows.get('control')!, {
              type: 'question',
              message: '백업의 자료·순서·설정으로 복원할까요?',
              detail: '현재 자료는 최근 백업으로 보관됩니다. API 키는 변경되지 않습니다.',
              buttons: ['취소', '복원'],
              defaultId: 0,
              cancelId: 0,
            })
            if (answer.response !== 1) return { success: false, canceled: true }
            windows.windows.get('main')?.close()
            windows.windows.get('stage')?.close()
          }
          const warningCount = repo.warnings.length
          const data = await fs.readFile(file, 'utf8')
          if (!restore && parseProject(data).portable?.kind === 'playlist')
            return {
              success: false,
              error: '플레이리스트 영역의 파일 불러오기 버튼을 사용해주세요.',
            }
          const imported = await repo.importProject(data, restore)
          for (const warning of repo.warnings.slice(warningCount))
            windows.notify('operation-warning', warning)
          return {
            success: true,
            data: JSON.stringify({
              format: 'propre-project',
              schemaVersion: 1,
              kind: 'presentation',
              presentations: imported.presentations,
              assets: [],
            }),
            filePath: file,
            restored: restore,
          }
        } catch {
          return {
            success: false,
            error: '불러오기에 실패했습니다. 파일 형식·크기·포함 미디어를 확인해주세요.',
          }
        }
      }
      handle('save-playlist-file', async (expected) => {
        try {
          const data = await repo.exportPlaylist(expected)
          const selected = await dialog.showSaveDialog(windows.windows.get('control')!, {
            title: '플레이리스트 파일 저장',
            defaultPath: `${(repo.state.setlists.find((x) => x.id === repo.state.activeSetlistId)?.title || 'ProPre-playlist').replace(/[\\/:*?"<>|]/g, '-')}.ppros`,
            filters: [{ name: 'ProPre 플레이리스트', extensions: ['ppros'] }],
          })
          if (selected.canceled || !selected.filePath) return { success: false, canceled: true }
          await atomicWrite(selected.filePath, data)
          return { success: true, filePath: selected.filePath }
        } catch (e) {
          return {
            success: false,
            error:
              e instanceof Error &&
              !('code' in e) &&
              !(e instanceof z.ZodError) &&
              !(e instanceof SyntaxError)
                ? e.message
                : '파일 저장에 실패했습니다. 저장 공간과 접근 권한을 확인해주세요.',
          }
        }
      })
      handle('load-playlist-file', async (expected) => {
        try {
          const before = PlaylistRefsSchema.parse(expected)
          const selected = await dialog.showOpenDialog(windows.windows.get('control')!, {
            title: '플레이리스트 파일 불러오기',
            properties: ['openFile'],
            filters: [{ name: 'ProPre 플레이리스트', extensions: ['ppros'] }],
          })
          if (selected.canceled || !selected.filePaths[0]) return { success: false, canceled: true }
          const file = selected.filePaths[0]
          if ((await fs.stat(file)).size > MAX_FILE_BYTES)
            throw new Error('파일이 200MB를 초과합니다.')
          const data = await fs.readFile(file, 'utf8')
          const { portable } = parseProject(data)
          if (portable?.kind !== 'playlist' || !portable.playlist)
            throw new Error('플레이리스트 파일을 선택해주세요.')
          const titles = new Map(portable.presentations.map((p) => [p.id, p.title]))
          const order = portable.playlist
            .slice(0, 50)
            .map((item, i) => `${i + 1}. ${titles.get(item.presentationId)}`)
            .join('\n')
          const answer = await dialog.showMessageBox(windows.windows.get('control')!, {
            type: 'question',
            message: `이 파일의 ${portable.playlist.length}개 순서로 바꿀까요?`,
            detail: `${order}${portable.playlist.length > 50 ? '\n… (앞의 50개 순서 표시)' : ''}\n\n새 콘티로 보관하며 현재 순서를 바꿉니다. 각 곡은 찬양 목록에도 저장됩니다. 같은 곡은 재사용하고, 내용이 다른 곡은 새 자료로 저장합니다. 현재 열어둔 곡과 송출 화면은 유지됩니다.`,
            buttons: ['취소', '불러오기'],
            defaultId: 0,
            cancelId: 0,
          })
          if (answer.response !== 1) return { success: false, canceled: true }
          const imported = await repo.importProject(data, false, before)
          return {
            success: true,
            added: imported.added,
            reused: imported.reused,
            itemCount: portable.playlist.length,
          }
        } catch (e) {
          return {
            success: false,
            error:
              e instanceof Error &&
              !('code' in e) &&
              !(e instanceof z.ZodError) &&
              !(e instanceof SyntaxError)
                ? e.message
                : '불러오기에 실패했습니다. 파일 형식·포함 미디어·저장 공간을 확인해주세요.',
          }
        }
      })
      handle('save-project', (data) => saveFile(z.string().max(MAX_STATE_BYTES).parse(data)))
      handle('load-project', () => loadFile())
      handle('create-backup', () => saveFile())
      handle('restore-backup', () => loadFile(true))
      handle('recover-previous', () => repo.recoverPrevious())
      handle('get-displays', () => windows.displays())
      handle('get-active-displays', () => ({
        outputDisplayId: repo.state.outputDisplayId,
        stageDisplayId: repo.state.stageDisplayId,
      }))
      handle('set-output-display', (id) => windows.setDisplay('main', z.number().int().parse(id)))
      handle('set-stage-display', (id) => windows.setDisplay('stage', z.number().int().parse(id)))
      handle('toggle-output', () => windows.toggle('main'))
      handle('toggle-stage', () => windows.toggle('stage'))
      handle('get-output-status', () => windows.status('main'))
      handle('get-stage-status', () => windows.status('stage'))
      handle('get-ai-connection', () => automation!.state())
      handle('set-ai-connection', (enabled, permission) =>
        automation!.setEnabled(
          z.boolean().parse(enabled),
          z.enum(['read', 'prepare']).parse(permission),
        ),
      )
      handle('copy-ai-connection-config', async (raw) => {
        const format = z.enum(['codex', 'json']).parse(raw)
        const command = app.getPath('exe'),
          args = [path.join(root, 'scripts', 'propre-mcp.mjs'), automation!.connectionFile]
        const config =
          format === 'json'
            ? JSON.stringify(
                { mcpServers: { propre: { command, args, env: { ELECTRON_RUN_AS_NODE: '1' } } } },
                null,
                2,
              )
            : `[mcp_servers.propre]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\nstartup_timeout_sec = 15\ntool_timeout_sec = 30\n\n[mcp_servers.propre.env]\nELECTRON_RUN_AS_NODE = "1"\n`
        await clipboard.writeText(config)
      })
      handle(
        'check-ai-command',
        (id) =>
          !closing &&
          !quitting &&
          !!pendingCommands.has(Id.parse(id)) &&
          !!automation?.authorizeCommand(id),
      )
      handle('complete-ai-command', (id, raw) => {
        Id.parse(id)
        if (Buffer.byteLength(JSON.stringify(raw)) > AI_REQUEST_BYTES)
          throw new Error('AI 결과가 너무 큽니다.')
        const result = z
          .object({
            data: z.record(z.string(), z.unknown()).optional(),
            preview: z.object({ slide: z.unknown(), style: z.unknown() }).optional(),
            error: z
              .object({
                code: z.string().max(80),
                message: z.string().max(1000),
                applied: z.boolean().optional(),
              })
              .optional(),
          })
          .strict()
          .parse(raw) as AICommandResult
        const pending = pendingCommands.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        pendingCommands.delete(id)
        pending.resolve(result)
      })
      const preparationFailure = (e: unknown) => ({
        error:
          e instanceof PreparationError
            ? { code: e.code, message: e.message }
            : {
                code: 'SAVE_FAILED',
                message: '자료를 저장하지 못했습니다. 앱의 저장 공간과 접근 권한을 확인해주세요.',
              },
      })
      handle('save-prepared-presentation', async (p, expected) => {
        try {
          return {
            presentation: await repo.savePrepared(
              p,
              z.number().int().nonnegative().nullable().parse(expected),
            ),
          }
        } catch (e) {
          return preparationFailure(e)
        }
      })
      handle('save-prepared-playlist', async (items, expected) => {
        try {
          await repo.setPreparedPlaylist(items, expected)
          return {}
        } catch (e) {
          return preparationFailure(e)
        }
      })
      const event = (
        channel: string,
        roles: ('control' | 'main' | 'stage')[],
        handler: (role: 'control' | 'main' | 'stage', value: any) => void,
      ) =>
        ipcMain.on(channel, (e, value) => {
          try {
            const role = windows.authorize(e, roles)
            handler(role, value)
          } catch {
            windows.notify('operation-warning', '허용되지 않거나 잘못된 화면 요청을 차단했습니다.')
          }
        })
      event('route-screen-update', ['control'], (_role, value) => {
        const v = z.object({ screenId: z.literal('main'), data: z.unknown() }).parse(value)
        windows.publishOutput(v.data)
      })
      event('update-stage', ['control'], (_role, value) => windows.publishStage(value))
      event('screen-ready', ['control', 'main', 'stage'], (role) => windows.ready(role))
      event('screen-applied', ['main', 'stage'], (role, value) =>
        windows.acknowledge(role, z.number().int().positive().parse(value)),
      )
      event('media-error', ['control', 'main', 'stage'], (role) => windows.mediaError(role))
      event('close-ready', ['control'], (_role, value) => closeResolver?.(z.boolean().parse(value)))
      windows.onControlClose = (event) => {
        if (allowClose) {
          if (!quitting) allowClose = false
          return
        }
        event.preventDefault()
        if (closing) return
        closing = true
        void (async () => {
          const ready =
            !windows.isControlReady() ||
            (await new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => {
                closeResolver = undefined
                resolve(false)
              }, 8000)
              closeResolver = (success) => {
                clearTimeout(timer)
                closeResolver = undefined
                resolve(success)
              }
              windows.notify('request-flush', null)
            }))
          let completed = false
          if (ready)
            try {
              await repo.settled()
              completed = true
              allowClose = true
              if (quitting) app.quit()
              else windows.windows.get('control')?.close()
            } catch {
              allowClose = false
            }
          if (!completed) {
            quitting = false
            await dialog.showMessageBox(windows.windows.get('control')!, {
              type: 'error',
              message: '자동 저장을 완료하지 못해 창을 열어두었습니다.',
              detail: '저장 오류를 해결하거나 백업을 내보낸 뒤 다시 종료해주세요.',
              buttons: ['확인'],
            })
          }
          closing = false
        })()
      }
      windows.installMenu()
      await windows.restore()
    })
    .catch(() => {
      void dialog.showErrorBox(
        'ProPre 시작 오류',
        '저장소를 초기화하지 못했습니다. 저장 공간과 접근 권한을 확인해주세요. 기존 자료는 보관됩니다.',
      )
      app.quit()
    })
app.on('second-instance', () => windows?.create('control'))
app.on('activate', () => windows?.create('control'))
app.on('before-quit', (event) => {
  if (!allowClose && windows?.windows.has('control')) {
    event.preventDefault()
    quitting = true
    windows.windows.get('control')!.close()
  }
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('will-quit', () => {
  preparationPreview?.dispose()
  if (automation) {
    try {
      rmSync(automation.connectionFile, { force: true })
    } catch {
      /* Cleared on next startup. */
    }
    void automation.stop().catch(() => {})
  }
})
