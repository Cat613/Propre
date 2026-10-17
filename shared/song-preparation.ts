import { ServicePlanSchema } from './service-plan'
import { z } from 'zod'
import type { Presentation, GlobalSlideStyle } from '../src/types'
import { partLabelColor } from '../src/types'
import { DEFAULT_STYLE, normalizePresentation } from './model'

const identifier = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[\w-]+$/)
export const ProviderSchema = z.enum(['gemini', 'openai', 'claude'])
export type Provider = z.infer<typeof ProviderSchema>
export const ConnectionProfileSchema = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(100),
  provider: ProviderSchema,
  model: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[\w.-]+$/),
})
export type ConnectionProfile = z.infer<typeof ConnectionProfileSchema>
export const SourceSchema = z.object({
  id: identifier,
  name: z.string().max(500),
  mime: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(20 * 1024 * 1024),
  pages: z.number().int().min(1).max(50),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
})
export const SongFormSchema = z
  .object({
    parts: z
      .array(
        z
          .object({
            id: identifier,
            label: z.string().trim().min(1).max(50),
            pages: z
              .array(z.string().max(5000))
              .min(1)
              .max(50)
              .describe(
                '슬라이드별 가사 문자열. 문자열 내부 줄바꿈은 한 슬라이드의 줄이며 원본 페이지가 아닙니다. 간주는 빈 문자열.',
              ),
            sourceId: identifier.describe(
              '이 파트 전체 가사의 근거인 첨부 파일 ID. get_song_job의 sources에 있는 ID를 사용합니다.',
            ),
            sourcePage: z
              .number()
              .int()
              .min(1)
              .max(50)
              .describe(
                '근거인 원본 PDF 페이지 번호, 1부터 시작. 이미지에서는 1. 원본 페이지가 바뀌면 새 파트로 분리합니다.',
              ),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    sequence: z
      .array(
        z
          .object({
            partId: identifier,
            repeat: z
              .number()
              .int()
              .min(1)
              .max(20)
              .describe('해당 파트 전체의 연속 반복 횟수. 반복하지 않으면 1.'),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((form, ctx) => {
    const ids = new Set(form.parts.map((p) => p.id))
    if (ids.size !== form.parts.length || form.sequence.some((s) => !ids.has(s.partId)))
      ctx.addIssue({ code: 'custom', message: '파트 ID와 진행 순서를 확인해주세요.' })
    const count = form.sequence.reduce(
      (n, s) => n + (form.parts.find((p) => p.id === s.partId)?.pages.length || 0) * s.repeat,
      0,
    )
    if (count > 200)
      ctx.addIssue({ code: 'custom', message: '곡당 슬라이드는 200장까지 준비할 수 있습니다.' })
  })
export type SongForm = z.infer<typeof SongFormSchema>
export const SongDraftSchema = z
  .object({
    id: identifier,
    title: z.string().trim().min(1).max(500),
    form: SongFormSchema,
    formEvidence: z
      .enum(['explicit', 'inferred'])
      .describe(
        '전체 진행이 원문 또는 사용자 지시에 명확하면 explicit. 일부라도 추정하면 inferred와 issues에 근거를 기록합니다.',
      ),
    issues: z.array(z.string().min(1).max(500)).max(100),
    confirmed: z.boolean(),
    originalId: identifier.nullable(),
    originalRevision: z.number().int().nonnegative().nullable(),
    updateOriginal: z.boolean(),
  })
  .strict()
export type SongDraft = z.infer<typeof SongDraftSchema>
export const DraftSetSchema = z
  .object({
    songs: z.array(SongDraftSchema).min(1).max(20),
    order: z.array(identifier).min(1).max(1000),
  })
  .strict()
  .superRefine((set, ctx) => {
    const ids = new Set(set.songs.map((s) => s.id))
    if (
      ids.size !== set.songs.length ||
      set.order.some((id) => !ids.has(id)) ||
      set.songs.some((s) => !set.order.includes(s.id))
    ) {
      ctx.addIssue({ code: 'custom', message: '곡 ID와 콘티 순서를 확인해주세요.' })
      return
    }
    if (
      set.order.reduce((n, id) => n + slideCount(set.songs.find((s) => s.id === id)!.form), 0) >
      1000
    )
      ctx.addIssue({ code: 'custom', message: '전체 슬라이드는 1,000장까지 준비할 수 있습니다.' })
  })
export type DraftSet = z.infer<typeof DraftSetSchema>
export const JobSchema = z.object({
  id: identifier,
  requestId: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  profile: ConnectionProfileSchema,
  sources: z.array(SourceSchema).max(20),
  analysisSources: z.array(identifier).max(20).default([]),
  instruction: z.string().max(10000),
  mode: z.enum(['append', 'replace']),
  automatic: z.boolean(),
  keepSources: z.boolean().default(false),
  status: z.enum([
    'queued',
    'analyzing',
    'needs_review',
    'ready',
    'committing',
    'completed',
    'failed',
    'canceled',
    'interrupted',
  ]),
  targetId: identifier.nullable(),
  targetRevision: z.number().int().nonnegative().nullable(),
  libraryVersions: z.record(z.string(), z.number().int().nonnegative()).default({}),
  draftRevision: z.number().int().nonnegative(),
  draft: DraftSetSchema.nullable(),
  style: z.object({}).passthrough(),
  error: z.string().max(1000).optional(),
  usage: z.record(z.string(), z.number()).optional(),
})
export type SongJob = Omit<z.infer<typeof JobSchema>, 'style'> & { style: GlobalSlideStyle }
export const ApplyReceiptSchema = z.object({
  jobId: identifier,
  requestId: z.string().uuid(),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  appliedAt: z.string().datetime(),
  setlistId: identifier,
  finalRevision: z.number().int().nonnegative(),
  priorServicePlan: ServicePlanSchema.optional(),
  priorItems: z.array(z.object({ id: identifier, presentationId: identifier })),
  finalItems: z.array(z.object({ id: identifier, presentationId: identifier })),
  added: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  undoneAt: z.string().datetime().optional(),
})
export type ApplyReceipt = z.infer<typeof ApplyReceiptSchema>
export function slideCount(form: SongForm) {
  return form.sequence.reduce(
    (n, s) => n + form.parts.find((p) => p.id === s.partId)!.pages.length * s.repeat,
    0,
  )
}
export function compileSong(
  draft: SongDraft,
  style = DEFAULT_STYLE,
  id = crypto.randomUUID(),
): Presentation {
  const form = SongFormSchema.parse(draft.form),
    now = new Date().toISOString()
  const slides = form.sequence.flatMap((step, stepIndex) => {
    const part = form.parts.find((p) => p.id === step.partId)!
    return Array.from({ length: step.repeat }, (_, repeatIndex) =>
      part.pages.map((content, page) => ({
        id: crypto.randomUUID(),
        type: 'text' as const,
        content,
        label: `${part.label}${step.repeat > 1 ? ` · ${repeatIndex + 1}/${step.repeat}` : ''}${part.pages.length > 1 ? ` · ${page + 1}/${part.pages.length}` : ''}`,
        labelColor: partLabelColor(part.label),
        borderColor: partLabelColor(part.label),
        songPosition: { partId: part.id, stepIndex, repeatIndex, page },
      })),
    ).flat()
  })
  return normalizePresentation({
    id,
    title: draft.title,
    slides,
    globalSlideStyle: style,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    schemaVersion: 1,
    songForm: form,
  })
}
export function titleKey(title: string) {
  return title
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
}
export const StageSchema = z
  .object({ expectedDraftRevision: z.number().int().nonnegative(), draft: DraftSetSchema })
  .strict()
export const StartJobSchema = z
  .object({
    profileId: identifier,
    instruction: z.string().max(10000),
    mode: z.enum(['append', 'replace']),
    automatic: z.boolean(),
  })
  .strict()
