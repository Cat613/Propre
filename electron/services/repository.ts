import { SaveMusicSchema } from '../../shared/music'
import {
  AttachCueSchema,
  ServiceFileTargetSchema,
  type ServiceFileTarget,
} from '../../shared/service-session'
import { SaveServicePlanSchema, songProjection } from '../../shared/service-plan'
import { TemplateCommand } from '../../shared/service-template'
import { mutateTemplate, copyTemplate } from './service-templates'
import {
  migrateServicePlans,
  syncSongCues,
  copyServicePlan,
  validateServicePlans,
  importServiceState,
} from './service-plan-storage'
import { PDFDocument } from 'pdf-lib'
import {
  OutputResourcesSchema,
  ResourceCommand,
  normalizeWebURL,
} from '../../shared/output-resources'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import { ApplyReceiptSchema } from '../../shared/song-preparation'
import { ServiceTemplatesSchema } from '../../shared/schema'
import type { Presentation, PlaylistItem, MediaItem } from '../../src/types'
import {
  Id,
  CuePresentationsSchema,
  CueResourcesSchema,
  LibrarySchema,
  DeletedLibrarySchema,
  DeletedMediaSchema,
  PresentationSchema,
  SettingsSchema,
  MediaSchema,
  PlaylistRefsSchema,
  SetlistsSchema,
  SetlistSongsSchema,
  MAX_FILE_BYTES,
  MAX_STATE_BYTES,
  boundedJSON,
  parseLibrary,
  parsePresentation,
  parseProject,
} from '../../shared/schema'
import { mediaKind } from '../../shared/model'
import { PreparationError } from '../../shared/automation'
import { SetlistCommandSchema, type SetlistWorkspace } from '../../shared/setlists'

const Asset = z.object({
  id: Id,
  name: z.string().max(500),
  type: z.enum(['image', 'video', 'audio', 'document']),
  extension: z
    .string()
    .regex(/^\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v|mp3|wav|ogg|m4a|aac|flac|pdf)$/),
  filename: z.string().regex(/^[a-zA-Z0-9_-]+\.[a-z0-9]+$/),
})
export type AssetRecord = z.infer<typeof Asset>
const State = z.object({
  schemaVersion: z.literal(5),
  serviceTemplates: ServiceTemplatesSchema.default([]),
  cuePresentations: CuePresentationsSchema.default([]),
  cueResources: CueResourcesSchema.default([]),
  outputResources: OutputResourcesSchema.default([]),
  songReceipts: z.array(ApplyReceiptSchema).max(5000).default([]),
  setlists: SetlistsSchema.default([]),
  setlistSongs: SetlistSongsSchema.default([]),
  activeSetlistId: Id.nullable().default(null),
  library: LibrarySchema,
  deletedLibrary: DeletedLibrarySchema.default([]),
  deletedMedia: DeletedMediaSchema.default([]),
  playlist: PlaylistRefsSchema,
  draft: PresentationSchema.nullable(),
  settings: SettingsSchema,
  media: z.array(MediaSchema).max(10000),
  assets: z.array(Asset).max(10000),
  outputDisplayId: z.number().int().nullable(),
  stageDisplayId: z.number().int().nullable(),
  wasOutputActive: z.boolean(),
  wasStageActive: z.boolean(),
})
export type RepositoryState = z.infer<typeof State>
const empty = (): RepositoryState => ({
  schemaVersion: 5,
  serviceTemplates: [],
  cuePresentations: [],
  cueResources: [],
  outputResources: [],
  songReceipts: [],
  setlists: [],
  setlistSongs: [],
  activeSetlistId: null,
  library: [],
  deletedLibrary: [],
  deletedMedia: [],
  playlist: [],
  draft: null,
  settings: {},
  media: [],
  assets: [],
  outputDisplayId: null,
  stageDisplayId: null,
  wasOutputActive: false,
  wasStageActive: false,
})
export async function atomicWrite(filename: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true })
  const temp = `${filename}.${randomUUID()}.tmp`
  try {
    const file = await fs.open(temp, 'wx', 0o600)
    try {
      await file.writeFile(data)
      await file.sync()
    } finally {
      await file.close()
    }
    await fs.rename(temp, filename)
    const dir = await fs.open(path.dirname(filename), 'r')
    try {
      await dir.sync()
    } finally {
      await dir.close()
    }
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {})
  }
}
const mediaFields = new Set(['url', 'backgroundUrl', 'thumbnail'])
export function mediaURLs(value: unknown): string[] {
  const found: string[] = []
  const visit = (item: unknown) => {
    if (!item || typeof item !== 'object') return
    for (const [key, child] of Object.entries(item)) {
      if (mediaFields.has(key) && typeof child === 'string' && /^(file|media):\/\//.test(child))
        found.push(child)
      else if (child && typeof child === 'object') visit(child)
    }
  }
  visit(value)
  return [...new Set(found)]
}
function replaceMediaURL<T>(value: T, from: string, to: string): T {
  return JSON.parse(
    JSON.stringify(value, (key, child) => (mediaFields.has(key) && child === from ? to : child)),
  )
}
const clone = <T>(value: T): T => structuredClone(value)
// Document identities and edit timestamps do not change a song's content.
function songSignature(p: Presentation): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== 'id')
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, canonical(child)]),
      )
    return value
  }
  return JSON.stringify(
    canonical({
      title: p.title,
      slides: p.slides,
      songForm: p.songForm,
      globalSlideStyle: p.globalSlideStyle,
    }),
  )
}
function touch(list: RepositoryState['setlists'][number]) {
  list.updatedAt = new Date().toISOString()
  list.revision++
}
function newSetlist(s: RepositoryState, title: string, date?: string) {
  const now = new Date().toISOString()
  const list = {
    id: randomUUID(),
    title,
    date,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    revision: 0,
    items: [] as RepositoryState['playlist'],
    servicePlan: { version: 1 as const, timezone: 'Asia/Seoul', items: [] },
  }
  s.setlists.push(list)
  s.activeSetlistId = list.id
  s.playlist = []
  return list
}
function replaceOrder(s: RepositoryState, refs: RepositoryState['playlist']) {
  if (!s.activeSetlistId && !refs.length) {
    s.playlist = []
    return
  }
  const list = s.setlists.find((x) => x.id === s.activeSetlistId) || newSetlist(s, '현재 콘티')
  const owned = new Set(list.items.map((x) => x.presentationId)),
    mapping = new Map<string, string>()
  const items = refs.map((item) => {
    if (owned.has(item.presentationId)) return clone(item)
    let id = mapping.get(item.presentationId)
    if (!id) {
      const snapshot = s.setlistSongs.find((x) => x.presentation.id === item.presentationId)
      const source = s.library.find((x) => x.id === item.presentationId)
      const p = source || snapshot?.presentation
      if (!p) throw new PreparationError('NOT_FOUND', '순서의 자료를 찾지 못했습니다.')
      id = 'setlist_' + randomUUID()
      s.setlistSongs.push({
        presentation: { ...clone(p), id, revision: 0 },
        sourcePresentationId: source?.id || snapshot?.sourcePresentationId,
        sourceRevision: source?.revision || snapshot?.sourceRevision || 0,
      })
      mapping.set(item.presentationId, id)
    }
    return { id: item.id, presentationId: id }
  })
  list.items = items
  syncSongCues(s, list)
  s.playlist = clone(items)
  touch(list)
}
function validateSetlists(s: RepositoryState) {
  const ids = new Set(s.setlistSongs.map((x) => x.presentation.id))
  if (s.setlistSongs.some((x) => s.library.some((p) => p.id === x.presentation.id)))
    throw new Error('원곡과 콘티 곡의 ID가 겹칩니다.')
  if (s.setlists.some((x) => x.items.some((i) => !ids.has(i.presentationId))))
    throw new Error('콘티에 필요한 곡이 빠져 있습니다.')
  const owners = new Map<string, string>()
  for (const list of s.setlists)
    for (const item of list.items) {
      const owner = owners.get(item.presentationId)
      if (owner && owner !== list.id)
        throw new Error('서로 다른 콘티가 곡 사본을 공유할 수 없습니다.')
      owners.set(item.presentationId, list.id)
    }
  const active = s.setlists.find((x) => x.id === s.activeSetlistId)
  if (
    s.activeSetlistId
      ? !active || active.deletedAt || JSON.stringify(active.items) !== JSON.stringify(s.playlist)
      : s.playlist.length
  )
    throw new Error('현재 콘티와 진행 순서가 일치하지 않습니다.')
}
class FutureWorkspaceError extends Error {}
export class Repository {
  state: RepositoryState = empty()
  warnings: string[] = []
  private tail: Promise<unknown> = Promise.resolve()
  private blocked = false
  assertServiceMutation: ((draft: RepositoryState) => void) | undefined
  readonly filename: string
  readonly mediaDir: string
  constructor(readonly directory: string) {
    this.filename = path.join(directory, 'workspace-v5.json')
    this.mediaDir = path.join(directory, 'media')
  }
  async open(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true })
    const present = await fs.stat(this.filename).then(
      () => true,
      () => false,
    )
    if (present) {
      try {
        this.state = await this.read(this.filename)
        return
      } catch (error) {
        if (error instanceof FutureWorkspaceError) {
          this.blocked = true
          this.warnings.push(
            '더 새로운 앱에서 저장한 자료입니다. 앱을 업데이트해주세요. 원본은 보존했습니다.',
          )
          return
        }
        await fs.copyFile(this.filename, `${this.filename}.damaged-${Date.now()}`).catch(() => {})
        for (let n = 1; n <= 5; n++)
          try {
            this.state = await this.read(`${this.filename}.bak${n}`)
            this.warnings.push(
              '저장 파일 오류를 감지해 마지막 유효 백업으로 복구했습니다. 손상 원본은 보관했습니다.',
            )
            await atomicWrite(this.filename, JSON.stringify(this.state))
            return
          } catch {
            /* Try the next intact checkpoint. */
          }
        this.blocked = true
        this.warnings.push(
          '저장 파일을 읽지 못했습니다. 원본을 보관했습니다. 백업 복원을 통해 자료를 복구해주세요.',
        )
        return
      }
    }
    let previous = path.join(this.directory, 'workspace-v1.json')
    for (const version of [4, 3, 2, 1]) {
      const candidate = path.join(this.directory, `workspace-v${version}.json`)
      if (
        await fs.stat(candidate).then(
          () => true,
          () => false,
        )
      ) {
        previous = candidate
        break
      }
    }
    if (
      await fs.stat(previous).then(
        () => true,
        () => false,
      )
    ) {
      for (let n = 0; n <= 5; n++) {
        try {
          this.state = await this.read(n ? `${previous}.bak${n}` : previous)
          await atomicWrite(this.filename, JSON.stringify(this.state))
          if (n)
            this.warnings.push(
              '이전 작업 공간의 유효 백업으로 콘티를 복구했습니다. 이전 원본은 보존했습니다.',
            )
          return
        } catch (error) {
          if (error instanceof FutureWorkspaceError) {
            this.blocked = true
            this.warnings.push('더 새로운 앱에서 저장한 자료입니다. 앱을 업데이트해주세요.')
            return
          }
          /* Preserve old files and try another intact checkpoint. */
        }
      }
      this.blocked = true
      this.warnings.push(
        '이전 작업 공간을 옮기지 못했습니다. 이전 작업 공간 원본은 보존했습니다. 백업 복원 또는 원본 확인이 필요합니다.',
      )
      return
    }
    const legacyPath = path.join(this.directory, 'config.json')
    try {
      const data = boundedJSON(await fs.readFile(legacyPath, 'utf8')) as Record<string, unknown>
      if (!data || typeof data !== 'object') throw new Error('invalid legacy store')
      this.state.library = parseLibrary(data.library || [])
      if (data.settings) this.state.settings = SettingsSchema.parse(data.settings)
      this.state.playlist = PlaylistRefsSchema.parse(data.playlist || []).filter((x) =>
        this.state.library.some((p) => p.id === x.presentationId),
      )
      this.state.outputDisplayId =
        typeof data.outputDisplayId === 'number' ? data.outputDisplayId : null
      this.state.stageDisplayId =
        typeof data.stageDisplayId === 'number' ? data.stageDisplayId : null
      this.state.wasOutputActive = data.wasOutputActive === true
      this.state.wasStageActive = data.wasStageActive === true
      // Only managed legacy media may be migrated without another file-selection grant.
      this.state.library = await this.migrateLegacyMedia()
      replaceOrder(this.state, this.state.playlist)
      await atomicWrite(this.filename, JSON.stringify(this.state))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      this.blocked = true
      this.warnings.push(
        '기존 자료를 안전하게 변환하지 못했습니다. 기존 config.json은 유지했습니다. 백업 복원 또는 원본 확인이 필요합니다.',
      )
    }
  }
  private async read(filename: string): Promise<RepositoryState> {
    const info = await fs.stat(filename)
    if (info.size > MAX_STATE_BYTES) throw new Error('state too large')
    const raw = boundedJSON(await fs.readFile(filename, 'utf8')) as Record<string, unknown>
    if (typeof raw?.schemaVersion === 'number' && raw.schemaVersion > 5)
      throw new FutureWorkspaceError()
    if (![1, 2, 3, 4, 5].includes(raw?.schemaVersion as number))
      throw new Error('unsupported workspace')
    const parsed = State.parse({ ...raw, schemaVersion: 5 })
    if (raw.schemaVersion === 1) replaceOrder(parsed, parsed.playlist)
    if ((raw.schemaVersion as number) < 4) migrateServicePlans(parsed)
    validateSetlists(parsed)
    validateServicePlans(parsed)
    this.validateResources(parsed)
    return {
      ...parsed,
      library: parseLibrary(parsed.library),
      draft: parsed.draft ? parsePresentation(parsed.draft) : null,
    }
  }
  async transaction(change: (draft: RepositoryState) => void, recovery = false): Promise<void> {
    const operation = this.tail
      .catch(() => {})
      .then(async () => {
        if (this.blocked && !recovery)
          throw new Error('원본을 보호하기 위해 저장을 중지했습니다. 백업을 복원해주세요.')
        const draft = clone(this.state)
        change(draft)
        this.assertServiceMutation?.(draft)
        const checked = State.parse(draft)
        validateSetlists(checked)
        validateServicePlans(checked)
        this.validateResources(checked)
        const data = JSON.stringify(checked)
        if (Buffer.byteLength(data) > MAX_STATE_BYTES)
          throw new Error('자료 크기가 저장 한도를 초과했습니다.')
        const old = await fs.readFile(this.filename).catch(() => null)
        if (old && !this.blocked) {
          for (let n = 4; n >= 1; n--)
            await fs
              .copyFile(`${this.filename}.bak${n}`, `${this.filename}.bak${n + 1}`)
              .catch((e: NodeJS.ErrnoException) => {
                if (e.code !== 'ENOENT') throw e
              })
          await atomicWrite(`${this.filename}.bak1`, old)
        }
        await atomicWrite(this.filename, data)
        this.state = checked
        this.blocked = false
      })
    this.tail = operation
    await operation
  }
  async settled(): Promise<void> {
    await this.tail
  }
  library(): Presentation[] {
    return clone(this.state.library) as Presentation[]
  }
  playlist(): PlaylistItem[] {
    return this.state.playlist.flatMap((item) => {
      const presentation = this.state.setlistSongs.find(
        (p) => p.presentation.id === item.presentationId,
      )?.presentation
      return presentation ? [{ ...item, presentation: clone(presentation) as Presentation }] : []
    })
  }
  workspace(state: RepositoryState = this.state): SetlistWorkspace {
    return {
      library: clone(state.library),
      serviceTemplates: clone(state.serviceTemplates),
      playlist: state.playlist.flatMap((item) => {
        const presentation = state.setlistSongs.find(
          (song) => song.presentation.id === item.presentationId,
        )?.presentation
        return presentation ? [{ ...clone(item), presentation: clone(presentation) }] : []
      }),
      setlists: clone(state.setlists),
      setlistSongs: clone(state.setlistSongs),
      activeSetlistId: state.activeSetlistId,
      cuePresentations: clone(state.cuePresentations),
      cueResources: clone(state.cueResources),
    }
  }
  private planReceipts = new Map<
    string,
    { signature: string; promise: Promise<SetlistWorkspace>; done: boolean }
  >()
  private async mutateService(
    requestId: string,
    signature: string,
    change: (state: RepositoryState) => void,
  ): Promise<SetlistWorkspace> {
    const prior = this.planReceipts.get(requestId)
    if (prior) {
      if (prior.signature !== signature) throw new Error('같은 요청 ID의 내용이 다릅니다.')
      return clone(await prior.promise)
    }
    if (this.planReceipts.size >= 1000) {
      const completed = [...this.planReceipts].find(([, receipt]) => receipt.done)
      if (!completed) throw new Error('진행 중인 저장을 마친 뒤 다시 시도해주세요.')
      this.planReceipts.delete(completed[0])
    }
    const receipt = {
      signature,
      done: false,
      promise: undefined as unknown as Promise<SetlistWorkspace>,
    }
    receipt.promise = (async () => {
      let result: SetlistWorkspace | undefined
      await this.transaction((s) => {
        change(s)
        result = this.workspace(s)
      })
      receipt.done = true
      return result!
    })()
    this.planReceipts.set(requestId, receipt)
    try {
      return clone(await receipt.promise)
    } catch (error) {
      this.planReceipts.delete(requestId)
      throw error
    }
  }
  readonly musicPins = new Set<string>()
  async saveMusic(raw: unknown): Promise<SetlistWorkspace> {
    const command = SaveMusicSchema.parse(raw)
    this.assertAssets(command.items)
    for (const item of command.items)
      for (const url of mediaURLs(item)) {
        const asset = this.state.assets.find((a) => a.id === new URL(url).pathname.split('/')[1])
        if (asset?.type !== 'audio') throw new Error('오디오 파일을 선택해주세요.')
      }
    await this.transaction((s) => {
      const list = s.setlists.find((x) => x.id === command.setlistId && !x.deletedAt)
      if (!list || list.revision !== command.expectedRevision)
        throw new Error('예배가 변경되었습니다. 음악 목록을 다시 확인해주세요.')
      for (const item of command.items) {
        const old = list.music?.find((x) => x.id === item.id)
        if (old && JSON.stringify(old) !== JSON.stringify(item) && item.revision <= old.revision)
          throw new Error('음악 설정의 버전이 변경되었습니다. 다시 확인해주세요.')
      }
      list.music = command.items
      for (const cue of list.servicePlan?.items || [])
        if (cue.musicPreparationId && !list.music.some((x) => x.id === cue.musicPreparationId))
          delete cue.musicPreparationId
      touch(list)
    })
    return this.workspace()
  }
  async saveServicePlan(raw: unknown): Promise<SetlistWorkspace> {
    const command = SaveServicePlanSchema.parse(raw)
    return this.mutateService(
      command.requestId,
      JSON.stringify({ operation: 'save-plan', command }),
      (s) => {
        const list = s.setlists.find((x) => x.id === command.setlistId && !x.deletedAt)
        if (!list || list.revision !== command.expectedSetlistRevision)
          throw new Error('예배 순서가 변경되었습니다. 최신 내용을 다시 확인해주세요.')
        if (command.plan.items.length > Math.max(1000, list.servicePlan?.items.length || 0))
          throw new Error('새 예배 순서는 1,000개까지 추가할 수 있습니다.')
        const rowIds = new Set(
          command.plan.items.filter((cue) => cue.kind === 'song').map((cue) => cue.songItemId),
        )
        const rows = command.restoreSongRows
          ? clone(command.restoreSongRows)
          : list.items.filter((row) => rowIds.has(row.id))
        if (command.restoreSongRows)
          for (const row of rows) {
            const saved = s.setlistSongs.find(
              (entry) => entry.presentation.id === row.presentationId,
            )
            if (!saved) throw new Error('되돌릴 찬양 사본이 없습니다.')
            if (
              s.setlists.some(
                (owner) =>
                  owner.id !== list.id &&
                  owner.items.some((item) => item.presentationId === row.presentationId),
              )
            ) {
              const copy = {
                presentation: {
                  ...clone(saved.presentation),
                  id: 'setlist_' + randomUUID(),
                  revision: 0,
                },
              }
              s.setlistSongs.push(copy)
              row.presentationId = copy.presentation.id
            }
          }
        list.items = songProjection(command.plan, rows)
        list.servicePlan = clone(command.plan)
        if (s.activeSetlistId === list.id) s.playlist = clone(list.items)
        touch(list)
      },
    )
  }
  async manageServiceTemplate(raw: unknown) {
    const command = TemplateCommand.parse(raw)
    return this.mutateService(
      command.requestId,
      JSON.stringify({ operation: 'template', command }),
      (state) => mutateTemplate(state, command),
    )
  }
  async exportServiceTemplate(id: string, revision: number) {
    await this.settled()
    const template = this.state.serviceTemplates.find(
      (entry) => entry.id === id && !entry.deletedAt,
    )
    if (!template || template.revision !== revision)
      throw new Error('템플릿이 바뀌었습니다. 다시 저장해주세요.')
    const bundle = clone({
      format: 'propre-project',
      schemaVersion: 4,
      kind: 'service-template',
      presentations: [],
      serviceTemplates: [template],
      assets: [] as unknown[],
    })
    this.assertAssets(bundle)
    const ids = new Set(mediaURLs(bundle).map((url) => new URL(url).pathname.split('/')[1]))
    for (const resource of template.resources)
      if (resource.kind === 'pdf') ids.add(resource.assetId)
    let bytes = Buffer.byteLength(JSON.stringify(bundle))
    for (const id of ids) {
      const asset = this.state.assets.find((entry) => entry.id === id)
      if (!asset) throw new Error('템플릿에 필요한 파일이 없습니다.')
      const content = await fs.readFile(await this.assetPath(this.assetURL(asset)))
      bytes += Math.ceil((content.length * 4) / 3)
      if (bytes > MAX_FILE_BYTES) throw new Error('템플릿 파일이200MB를 초과합니다.')
      bundle.assets.push({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        extension: asset.extension,
        sha256: createHash('sha256').update(content).digest('hex'),
        data: content.toString('base64'),
      })
    }
    const result = JSON.stringify(bundle)
    parseProject(result)
    if (
      Buffer.byteLength(result) > MAX_FILE_BYTES ||
      this.state.serviceTemplates.find((entry) => entry.id === template.id)?.revision !== revision
    )
      throw new Error('저장 중 템플릿이 바뀌거나 파일 상한을 초과했습니다.')
    return result
  }
  async attachServiceCue(raw: unknown): Promise<SetlistWorkspace> {
    const command = AttachCueSchema.parse(raw)
    return this.mutateService(
      command.requestId,
      JSON.stringify({ operation: 'attach', command }),
      (s) => {
        const list = s.setlists.find((x) => x.id === command.setlistId && !x.deletedAt)
        if (!list || list.revision !== command.expectedSetlistRevision)
          throw new Error('예배 순서가 변경되었습니다. 다시 확인해주세요.')
        if (command.plan) {
          if (command.plan.items.length > Math.max(1000, list.servicePlan?.items.length || 0))
            throw new Error('새 예배 순서는 1,000개까지 추가할 수 있습니다.')
          const rowIds = new Set(
            command.plan.items.filter((cue) => cue.kind === 'song').map((cue) => cue.songItemId),
          )
          list.items = songProjection(
            command.plan,
            list.items.filter((row) => rowIds.has(row.id)),
          )
          list.servicePlan = clone(command.plan)
          if (s.activeSetlistId === list.id) s.playlist = clone(list.items)
        }
        const cue = list.servicePlan?.items.find((x) => x.id === command.cueId)
        if (!cue) throw new Error('자료를 연결할 순서를 선택해주세요.')
        const source = command.source
        if (cue.kind === 'song') {
          if (source.kind !== 'presentation' || !cue.materialPending)
            throw new Error('찬양 교체는 비어 있는 슬롯에서만 가능합니다.')
          const original = s.library.find((p) => p.id === source.id)
          if (!original?.slides.some((slide) => slide.id === source.slideId))
            throw new Error('연결할 찬양을 확인해주세요.')
          const row = list.items.find((row) => row.id === cue.songItemId)!
          const presentation = { ...clone(original), id: 'setlist_' + randomUUID(), revision: 0 }
          s.setlistSongs.push({ presentation })
          row.presentationId = presentation.id
          delete cue.materialPending
          cue.title = original.title.slice(0, 200)
          if (s.activeSetlistId === list.id) s.playlist = clone(list.items)
          touch(list)
          return
        }
        if (source.kind === 'none') {
          delete cue.materialPending
          delete cue.binding
          if (cue.enter.visual === 'bound') cue.enter.visual = 'keep'
        } else if (source.kind === 'presentation') {
          delete cue.materialPending
          const original =
            s.library.find((x) => x.id === source.id) ||
            s.setlistSongs.find((x) => x.presentation.id === source.id)?.presentation
          if (!original || !original.slides.some((slide) => slide.id === source.slideId))
            throw new Error('연결할 슬라이드를 찾지 못했습니다.')
          const presentation = { ...clone(original), id: 'cue_' + randomUUID(), revision: 0 }
          s.cuePresentations.push({ ownerSetlistId: list.id, presentation })
          cue.binding = {
            kind: 'presentation',
            presentationId: presentation.id,
            slideId: source.slideId,
          }
        } else {
          delete cue.materialPending
          const original = s.outputResources.find((x) => x.id === source.id && !x.deletedAt)
          if (
            !original ||
            (original.kind === 'pdf' && (!source.page || source.page > original.pageCount)) ||
            (original.kind === 'web' &&
              (source.page !== undefined || source.rotation !== undefined))
          )
            throw new Error('연결할 자료와 페이지를 확인해주세요.')
          const resource = { ...clone(original), id: randomUUID(), revision: 0 }
          s.cueResources.push({ ownerSetlistId: list.id, resource })
          cue.binding = {
            kind: 'resource',
            resourceId: resource.id,
            ...(resource.kind === 'pdf'
              ? { page: source.page, rotation: source.rotation ?? resource.rotation }
              : {}),
          }
        }
        touch(list)
      },
    )
  }
  async saveDraft(raw: unknown): Promise<Presentation[]> {
    const p = parsePresentation(raw)
    this.assertAssets(p)
    await this.transaction((s) => {
      const owned = s.cuePresentations.find((x) => x.presentation.id === p.id)
      const snapshot = s.setlistSongs.find((x) => x.presentation.id === p.id)
      if (
        !snapshot &&
        !owned &&
        (p.id.startsWith('setlist_') || p.id.startsWith('cue_')) &&
        !s.library.some((x) => x.id === p.id)
      )
        throw new Error('콘티 곡의 저장 위치를 찾지 못했습니다. 보관함이나 백업을 복원해주세요.')
      const old =
        owned?.presentation || snapshot?.presentation || s.library.find((x) => x.id === p.id)
      if ((old?.revision || 0) > (p.revision || 0))
        throw new Error('새 수정본이 이미 저장되어 있습니다. 자료를 다시 열어주세요.')
      if (owned) {
        owned.presentation = p
        const list = s.setlists.find((x) => x.id === owned.ownerSetlistId)
        if (list) touch(list)
      } else if (snapshot) {
        snapshot.presentation = p
        for (const list of s.setlists.filter((x) =>
          x.items.some((i) => i.presentationId === p.id),
        )) {
          if (p.slides.length)
            for (const cue of list.servicePlan?.items || [])
              if (
                cue.kind === 'song' &&
                list.items.some((row) => row.id === cue.songItemId && row.presentationId === p.id)
              )
                delete cue.materialPending
          touch(list)
        }
      } else s.library = s.library.filter((x) => x.id !== p.id).concat(p)
      s.draft = p
    })
    return this.library()
  }
  async merge(raw: unknown): Promise<Presentation[]> {
    const incoming = parseLibrary(raw)
    this.assertAssets(incoming)
    // Imported documents receive fresh identities; existing documents are never silently overwritten.
    await this.transaction((s) => {
      s.library.push(...incoming.map((p) => ({ ...p, id: randomUUID(), revision: 0 })))
    })
    return this.library()
  }
  async savePrepared(raw: unknown, expectedRevision: number | null): Promise<Presentation> {
    const p = parsePresentation(raw)
    this.assertAssets(p)
    await this.transaction((s) => {
      const snapshot = s.setlistSongs.find((x) => x.presentation.id === p.id)
      if (!snapshot && p.id.startsWith('setlist_') && !s.library.some((x) => x.id === p.id))
        throw new Error('콘티 곡의 저장 위치를 찾지 못했습니다. 보관함이나 백업을 복원해주세요.')
      const old = snapshot?.presentation || s.library.find((x) => x.id === p.id)
      if (expectedRevision === null ? !!old : !old || (old.revision || 0) !== expectedRevision)
        throw new PreparationError(
          'REVISION_CONFLICT',
          '자료가 변경되었습니다. 다시 조회한 뒤 수정해주세요.',
        )
      if (old && (p.revision || 0) <= (old.revision || 0))
        throw new PreparationError('REVISION_CONFLICT', '새 수정 버전이 필요합니다.')
      if (snapshot) {
        snapshot.presentation = p
        for (const list of s.setlists.filter((x) => x.items.some((i) => i.presentationId === p.id)))
          touch(list)
      } else s.library = s.library.filter((x) => x.id !== p.id).concat(p)
      // Background preparation does not become the operator's startup draft.
      if (s.draft?.id === p.id) s.draft = p
    })
    return structuredClone(p)
  }
  async setPreparedPlaylist(raw: unknown, expected: unknown): Promise<void> {
    const refs = PlaylistRefsSchema.parse(raw)
    const before = PlaylistRefsSchema.parse(expected)
    await this.transaction((s) => {
      if (JSON.stringify(s.playlist) !== JSON.stringify(before))
        throw new PreparationError(
          'REVISION_CONFLICT',
          '진행 순서가 변경되었습니다. 다시 조회해주세요.',
        )
      replaceOrder(s, refs)
    })
  }
  async delete(id: string): Promise<Presentation[]> {
    Id.parse(id)
    await this.transaction((s) => {
      const presentation = s.library.find((p) => p.id === id)
      if (presentation) {
        s.deletedLibrary = s.deletedLibrary.filter((x) => x.presentation.id !== id)
        s.deletedLibrary.push({ deletedAt: new Date().toISOString(), presentation })
      }
      s.library = s.library.filter((p) => p.id !== id)
      if (s.draft?.id === id) s.draft = null
    })
    return this.library()
  }
  async restoreDeleted(kind: 'library' | 'media', id: string) {
    Id.parse(id)
    await this.transaction((s) => {
      if (kind === 'library') {
        const entry = s.deletedLibrary.find((x) => x.presentation.id === id)
        if (!entry) throw new Error('복원할 찬양을 찾지 못했습니다.')
        if (s.library.some((x) => x.id === id))
          throw new Error(
            '같은 ID의 찬양이 있습니다. 현재 자료를 보존하기 위해 복원을 중단했습니다.',
          )
        this.assertAssets(entry.presentation)
        s.library.push(entry.presentation)
        s.deletedLibrary = s.deletedLibrary.filter((x) => x !== entry)
      } else {
        const entry = s.deletedMedia.find((x) => x.media.id === id)
        if (!entry) throw new Error('복원할 미디어를 찾지 못했습니다.')
        if (s.media.some((x) => x.id === id)) throw new Error('이미 같은 미디어가 있습니다.')
        this.assertAssets(entry.media)
        s.media.push(entry.media)
        s.deletedMedia = s.deletedMedia.filter((x) => x !== entry)
      }
    })
  }
  async setPlaylist(raw: unknown): Promise<void> {
    const refs = PlaylistRefsSchema.parse(raw)
    await this.transaction((s) => {
      replaceOrder(s, refs)
    })
  }
  assetURL(asset: AssetRecord): string {
    return `media://asset/${asset.id}/${encodeURIComponent(asset.name.replace(/[/?#]/g, '_'))}`
  }
  async assetPath(url: string): Promise<string> {
    const u = new URL(url)
    if (u.protocol !== 'media:' || u.hostname !== 'asset')
      throw new Error('등록되지 않은 미디어입니다.')
    const asset = this.state.assets.find((a) => a.id === u.pathname.split('/')[1])
    if (!asset) throw new Error('등록되지 않은 미디어입니다.')
    const filename = path.join(this.mediaDir, asset.filename),
      actual = await fs.realpath(filename),
      root = await fs.realpath(this.mediaDir)
    if (!actual.startsWith(root + path.sep)) throw new Error('허용되지 않은 미디어입니다.')
    return actual
  }
  assertAssets(data: unknown): void {
    for (const url of mediaURLs(data)) {
      const parsed = new URL(url),
        id = parsed.pathname.split('/')[1]
      if (
        parsed.protocol !== 'media:' ||
        parsed.hostname !== 'asset' ||
        !this.state.assets.some((a) => a.id === id)
      )
        throw new Error('미디어를 먼저 등록하거나 포함된 프로젝트로 불러와주세요.')
    }
  }
  async register(filename: string): Promise<AssetRecord> {
    const extension = path.extname(filename).toLowerCase(),
      record = Asset.parse({
        id: randomUUID(),
        name: path.basename(filename),
        type: mediaKind(filename),
        extension,
        filename: 'pending.png',
      })
    if (extension === '.pdf') throw new Error('PDF 추가를 사용해주세요.')
    const info = await fs.stat(filename)
    if (!info.isFile() || info.size > MAX_FILE_BYTES / 2)
      throw new Error('미디어는 100MB 이하의 지원 파일을 선택해주세요.')
    record.filename = record.id + extension
    await fs.mkdir(this.mediaDir, { recursive: true })
    const destination = path.join(this.mediaDir, record.filename)
    await fs.copyFile(filename, destination, fs.constants.COPYFILE_EXCL)
    try {
      await this.transaction((s) => {
        s.assets.push(record)
        s.media.push({
          id: record.id,
          type: record.type as 'image' | 'video' | 'audio',
          url: this.assetURL(record),
          name: record.name,
        })
      })
    } catch (e) {
      await fs.rm(destination, { force: true })
      throw e
    }
    return record
  }
  async setMedia(raw: unknown): Promise<void> {
    const media = z.array(MediaSchema).max(10000).parse(raw)
    this.assertAssets(media)
    await this.transaction((s) => {
      for (const item of s.media.filter(
        (item) => !media.some((m) => m.id === item.id || m.url === item.url),
      )) {
        s.deletedMedia = s.deletedMedia.filter((x) => x.media.id !== item.id)
        s.deletedMedia.push({ deletedAt: new Date().toISOString(), media: item })
      }
      s.deletedMedia = s.deletedMedia.filter(
        (x) => !media.some((m) => m.id === x.media.id || m.url === x.media.url),
      )
      s.media = media
    })
  }
  private async migrateLegacyMedia(
    presentations: Presentation[] = this.state.library as Presentation[],
    assets: AssetRecord[] = this.state.assets,
    media: MediaItem[] = this.state.media,
    created: string[] = [],
  ): Promise<Presentation[]> {
    let migrated = presentations
    for (const url of mediaURLs(presentations).filter((url) => url.startsWith('file://'))) {
      // Legacy versions inserted raw paths; a literal # belongs to the filename.
      const filename = decodeURIComponent(url.replace(/^file:\/+/, '/'))
      const asset = Asset.parse({
        id: randomUUID(),
        name: path.basename(filename),
        type: mediaKind(filename),
        extension: path.extname(filename).toLowerCase(),
        filename: 'pending.png',
      })
      asset.filename = asset.id + asset.extension
      let copied = false
      if (path.resolve(filename).startsWith(path.resolve(this.mediaDir) + path.sep)) {
        try {
          const actual = await fs.realpath(filename),
            root = await fs.realpath(this.mediaDir),
            info = await fs.stat(actual)
          if (
            actual.startsWith(root + path.sep) &&
            info.isFile() &&
            info.size <= MAX_FILE_BYTES / 2
          ) {
            const destination = path.join(this.mediaDir, asset.filename)
            await fs.copyFile(actual, destination, fs.constants.COPYFILE_EXCL)
            created.push(destination)
            copied = true
          }
        } catch {
          /* Keep a registered placeholder; outside files need an explicit selection grant. */
        }
      }
      assets.push(asset)
      media.push({
        id: asset.id,
        type: asset.type as 'image' | 'video' | 'audio',
        name: asset.name,
        url: this.assetURL(asset),
      })
      migrated = replaceMediaURL(migrated, url, this.assetURL(asset))
      if (!copied)
        this.warnings.push(
          '일부 기존 미디어를 다시 연결해야 합니다. 설정의 누락 미디어 다시 연결을 사용해주세요.',
        )
    }
    return migrated
  }
  async manageSetlist(raw: unknown): Promise<SetlistWorkspace> {
    const cmd = SetlistCommandSchema.parse(raw)
    await this.transaction((s) => {
      const active = s.setlists.find((x) => x.id === s.activeSetlistId)
      if (cmd.operation === 'create') {
        if (
          s.activeSetlistId !== cmd.expectedActiveId ||
          (active?.revision ?? null) !== cmd.expectedRevision
        )
          throw new Error('현재 콘티가 변경되었습니다. 다시 확인해주세요.')
        const refs = cmd.fromCurrent
          ? s.playlist.map((item) => ({ ...item, id: randomUUID() }))
          : []
        const target = newSetlist(s, cmd.title, cmd.date)
        replaceOrder(s, refs)
        if (cmd.fromCurrent && active) copyServicePlan(s, active, target)
        return
      }
      const list = s.setlists.find((x) => x.id === cmd.id)
      if (!list || list.revision !== cmd.expectedRevision)
        throw new Error('콘티가 변경되었습니다. 보관함을 다시 확인해주세요.')
      if (list.deletedAt && cmd.operation !== 'restore')
        throw new Error('휴지통의 콘티를 먼저 복원해주세요.')
      if (cmd.operation === 'open') {
        if (s.activeSetlistId !== cmd.expectedActiveId)
          throw new Error('현재 콘티가 변경되었습니다. 다시 확인해주세요.')
        s.activeSetlistId = list.id
        s.playlist = clone(list.items)
        list.lastOpenedAt = new Date().toISOString()
      } else if (cmd.operation === 'duplicate') {
        const target = newSetlist(s, cmd.title, cmd.date ?? list.date)
        replaceOrder(
          s,
          list.items.map((item) => ({ ...item, id: randomUUID() })),
        )
        copyServicePlan(s, list, target)
      } else if (cmd.operation === 'rename') {
        list.title = cmd.title
        list.date = cmd.date
        touch(list)
      } else if (cmd.operation === 'delete') {
        list.deletedAt = new Date().toISOString()
        touch(list)
        if (s.activeSetlistId === list.id) {
          s.activeSetlistId = null
          s.playlist = []
        }
      } else {
        delete list.deletedAt
        touch(list)
      }
    })
    return this.workspace()
  }
  async publishSetlistSong(
    id: string,
    expectedSongRevision: number,
    expectedSourceRevision: number | null,
  ): Promise<void> {
    await this.transaction((s) => {
      const song = s.setlistSongs.find((x) => x.presentation.id === id)
      if (!song || (song.presentation.revision || 0) !== expectedSongRevision)
        throw new Error('콘티의 곡이 변경되었습니다. 다시 확인해주세요.')
      const original = s.library.find((x) => x.id === song.sourcePresentationId)
      if ((original?.revision ?? null) !== expectedSourceRevision)
        throw new Error('찬양 목록의 원곡이 변경되었습니다. 다시 확인해주세요.')
      const p = clone(song.presentation),
        now = new Date().toISOString()
      p.id = original?.id || randomUUID()
      p.createdAt = original?.createdAt || now
      p.updatedAt = now
      p.revision = Math.max(Date.now(), (original?.revision || 0) + 1)
      s.library = s.library.filter((x) => x.id !== p.id).concat(p)
      song.sourcePresentationId = p.id
      song.sourceRevision = p.revision
      // If the original is open, keep its draft and live view separate until the operator selects it again.
    })
  }
  async exportPlaylist(expected: unknown): Promise<string> {
    await this.settled()
    const refs = PlaylistRefsSchema.parse(expected)
    if (JSON.stringify(refs) !== JSON.stringify(this.state.playlist))
      throw new Error('진행 순서가 변경되었습니다. 다시 시도해주세요.')
    if (!refs.length) throw new Error('저장할 곡을 플레이리스트에 추가해주세요.')
    const ids = new Set(refs.map((item) => item.presentationId))
    const presentations = this.state.setlistSongs
      .filter((p) => ids.has(p.presentation.id))
      .map((p) => p.presentation)
    this.assertAssets(presentations)
    return this.exportProject(
      JSON.stringify({
        format: 'propre-project',
        schemaVersion: 1,
        kind: 'playlist',
        playlistName: this.state.setlists.find((x) => x.id === this.state.activeSetlistId)?.title,
        playlistDate: this.state.setlists.find((x) => x.id === this.state.activeSetlistId)?.date,
        presentations,
        playlist: refs,
        assets: [],
      }),
    )
  }
  async exportService(setlistId: string, expectedRevision: number): Promise<string> {
    Id.parse(setlistId)
    await this.settled()
    const list = this.state.setlists.find((entry) => entry.id === setlistId && !entry.deletedAt)
    if (!list?.servicePlan || list.revision !== expectedRevision)
      throw new Error('예배 내용이 변경되었습니다. 다시 확인해주세요.')
    const songIds = new Set(list.items.map((row) => row.presentationId))
    const presentationIds = new Set(
      list.servicePlan.items.flatMap((cue) =>
        cue.binding?.kind === 'presentation' ? [cue.binding.presentationId] : [],
      ),
    )
    const resourceIds = new Set(
      list.servicePlan.items.flatMap((cue) =>
        cue.binding?.kind === 'resource' ? [cue.binding.resourceId] : [],
      ),
    )
    const bundle = clone({
      format: 'propre-project',
      schemaVersion: 4,
      kind: 'service',
      presentations: [],
      setlists: [list],
      setlistSongs: this.state.setlistSongs
        .filter((song) => songIds.has(song.presentation.id))
        .map((song) => ({ presentation: song.presentation })),
      cuePresentations: this.state.cuePresentations.filter(
        (entry) => entry.ownerSetlistId === list.id && presentationIds.has(entry.presentation.id),
      ),
      cueResources: this.state.cueResources.filter(
        (entry) => entry.ownerSetlistId === list.id && resourceIds.has(entry.resource.id),
      ),
      activeSetlistId: list.id,
      playlist: list.items,
      assets: [] as unknown[],
    })
    this.assertAssets(bundle)
    const ids = new Set(mediaURLs(bundle).map((url) => new URL(url).pathname.split('/')[1]))
    for (const entry of bundle.cueResources)
      if (entry.resource.kind === 'pdf') ids.add(entry.resource.assetId)
    let bytes = Buffer.byteLength(JSON.stringify(bundle))
    for (const id of ids) {
      const asset = this.state.assets.find((entry) => entry.id === id)
      if (!asset) throw new Error('예배에 필요한 파일을 찾지 못했습니다.')
      const content = await fs.readFile(await this.assetPath(this.assetURL(asset)))
      bytes += Math.ceil((content.length * 4) / 3)
      if (bytes > MAX_FILE_BYTES)
        throw new Error('예배 파일이 200MB를 초과합니다. 자료를 나누어주세요.')
      bundle.assets.push({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        extension: asset.extension,
        sha256: createHash('sha256').update(content).digest('hex'),
        data: content.toString('base64'),
      })
    }
    const result = JSON.stringify(bundle)
    parseProject(result)
    if (Buffer.byteLength(result) > MAX_FILE_BYTES)
      throw new Error('예배 파일이 200MB를 초과합니다.')
    if (this.state.setlists.find((entry) => entry.id === setlistId)?.revision !== expectedRevision)
      throw new Error('저장 중 예배 내용이 바뀌었습니다. 다시 시도해주세요.')
    return result
  }
  async exportProject(data: string | undefined): Promise<string> {
    const project = data ? parseProject(data) : null
    if (project?.portable?.kind === 'service') throw new Error('예배 전용 저장을 사용해주세요.')
    if (project?.portable?.kind === 'service-template')
      throw new Error('템플릿 전용 저장을 사용해주세요.')
    const presentations = project?.presentations || this.library()
    const bundle = {
      format: 'propre-project',
      schemaVersion: data ? 1 : 4,
      kind: project?.portable?.kind === 'playlist' ? 'playlist' : data ? 'presentation' : 'backup',
      ...(project?.portable?.kind === 'playlist'
        ? {
            playlist: project.portable.playlist,
            playlistName: project.portable.playlistName,
            playlistDate: project.portable.playlistDate,
          }
        : {}),
      presentations,
      ...(!data
        ? {
            playlist: this.state.playlist,
            setlists: this.state.setlists,
            setlistSongs: this.state.setlistSongs,
            activeSetlistId: this.state.activeSetlistId,
            settings: this.state.settings,
            media: this.state.media,
            deletedLibrary: this.state.deletedLibrary,
            deletedMedia: this.state.deletedMedia,
            outputResources: this.state.outputResources,
            cuePresentations: this.state.cuePresentations,
            cueResources: this.state.cueResources,
            serviceTemplates: this.state.serviceTemplates,
            draft: this.state.draft,
          }
        : {}),
      assets: [] as unknown[],
    }
    const serialized = JSON.stringify(bundle)
    const ids = data
      ? new Set(mediaURLs(presentations).map((url) => new URL(url).pathname.split('/')[1]))
      : new Set(this.state.assets.map((a) => a.id))
    let bytes = Buffer.byteLength(serialized)
    for (const asset of this.state.assets.filter((a) => ids.has(a.id))) {
      const content = await fs.readFile(await this.assetPath(this.assetURL(asset)))
      bytes += Math.ceil((content.length * 4) / 3)
      if (bytes > MAX_FILE_BYTES)
        throw new Error('미디어를 포함한 백업이 200MB를 초과합니다. 자료를 나누어 내보내주세요.')
      bundle.assets.push({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        extension: asset.extension,
        sha256: createHash('sha256').update(content).digest('hex'),
        data: content.toString('base64'),
      })
    }
    const result = JSON.stringify(bundle)
    if (Buffer.byteLength(result) > MAX_FILE_BYTES) throw new Error('파일이 200MB를 초과합니다.')
    return result
  }
  async importProject(
    data: string,
    restore = false,
    expectedPlaylist?: unknown,
    appendPlaylist = false,
    serviceTarget?: ServiceFileTarget,
    templateImport = false,
  ): Promise<{
    presentations: Presentation[]
    restored: boolean
    added?: number
    reused?: number
  }> {
    const parsed = parseProject(data)
    if (
      templateImport
        ? parsed.portable?.kind !== 'service-template'
        : parsed.portable?.kind === 'service-template'
    )
      throw new Error('템플릿 파일의 불러오기 버튼을 사용해주세요.')
    if (serviceTarget) ServiceFileTargetSchema.parse(serviceTarget)
    if (serviceTarget ? parsed.portable?.kind !== 'service' : parsed.portable?.kind === 'service')
      throw new Error('예배 파일의 불러오기 버튼을 사용해주세요.')
    if (restore && parsed.portable?.kind !== 'backup')
      throw new Error('전체 백업 파일을 선택해주세요.')
    const importingPlaylist = expectedPlaylist !== undefined
    const before = importingPlaylist ? PlaylistRefsSchema.parse(expectedPlaylist) : undefined
    if (
      importingPlaylist
        ? parsed.portable?.kind !== 'playlist'
        : parsed.portable?.kind === 'playlist'
    )
      throw new Error(
        importingPlaylist
          ? '플레이리스트 파일을 선택해주세요.'
          : '플레이리스트의 불러오기 버튼을 사용해주세요.',
      )
    const checkPlaylist = (state: RepositoryState) => {
      if (
        serviceTarget &&
        (state.activeSetlistId !== serviceTarget.activeId ||
          (state.setlists.find((entry) => entry.id === state.activeSetlistId)?.revision ?? null) !==
            serviceTarget.revision)
      )
        throw new Error('현재 예배가 변경되었습니다. 다시 불러와주세요.')
      if (before && JSON.stringify(before) !== JSON.stringify(state.playlist))
        throw new Error('진행 순서가 변경되었습니다. 다시 불러와주세요.')
    }
    checkPlaylist(this.state)
    let added = 0,
      reused = 0
    let portable = parsed.portable
    const created: string[] = [],
      assets: AssetRecord[] = []
    try {
      if (portable) {
        await fs.mkdir(this.mediaDir, { recursive: true })
        for (const entry of portable.assets) {
          const content = Buffer.from(entry.data, 'base64')
          if (
            content.length > MAX_FILE_BYTES / 2 ||
            createHash('sha256').update(content).digest('hex') !== entry.sha256
          )
            throw new Error('미디어 무결성 확인에 실패했습니다.')
          if (importingPlaylist || serviceTarget || templateImport) {
            let identical: AssetRecord | undefined
            for (const asset of [...this.state.assets, ...assets]) {
              if (asset.type !== entry.type || asset.extension !== entry.extension) continue
              const hash = await fs
                .readFile(path.join(this.mediaDir, asset.filename))
                .then((b) => createHash('sha256').update(b).digest('hex'))
                .catch(() => null)
              if (hash === entry.sha256) {
                identical = asset
                break
              }
            }
            if (identical) {
              for (const url of mediaURLs(portable)) {
                if (new URL(url).pathname.split('/')[1] === entry.id)
                  portable = replaceMediaURL(portable, url, this.assetURL(identical))
              }
              if (portable.cueResources)
                portable.cueResources = portable.cueResources.map((owned) => ({
                  ...owned,
                  resource:
                    owned.resource.kind === 'pdf' && owned.resource.assetId === entry.id
                      ? { ...owned.resource, assetId: identical.id }
                      : owned.resource,
                }))
              if (portable.serviceTemplates)
                portable.serviceTemplates = portable.serviceTemplates.map((template) => ({
                  ...template,
                  resources: template.resources.map((resource) =>
                    resource.kind === 'pdf' && resource.assetId === entry.id
                      ? { ...resource, assetId: identical!.id }
                      : resource,
                  ),
                }))
              if (!assets.some((a) => a.id === identical.id)) assets.push(identical)
              continue
            }
          }
          const old = this.state.assets.find((a) => a.id === entry.id)
          let id = entry.id
          if (old) {
            const hash = await fs
              .readFile(path.join(this.mediaDir, old.filename))
              .then((b) => createHash('sha256').update(b).digest('hex'))
              .catch(() => null)
            if (hash === entry.sha256) {
              assets.push(old)
              continue
            }
            id = randomUUID()
            if (!importingPlaylist) {
              for (const url of mediaURLs(portable))
                if (new URL(url).pathname.split('/')[1] === entry.id)
                  portable = replaceMediaURL(
                    portable,
                    url,
                    url.replace(`media://asset/${entry.id}/`, `media://asset/${id}/`),
                  )
            }
          }
          if (id !== entry.id && portable?.cueResources)
            portable.cueResources = portable.cueResources.map((x) => ({
              ...x,
              resource:
                x.resource.kind === 'pdf' && x.resource.assetId === entry.id
                  ? { ...x.resource, assetId: id }
                  : x.resource,
            }))
          if (id !== entry.id && portable?.outputResources)
            portable.outputResources = portable.outputResources.map((r) =>
              r.kind === 'pdf' && r.assetId === entry.id ? { ...r, assetId: id } : r,
            )
          if (id !== entry.id && portable?.serviceTemplates)
            portable.serviceTemplates = portable.serviceTemplates.map((template) => ({
              ...template,
              resources: template.resources.map((resource) =>
                resource.kind === 'pdf' && resource.assetId === entry.id
                  ? { ...resource, assetId: id }
                  : resource,
              ),
            }))
          const asset = Asset.parse({
            id,
            name: entry.name,
            type: entry.type,
            extension: entry.extension,
            filename: id + entry.extension,
          })
          if (importingPlaylist && id !== entry.id) {
            for (const url of mediaURLs(portable)) {
              if (new URL(url).pathname.split('/')[1] === entry.id)
                portable = replaceMediaURL(portable, url, this.assetURL(asset))
            }
          }
          const dest = path.join(this.mediaDir, asset.filename)
          await fs.writeFile(dest, content, { flag: 'wx', mode: 0o600 })
          created.push(dest)
          assets.push(asset)
        }
      }
      let presentations = portable ? parseLibrary(portable.presentations) : parsed.presentations
      if (!portable)
        presentations = await this.migrateLegacyMedia(presentations, assets, [], created)
      const available = new Set([...this.state.assets, ...assets].map((a) => a.id))
      for (const url of mediaURLs(portable || presentations)) {
        const parsedURL = new URL(url)
        if (parsedURL.protocol !== 'media:' || !available.has(parsedURL.pathname.split('/')[1]))
          throw new Error('프로젝트에 필요한 미디어가 빠져 있습니다.')
      }
      await this.transaction((s) => {
        checkPlaylist(s)
        if (serviceTarget && portable) importServiceState(s, portable)
        if (templateImport && portable) {
          if (s.serviceTemplates.length >= 200)
            throw new Error('템플릿은200개까지 보관할 수 있습니다.')
          const template = copyTemplate(portable.serviceTemplates![0])
          if (s.serviceTemplates.some((entry) => entry.name === template.name))
            template.name = (template.name + ' 복사본').slice(0, 100)
          s.serviceTemplates.push(template)
        }
        if (importingPlaylist && portable?.playlist) {
          const mapping = new Map<string, string>()
          const signatures = new Map(s.library.map((p) => [songSignature(p as Presentation), p.id]))
          for (const p of presentations) {
            const signature = songSignature(p)
            let id = signatures.get(signature)
            if (id) reused++
            else {
              id = randomUUID()
              s.library.push({ ...p, id, revision: 0 })
              signatures.set(signature, id)
              added++
            }
            mapping.set(p.id, id)
          }
          if (!appendPlaylist || !s.activeSetlistId) {
            s.activeSetlistId = null
            const list = newSetlist(
              s,
              portable.playlistName || '불러온 콘티',
              portable.playlistDate,
            )
            replaceOrder(
              s,
              portable.playlist.map((item) => ({
                id: randomUUID(),
                presentationId: mapping.get(item.presentationId)!,
              })),
            )
            list.lastOpenedAt = new Date().toISOString()
          } else {
            replaceOrder(s, [
              ...s.playlist,
              ...portable.playlist.map((item) => ({
                id: randomUUID(),
                presentationId: mapping.get(item.presentationId)!,
              })),
            ])
          }
        }
        s.assets = s.assets.concat(assets.filter((a) => !s.assets.some((old) => old.id === a.id)))
        if (!restore)
          s.media = s.media.concat(
            assets
              .filter((a) => a.type !== 'document' && !s.media.some((item) => item.id === a.id))
              .map((asset) => ({
                id: asset.id,
                type: asset.type as 'image' | 'video' | 'audio',
                name: asset.name,
                url: this.assetURL(asset),
              })),
          )
        if (restore && portable) {
          s.library = presentations
          s.setlists = portable.setlists || []
          s.setlistSongs = portable.setlistSongs || []
          s.activeSetlistId = portable.activeSetlistId || null
          if (portable.setlists && portable.setlistSongs) s.playlist = portable.playlist || []
          else
            replaceOrder(
              s,
              (portable.playlist || []).filter((x) =>
                presentations.some((p) => p.id === x.presentationId),
              ),
            )
          s.settings = portable.settings || {}
          s.deletedLibrary = portable.deletedLibrary || []
          s.deletedMedia = portable.deletedMedia || []
          s.media = portable.media || []
          s.outputResources = portable.outputResources || []
          s.cuePresentations = portable.cuePresentations || []
          s.cueResources = portable.cueResources || []
          s.serviceTemplates = portable.serviceTemplates || []
          migrateServicePlans(s)
          s.draft = portable.draft ? parsePresentation(portable.draft) : null
          s.wasOutputActive = false
          s.wasStageActive = false
        }
      }, restore)
      return { presentations, restored: restore, ...(importingPlaylist ? { added, reused } : {}) }
    } catch (e) {
      await Promise.all(created.map((f) => fs.rm(f, { force: true })))
      throw e
    }
  }
  private validateResources(s: RepositoryState) {
    for (const r of [
      ...s.outputResources,
      ...s.cueResources.map((entry) => entry.resource),
      ...s.serviceTemplates.flatMap((template) => template.resources),
    ])
      if (r.kind === 'pdf') {
        if (
          r.lastPreparedPage > r.pageCount ||
          !s.assets.some(
            (a) => a.id === r.assetId && a.type === 'document' && a.extension === '.pdf',
          )
        )
          throw new Error('PDF 자료와 등록 파일이 일치하지 않습니다.')
      }
  }
  private async recoverDeletedOutputResource() {
    await this.settled()
    for (let n = 1; n <= 5; n++) {
      let previous: RepositoryState
      try {
        previous = await this.read(`${this.filename}.bak${n}`)
      } catch {
        continue
      }
      for (const resource of [...previous.outputResources].reverse()) {
        if (resource.deletedAt || this.state.outputResources.some((r) => r.id === resource.id))
          continue
        if (resource.kind === 'pdf') {
          const asset = this.state.assets.find((a) => a.id === resource.assetId)
          if (!asset) continue
          try {
            const bytes = await fs.readFile(await this.assetPath(this.assetURL(asset)))
            if (createHash('sha256').update(bytes).digest('hex') !== resource.sha256) continue
          } catch {
            continue
          }
        }
        await this.transaction((s) => {
          if (s.outputResources.some((r) => r.id === resource.id))
            throw new Error('자료가 변경되었습니다. 다시 확인해주세요.')
          s.outputResources.push({
            ...clone(resource),
            revision: resource.revision + 1,
            updatedAt: new Date().toISOString(),
          })
        })
        return clone(this.state.outputResources)
      }
    }
    throw new Error(
      '최근 저장 복사본에서 되돌릴 자료를 찾지 못했습니다. 전체 백업 또는 원본 파일을 확인해주세요.',
    )
  }
  async manageOutputResource(raw: unknown) {
    const command = ResourceCommand.parse(raw)
    if (command.action === 'recover-deleted') return this.recoverDeletedOutputResource()
    await this.transaction((s) => {
      const now = new Date().toISOString()
      if (command.action === 'create-web') {
        const url = normalizeWebURL(command.url)
        s.outputResources.push({
          id: randomUUID(),
          kind: 'web',
          name: command.name.trim() || new URL(url).hostname,
          url,
          revision: 0,
          createdAt: now,
          updatedAt: now,
        })
      } else {
        const r = s.outputResources.find((x) => x.id === command.id)
        if (!r || r.revision !== command.revision)
          throw new Error('자료가 변경되었습니다. 다시 조회해주세요.')
        if (command.action === 'restore') {
          if (!r.deletedAt) throw new Error('삭제한 자료를 선택해주세요.')
          delete r.deletedAt
          r.revision++
          r.updatedAt = now
        } else if (command.action === 'delete') {
          if (r.deletedAt) throw new Error('이미 삭제한 자료입니다.')
          r.deletedAt = now
          r.revision++
          r.updatedAt = now
        } else if (command.action === 'update-web') {
          if (r.deletedAt) throw new Error('삭제한 자료를 먼저 복원해주세요.')
          if (r.kind !== 'web') throw new Error('웹 자료를 선택해주세요.')
          r.name = command.name.trim()
          r.url = normalizeWebURL(command.url)
          r.revision++
          r.updatedAt = now
        }
      }
    })
    return clone(this.state.outputResources)
  }
  async registerPDF(filename: string, validate?: (data: Buffer) => Promise<number>) {
    const info = await fs.stat(filename)
    if (
      !info.isFile() ||
      info.size > MAX_FILE_BYTES / 2 ||
      path.extname(filename).toLowerCase() !== '.pdf'
    )
      throw new Error('100MiB 이하의 PDF 파일을 선택해주세요.')
    const data = await fs.readFile(filename)
    if (data.length > MAX_FILE_BYTES / 2 || !data.subarray(0, 1024).includes(Buffer.from('%PDF-')))
      throw new Error('PDF 파일 형식을 확인해주세요.')
    let pageCount: number
    try {
      pageCount = validate
        ? await validate(data)
        : (await PDFDocument.load(data, { updateMetadata: false })).getPageCount()
    } catch {
      throw new Error('암호가 없고 손상되지 않은 PDF 파일을 선택해주세요.')
    }
    if (pageCount < 1 || pageCount > 1000) throw new Error('PDF는 1~1,000페이지까지 지원합니다.')
    const id = randomUUID(),
      now = new Date().toISOString()
    const asset = Asset.parse({
      id,
      name: path.basename(filename).slice(0, 200),
      type: 'document',
      extension: '.pdf',
      filename: id + '.pdf',
    })
    const resource = {
      id: randomUUID(),
      kind: 'pdf' as const,
      name: asset.name,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      assetId: id,
      sha256: createHash('sha256').update(data).digest('hex'),
      pageCount,
      lastPreparedPage: 1,
      rotation: 0 as const,
    }
    await fs.mkdir(this.mediaDir, { recursive: true })
    const destination = path.join(this.mediaDir, asset.filename)
    await fs.writeFile(destination, data, { flag: 'wx', mode: 0o600 })
    try {
      await this.transaction((s) => {
        s.assets.push(asset)
        s.outputResources.push(resource)
      })
    } catch (e) {
      await fs.rm(destination, { force: true })
      throw e
    }
    return resource
  }
  async rememberPDF(id: string, revision: number, page: number, rotation: 0 | 90 | 180 | 270) {
    await this.transaction((s) => {
      const r = [...s.outputResources, ...s.cueResources.map((x) => x.resource)].find(
        (x) => x.id === id,
      )
      if (
        !r ||
        r.deletedAt ||
        r.kind !== 'pdf' ||
        r.revision !== revision ||
        page < 1 ||
        page > r.pageCount
      )
        throw new Error('PDF 자료가 변경되었습니다. 다시 준비해주세요.')
      r.lastPreparedPage = page
      r.rotation = rotation
    })
  }
  async cleanup(): Promise<number> {
    const refs = JSON.stringify({
      library: this.state.library,
      deletedLibrary: this.state.deletedLibrary,
      deletedMedia: this.state.deletedMedia,
      setlists: this.state.setlists,
      musicPins: [...this.musicPins],
      setlistSongs: this.state.setlistSongs,
      draft: this.state.draft,
      media: this.state.media,
      outputResources: this.state.outputResources,
      cuePresentations: this.state.cuePresentations,
      cueResources: this.state.cueResources,
      serviceTemplates: this.state.serviceTemplates,
    })
    const unused = this.state.assets.filter(
      (a) =>
        !refs.includes(`media://asset/${a.id}/`) &&
        ![
          ...this.state.outputResources,
          ...this.state.cueResources.map((x) => x.resource),
          ...this.state.serviceTemplates.flatMap((template) => template.resources),
        ].some((r) => r.kind === 'pdf' && r.assetId === a.id),
    )
    // Old snapshots may still reference an asset. Keep it until none of the five checkpoints needs it.
    const backups = await Promise.all(
      Array.from({ length: 5 }, (_, n) =>
        fs.readFile(`${this.filename}.bak${n + 1}`, 'utf8').catch(() => ''),
      ),
    )
    const safe = unused.filter(
      (a) =>
        !backups.some(
          (b) => b.includes(`media://asset/${a.id}/`) || b.includes(`"assetId":"${a.id}"`),
        ),
    )
    await this.transaction((s) => {
      s.assets = s.assets.filter((a) => !safe.some((u) => u.id === a.id))
    })
    for (const asset of safe) await fs.rm(path.join(this.mediaDir, asset.filename), { force: true })
    return safe.length
  }
  async recoverPrevious(): Promise<void> {
    const previous = await this.read(`${this.filename}.bak1`)
    await this.transaction((s) => Object.assign(s, previous), true)
  }
  async relink(
    id: string,
    filename: string,
    validatePDF?: (data: Buffer) => Promise<number>,
  ): Promise<void> {
    const asset = this.state.assets.find((a) => a.id === id)
    if (!asset) throw new Error('미디어가 없습니다.')
    const extension = path.extname(filename).toLowerCase()
    if (extension !== asset.extension) throw new Error('기존 파일과 같은 형식으로 선택해주세요.')
    const info = await fs.stat(filename)
    if (!info.isFile() || info.size > MAX_FILE_BYTES / 2) throw new Error('파일이 너무 큽니다.')
    const data = await fs.readFile(filename)
    if (data.length > MAX_FILE_BYTES / 2) throw new Error('파일이 너무 큽니다.')
    if (asset.type !== 'document') {
      const referenced = [
        ...this.state.setlistSongs.map((entry) => entry.presentation),
        ...this.state.cuePresentations.map((entry) => entry.presentation),
        ...this.state.serviceTemplates.flatMap((template) => template.presentations),
      ].some((presentation) =>
        mediaURLs(presentation).some((url) => new URL(url).pathname.split('/')[1] === id),
      )
      if (referenced) {
        const previous = await fs
          .readFile(path.join(this.mediaDir, asset.filename))
          .catch(() => null)
        if (
          !previous ||
          createHash('sha256').update(previous).digest('hex') !==
            createHash('sha256').update(data).digest('hex')
        )
          throw new Error(
            '예배 사본에서 사용하는 파일입니다. 새 자료로 등록한 뒤 필요한 순서에 연결해주세요.',
          )
      }
      await atomicWrite(path.join(this.mediaDir, asset.filename), data)
      return
    }
    const preserved = [
      ...this.state.cueResources,
      ...this.state.serviceTemplates.flatMap((template) =>
        template.resources.map((resource) => ({ resource })),
      ),
    ].filter((x) => x.resource.kind === 'pdf' && x.resource.assetId === id)
    const hash = createHash('sha256').update(data).digest('hex')
    if (preserved.some((x) => x.resource.kind === 'pdf' && x.resource.sha256 !== hash))
      throw new Error(
        '예배에 보관한 PDF 원본과 다릅니다. 새 PDF로 등록한 뒤 필요한 순서에 연결해주세요.',
      )
    if (!data.subarray(0, 1024).includes(Buffer.from('%PDF-')))
      throw new Error('PDF 파일을 선택해주세요.')
    const pages = validatePDF
      ? await validatePDF(data)
      : (await PDFDocument.load(data)).getPageCount()
    if (pages < 1 || pages > 1000) throw new Error('PDF는 1~1,000페이지까지 지원합니다.')
    const destination = path.join(this.mediaDir, asset.filename),
      previous = await fs.readFile(destination).catch(() => null)
    await atomicWrite(destination, data)
    try {
      await this.transaction((s) => {
        for (const r of s.outputResources)
          if (r.kind === 'pdf' && r.assetId === id) {
            r.sha256 = createHash('sha256').update(data).digest('hex')
            r.pageCount = pages
            r.lastPreparedPage = Math.min(r.lastPreparedPage, pages)
            r.revision++
            r.updatedAt = new Date().toISOString()
          }
      })
    } catch (e) {
      if (previous) await atomicWrite(destination, previous)
      else await fs.rm(destination, { force: true })
      throw e
    }
  }
  async setSettings(raw: unknown): Promise<void> {
    const settings = SettingsSchema.parse(raw)
    await this.transaction((s) => {
      s.settings = settings
    })
  }
}
