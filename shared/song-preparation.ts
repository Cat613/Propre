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
            pages: z.array(z.string().max(5000)).min(1).max(50),
            sourceId: identifier,
            sourcePage: z.number().int().min(1).max(50),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    sequence: z
      .array(z.object({ partId: identifier, repeat: z.number().int().min(1).max(20) }).strict())
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
    formEvidence: z.enum(['explicit', 'inferred']),
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
