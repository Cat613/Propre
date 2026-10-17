import { MusicItemsSchema } from './music'
import { ServicePlanSchema, songProjection } from './service-plan'
import { TemplateItemSchema } from './service-template'
import { OutputResourcesSchema, VisualSourceSchema } from './output-resources'
import { z } from 'zod'
import { SongFormSchema } from './song-preparation'
import type { Presentation, Slide, OutputState, StageData } from '../src/types'
import { normalizePresentation, normalizeSlide } from './model'
export const MAX_FILE_BYTES = 200 * 1024 * 1024
export const MAX_STATE_BYTES = 24 * 1024 * 1024
export const Id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/)
const text = z.string().max(100000)
const color = z
  .string()
  .max(80)
  .refine((s) => /^(#[a-fA-F0-9]{3,8}|[a-zA-Z]+|rgba?\([0-9., %]+\))$/.test(s))
const url = z
  .string()
  .max(2048)
  .refine((s) =>
    /^(media:\/\/asset\/[a-zA-Z0-9_-]+\/[^/?#]+|file:\/\/[^\x00]+|data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+)$/.test(
      s,
    ),
  )
const number = z.number().finite()
export const Style = z.object({
  fontSize: z
    .string()
    .regex(/^\d+(\.\d+)?(px|rem|em|%)?$/)
    .max(20)
    .optional(),
  color: color.optional(),
  backgroundColor: color.optional(),
  backgroundDim: number.min(0).max(1).optional(),
  fontWeight: z.string().max(30).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  fontFamily: z.string().max(160).optional(),
  textShadow: z.boolean().optional(),
  textOutline: z.boolean().optional(),
  useCustomStyle: z.boolean().optional(),
})
export const GlobalStyle = z.object({
  fontSize: number.min(5).max(600),
  fontColor: color,
  fontFamily: z.string().max(160),
  align: z.enum(['left', 'center', 'right']),
  verticalAlign: z.enum(['top', 'center', 'bottom']),
  lineHeight: number.min(0.5).max(4).optional(),
  backgroundDim: number.min(0).max(1).optional(),
  offsetX: number.min(-8000).max(8000).optional(),
  offsetY: number.min(-8000).max(8000).optional(),
  bibleRefFontSize: number.min(5).max(600).optional(),
  bibleRefFontColor: color.optional(),
  bibleRefFontFamily: z.string().max(160).optional(),
  bibleRefPosition: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
  bibleRefOffsetX: number.min(-8000).max(8000).optional(),
  bibleRefOffsetY: number.min(-8000).max(8000).optional(),
})
const base = {
  id: Id,
  x: number.min(-16000).max(16000),
  y: number.min(-16000).max(16000),
  width: number.positive().max(16000),
  height: number.positive().max(16000),
  zIndex: number.int().min(-10000).max(10000),
  coordinateUnit: z.enum(['percent', 'pixel']).optional(),
  opacity: number.min(0).max(1).optional(),
  rotation: number.min(-3600).max(3600).optional(),
}
const Element = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('text'), text, styles: Style.default({}) }),
  z.object({
    ...base,
    type: z.enum(['image', 'video']),
    url,
    objectFit: z.enum(['contain', 'cover', 'fill']).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('shape'),
    shapeType: z.enum(['rectangle', 'ellipse', 'line']),
    backgroundColor: color.optional(),
    borderColor: color.optional(),
    borderWidth: number.min(0).max(100).optional(),
  }),
])
function uniqueIds(items: { id: string }[]): boolean {
  return new Set(items.map((x) => x.id)).size === items.length
}
export const SlideSchema = z.object({
  songPosition: z
    .object({
      partId: Id,
      stepIndex: z.number().int().nonnegative(),
      repeatIndex: z.number().int().nonnegative(),
      page: z.number().int().nonnegative(),
    })
    .optional(),
  id: Id,
  type: z.enum(['text', 'image', 'video', 'bible']),
  label: z.string().max(100).optional(),
  labelColor: color.optional(),
  borderColor: color.optional(),
  bibleReference: z.string().max(200).optional(),
  content: text.optional(),
  styles: Style.optional(),
  backgroundUrl: url.optional(),
  elements: z.array(Element).max(500).refine(uniqueIds, 'Duplicate element IDs').optional(),
  canvasWidth: number.min(100).max(16000).optional(),
  canvasHeight: number.min(100).max(16000).optional(),
})
export const PresentationSchema = z.object({
  songForm: SongFormSchema.optional(),
  schemaVersion: z.literal(1).optional(),
  id: Id,
  title: z.string().max(500),
  slides: z.array(SlideSchema).max(3000).refine(uniqueIds, 'Duplicate slide IDs'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: number.int().nonnegative().optional(),
  globalSlideStyle: GlobalStyle.optional(),
})
export const LibrarySchema = z
  .array(PresentationSchema)
  .max(5000)
  .refine(uniqueIds, 'Duplicate presentation IDs')
export const PlaylistRefsSchema = z
  .array(z.object({ id: Id, presentationId: Id }))
  .max(10000)
  .refine(uniqueIds)
export const SetlistSongSchema = z.object({
  presentation: PresentationSchema,
  sourcePresentationId: Id.optional(),
  sourceRevision: z.number().int().nonnegative().optional(),
})
export const SetlistSchema = z.object({
  id: Id,
  title: z.string().trim().min(1).max(200),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((d) => {
      const date = new Date(d + 'T00:00:00Z')
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === d
    })
    .optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastOpenedAt: z.string().datetime().optional(),
  revision: z.number().int().nonnegative(),
  items: PlaylistRefsSchema,
  servicePlan: ServicePlanSchema.optional(),
  music: MusicItemsSchema.optional(),
  deletedAt: z.string().datetime().optional(),
})
export const SetlistsSchema = z
  .array(SetlistSchema)
  .max(1000)
  .refine((xs) => new Set(xs.map((x) => x.id)).size === xs.length)
export const SetlistSongsSchema = z
  .array(SetlistSongSchema)
  .max(5000)
  .refine((xs) => new Set(xs.map((x) => x.presentation.id)).size === xs.length)
export const CuePresentationsSchema = z
  .array(
    z.object({
      ownerSetlistId: Id,
      presentation: PresentationSchema,
    }),
  )
  .max(10000)
  .refine((xs) => uniqueIds(xs.map((x) => x.presentation)))
export const CueResourcesSchema = z
  .array(
    z.object({
      ownerSetlistId: Id,
      resource: OutputResourcesSchema.element,
    }),
  )
  .max(10000)
  .refine((xs) => uniqueIds(xs.map((x) => x.resource)))
export const ServiceTemplateSchema = z
  .object({
    id: Id,
    revision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).default(''),
    timezone: ServicePlanSchema.shape.timezone,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    deletedAt: z.string().datetime().optional(),
    lastUsedAt: z.string().datetime().optional(),
    items: z.array(TemplateItemSchema).max(1000),
    presentations: LibrarySchema.max(1000),
    resources: OutputResourcesSchema.max(1000),
    music: MusicItemsSchema.optional(),
  })
  .strict()
  .superRefine((template, context) => {
    const presentationIds = new Set<string>(),
      resourceIds = new Set<string>()
    if (new Set(template.items.map((item) => item.id)).size !== template.items.length)
      context.addIssue({ code: 'custom', message: '중복 템플릿 순서입니다.' })
    for (const item of template.items) {
      const binding = item.binding
      if (binding?.kind === 'presentation') {
        const p = template.presentations.find((p) => p.id === binding.presentationId)
        if (!p?.slides.some((slide) => slide.id === binding.slideId))
          context.addIssue({ code: 'custom', message: '고정 슬라이드가 없습니다.' })
        if (item.kind === 'song' && p?.slides[0]?.id !== binding.slideId)
          context.addIssue({ code: 'custom', message: '고정 찬양은 첫 슬라이드부터 연결해주세요.' })
        presentationIds.add(binding.presentationId)
      } else if (binding?.kind === 'resource') {
        const r = template.resources.find((r) => r.id === binding.resourceId)
        if (
          !r ||
          r.deletedAt ||
          (r.kind === 'pdf'
            ? !binding.page || binding.page > r.pageCount
            : binding.page !== undefined || binding.rotation !== undefined)
        )
          context.addIssue({ code: 'custom', message: '고정 외부 자료를 확인해주세요.' })
        resourceIds.add(binding.resourceId)
      }
    }
    if (
      presentationIds.size !== template.presentations.length ||
      resourceIds.size !== template.resources.length
    )
      context.addIssue({ code: 'custom', message: '템플릿에 연결하지 않은 자료가 있습니다.' })
  })
export const ServiceTemplatesSchema = z
  .array(ServiceTemplateSchema)
  .max(200)
  .refine((items) => uniqueIds(items))
const override = z.object({ isVisible: z.boolean() })
export const Look = z.object({
  audio: override,
  background: override,
  slide: override,
  announcement: override,
  prop: override,
  message: override,
})
export const SettingsSchema = z.object({
  interfaceTheme: z.enum(['dark', 'light']).optional(),
  showAudioPlayer: z.boolean().optional(),
  isGreenScreen: z.boolean().optional(),
  screenLooks: z.record(z.enum(['main', 'chroma']), Look).optional(),
  globalStylePresets: z
    .array(z.object({ id: Id, name: z.string().max(100), style: GlobalStyle }))
    .max(100)
    .optional(),
  defaultSongPresetId: Id.nullable().optional(),
  defaultBiblePresetId: Id.nullable().optional(),
  stageCurrentFontSize: number.min(10).max(300).optional(),
  stageNextFontSize: number.min(10).max(300).optional(),
})
export const MediaSchema = z.object({
  id: Id,
  type: z.enum(['image', 'video', 'audio']),
  url,
  name: z.string().max(500),
  thumbnail: url.optional(),
})
export const AudioSchema = z.object({
  id: Id,
  url,
  name: z.string().max(500),
  volume: number.min(0).max(1).optional(),
  loop: z.boolean().optional(),
  playing: z.boolean().optional(),
})
export const PropSchema = z.object({
  id: Id,
  type: z.enum(['image', 'text', 'logo', 'clock', 'timer']),
  content: text.optional(),
  url: url.optional(),
  position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center', 'custom']),
  customX: number.min(0).max(100).optional(),
  customY: number.min(0).max(100).optional(),
  scale: number.min(0.05).max(10).optional(),
  isVisible: z.boolean().optional(),
})
export const OutputSchema = z.object({
  type: z.literal('state-update'),
  source: VisualSourceSchema.optional(),
  isGreenScreen: z.boolean().optional(),
  globalSlideStyle: GlobalStyle.optional(),
  layers: z.object({
    audio: AudioSchema.nullable(),
    background: z.object({ type: z.enum(['image', 'video', 'none']), url: url.optional() }),
    slide: SlideSchema.nullable(),
    announcement: SlideSchema.nullable(),
    props: z.array(PropSchema).max(100),
    message: z
      .object({
        id: Id,
        content: text,
        isScrolling: z.boolean(),
        speed: number.min(1).max(200).optional(),
      })
      .nullable(),
  }),
})
export const StageSchema = z.object({
  source: VisualSourceSchema.optional(),
  current: SlideSchema.nullable(),
  next: SlideSchema.nullable(),
  globalSlideStyle: GlobalStyle.optional(),
  settings: z
    .object({ currentFontSize: number.min(10).max(300), nextFontSize: number.min(10).max(300) })
    .optional(),
})
export function boundedJSON(data: string, max = MAX_STATE_BYTES): unknown {
  if (new TextEncoder().encode(data).byteLength > max)
    throw new Error('자료가 허용 크기를 초과합니다.')
  return JSON.parse(data)
}
export function parsePresentation(value: unknown): Presentation {
  return normalizePresentation(PresentationSchema.parse(value) as Presentation)
}
export function parseLibrary(value: unknown): Presentation[] {
  return LibrarySchema.parse(value).map((p) => normalizePresentation(p as Presentation))
}
export function parseSlide(value: unknown): Slide {
  return normalizeSlide(SlideSchema.parse(value) as Slide)
}
export function parseOutput(value: unknown): OutputState {
  return OutputSchema.parse(value) as OutputState
}
export function parseStage(value: unknown): StageData {
  return StageSchema.parse(value) as StageData
}
export const PortableAsset = z.object({
  id: Id,
  name: z.string().max(500),
  type: z.enum(['image', 'video', 'audio', 'document']),
  extension: z
    .string()
    .regex(/^\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v|mp3|wav|ogg|m4a|aac|flac|pdf)$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  data: z
    .string()
    .max((MAX_FILE_BYTES * 4) / 3)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
})
export const DeletedLibrarySchema = z
  .array(
    z.object({
      deletedAt: z.string().datetime(),
      presentation: PresentationSchema,
    }),
  )
  .max(5000)
  .refine((xs) => uniqueIds(xs.map((x) => x.presentation)))
export const DeletedMediaSchema = z
  .array(
    z.object({
      deletedAt: z.string().datetime(),
      media: MediaSchema,
    }),
  )
  .max(10000)
  .refine((xs) => uniqueIds(xs.map((x) => x.media)))
export const PortableSchema = z.object({
  serviceTemplates: ServiceTemplatesSchema.optional(),
  format: z.literal('propre-project'),
  deletedLibrary: DeletedLibrarySchema.optional(),
  deletedMedia: DeletedMediaSchema.optional(),
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  cuePresentations: CuePresentationsSchema.optional(),
  cueResources: CueResourcesSchema.optional(),
  outputResources: OutputResourcesSchema.optional(),
  kind: z.enum(['presentation', 'backup', 'playlist', 'service', 'service-template']),
  playlistName: z.string().trim().min(1).max(200).optional(),
  playlistDate: SetlistSchema.shape.date,
  setlists: SetlistsSchema.optional(),
  setlistSongs: SetlistSongsSchema.optional(),
  activeSetlistId: Id.nullable().optional(),
  presentations: LibrarySchema,
  playlist: PlaylistRefsSchema.optional(),
  settings: SettingsSchema.optional(),
  media: z.array(MediaSchema).max(10000).optional(),
  draft: PresentationSchema.nullable().optional(),
  assets: z.array(PortableAsset).max(10000).default([]),
})
export function parseProject(data: string): {
  presentations: Presentation[]
  portable?: z.infer<typeof PortableSchema>
} {
  const raw = boundedJSON(data, MAX_FILE_BYTES)
  if (!raw || typeof raw !== 'object') throw new Error('프로젝트 형식을 확인해주세요.')
  if ('format' in raw) {
    const portable = PortableSchema.parse(raw)
    if (
      portable.schemaVersion < 4 &&
      (portable.setlists?.some((x) => x.music?.length) ||
        portable.serviceTemplates?.some((x) => x.music?.length))
    )
      throw new Error('음악이 포함된 파일은 새 형식이 필요합니다.')
    if (
      portable.schemaVersion >= 2 &&
      portable.kind !== 'backup' &&
      !(portable.schemaVersion >= 3 && ['service', 'service-template'].includes(portable.kind))
    )
      throw new Error('새 외부 자료 형식은 전체 백업에서만 지원합니다.')
    if (
      portable.schemaVersion === 1 &&
      (portable.outputResources || portable.assets.some((a) => a.type === 'document'))
    )
      throw new Error('PDF 자료는 새 백업 형식이 필요합니다.')
    if (
      portable.schemaVersion < 3 &&
      (portable.serviceTemplates ||
        portable.cuePresentations ||
        portable.cueResources ||
        portable.setlists?.some((list) => list.servicePlan))
    )
      throw new Error('예배 순서는 새 백업 형식이 필요합니다.')
    if (new Set(portable.assets.map((a) => a.id)).size !== portable.assets.length)
      throw new Error('중복 에셋입니다.')
    for (const r of [
      ...(portable.outputResources || []),
      ...(portable.cueResources || []).map((x) => x.resource),
      ...(portable.serviceTemplates || []).flatMap((template) => template.resources),
    ])
      if (
        r.kind === 'pdf' &&
        !portable.assets.some(
          (a) =>
            a.id === r.assetId &&
            a.type === 'document' &&
            a.extension === '.pdf' &&
            a.sha256 === r.sha256,
        )
      )
        throw new Error('PDF 백업 참조가 일치하지 않습니다.')
    if (portable.kind === 'service') {
      const list = portable.setlists?.[0]
      if (
        portable.schemaVersion < 3 ||
        portable.setlists?.length !== 1 ||
        !list?.servicePlan ||
        list.deletedAt ||
        portable.activeSetlistId !== list.id ||
        portable.presentations.length ||
        portable.settings ||
        portable.media ||
        portable.draft ||
        portable.deletedLibrary ||
        portable.deletedMedia ||
        portable.outputResources ||
        portable.serviceTemplates
      )
        throw new Error('예배 파일에는 한 예배의 순서와 자료만 포함할 수 있습니다.')
      if (
        JSON.stringify(portable.playlist) !== JSON.stringify(list.items) ||
        JSON.stringify(songProjection(list.servicePlan, list.items)) !== JSON.stringify(list.items)
      )
        throw new Error('예배 파일의 곡 순서가 일치하지 않습니다.')
      const songIds = new Set(list.items.map((item) => item.presentationId))
      const songs = portable.setlistSongs || []
      if (songs.length !== songIds.size || songs.some((song) => !songIds.has(song.presentation.id)))
        throw new Error('예배 파일의 찬양 사본을 확인해주세요.')
      const presentations = portable.cuePresentations || [],
        resources = portable.cueResources || []
      const presentationIds = new Set<string>(),
        resourceIds = new Set<string>()
      for (const cue of list.servicePlan.items) {
        if (cue.binding?.kind === 'presentation') {
          const binding = cue.binding
          const p = presentations.find(
            (entry) =>
              entry.presentation.id === binding.presentationId && entry.ownerSetlistId === list.id,
          )?.presentation
          if (!p || !p.slides.some((slide) => slide.id === binding.slideId))
            throw new Error('예배 파일에 연결한 슬라이드가 없습니다.')
          presentationIds.add(p.id)
        } else if (cue.binding?.kind === 'resource') {
          const binding = cue.binding
          const r = resources.find(
            (entry) => entry.resource.id === binding.resourceId && entry.ownerSetlistId === list.id,
          )?.resource
          if (
            !r ||
            r.deletedAt ||
            (r.kind === 'pdf'
              ? !binding.page || binding.page > r.pageCount
              : binding.page !== undefined || binding.rotation !== undefined)
          )
            throw new Error('예배 파일의 외부 자료를 확인해주세요.')
          resourceIds.add(r.id)
        }
      }
      if (
        presentations.length !== presentationIds.size ||
        resources.length !== resourceIds.size ||
        presentations.some((entry) => !presentationIds.has(entry.presentation.id)) ||
        resources.some((entry) => !resourceIds.has(entry.resource.id)) ||
        presentations.some((entry) => songIds.has(entry.presentation.id))
      )
        throw new Error('예배에 연결하지 않은 자료가 포함되어 있습니다.')
      const usedAssets = new Set<string>()
      const visit = (value: unknown) => {
        if (!value || typeof value !== 'object') return
        for (const [key, child] of Object.entries(value)) {
          if (
            ['url', 'backgroundUrl', 'thumbnail'].includes(key) &&
            typeof child === 'string' &&
            child.startsWith('media://asset/')
          )
            usedAssets.add(new URL(child).pathname.split('/')[1])
          else if (child && typeof child === 'object') visit(child)
        }
      }
      visit(list.music)
      visit(songs)
      visit(presentations)
      for (const entry of resources)
        if (entry.resource.kind === 'pdf') usedAssets.add(entry.resource.assetId)
      if (
        portable.assets.length !== usedAssets.size ||
        portable.assets.some((asset) => !usedAssets.has(asset.id))
      )
        throw new Error('예배에 사용하지 않는 파일이 포함되어 있습니다.')
    }
    if (portable.kind === 'service-template') {
      if (
        portable.schemaVersion < 3 ||
        portable.serviceTemplates?.length !== 1 ||
        portable.serviceTemplates[0].deletedAt ||
        portable.presentations.length ||
        portable.setlists ||
        portable.setlistSongs ||
        portable.playlist ||
        portable.activeSetlistId ||
        portable.settings ||
        portable.media ||
        portable.draft ||
        portable.deletedLibrary ||
        portable.deletedMedia ||
        portable.outputResources ||
        portable.cuePresentations ||
        portable.cueResources
      )
        throw new Error('템플릿 파일에는 한 템플릿의 순서와 자료만 포함할 수 있습니다.')
      const template = portable.serviceTemplates[0],
        assetIds = new Set<string>()
      const visit = (value: unknown) => {
        if (!value || typeof value !== 'object') return
        for (const [key, child] of Object.entries(value)) {
          if (
            ['url', 'backgroundUrl', 'thumbnail'].includes(key) &&
            typeof child === 'string' &&
            child.startsWith('media://asset/')
          )
            assetIds.add(new URL(child).pathname.split('/')[1])
          else if (child && typeof child === 'object') visit(child)
        }
      }
      visit(template.music)
      visit(template.presentations)
      for (const r of template.resources) if (r.kind === 'pdf') assetIds.add(r.assetId)
      if (
        assetIds.size !== portable.assets.length ||
        portable.assets.some((asset) => !assetIds.has(asset.id))
      )
        throw new Error('템플릿 파일의 참조 assets를 확인해주세요.')
    }
    if (portable.kind === 'playlist') {
      const ids = new Set(portable.presentations.map((p) => p.id))
      if (!portable.playlist || portable.playlist.some((item) => !ids.has(item.presentationId)))
        throw new Error('플레이리스트에 필요한 곡이 빠져 있습니다.')
      const referenced = new Set(portable.playlist.map((item) => item.presentationId))
      if (portable.presentations.some((p) => !referenced.has(p.id)))
        throw new Error('플레이리스트 순서에 없는 곡이 포함되어 있습니다.')
      if (new Set(portable.assets.map((a) => a.id)).size !== portable.assets.length)
        throw new Error('중복된 미디어가 포함되어 있습니다.')
      if (
        portable.settings ||
        portable.media ||
        portable.draft ||
        portable.setlists ||
        portable.setlistSongs ||
        portable.activeSetlistId
      )
        throw new Error('플레이리스트 파일에는 곡과 순서만 포함할 수 있습니다.')
    }
    return { presentations: parseLibrary(portable.presentations), portable }
  }
  if (Array.isArray(raw)) return { presentations: parseLibrary(raw) }
  if ('type' in raw && raw.type === 'library' && 'data' in raw)
    return { presentations: parseLibrary(raw.data) }
  if ('slides' in raw && Array.isArray(raw.slides)) {
    const now = new Date().toISOString()
    return {
      presentations: [
        parsePresentation({
          id: crypto.randomUUID(),
          title: 'title' in raw ? raw.title : '불러온 자료',
          createdAt: now,
          updatedAt: now,
          ...raw,
        }),
      ],
    }
  }
  throw new Error('지원하지 않는 프로젝트 형식입니다.')
}
