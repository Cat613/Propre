import { z } from 'zod'

// Kept independent of workspace schema so it can be embedded there without a cycle.
const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/)
const seconds = z.number().int().min(0).max(86400)
const timezone = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value })
      return true
    } catch {
      return false
    }
  }, '시간대를 확인해주세요.')

export const TimerPresetSchema = z
  .object({
    mode: z.enum(['countdown', 'countup']),
    targetSeconds: seconds.optional(),
    warningSeconds: seconds.default(120),
    autoStart: z.boolean().default(false),
    showOnStage: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.mode === 'countdown' &&
      (!value.targetSeconds || value.warningSeconds > value.targetSeconds)
    )
      context.addIssue({ code: 'custom', message: '남은 시간과 경고 시간을 확인해주세요.' })
    if (
      value.mode === 'countup' &&
      (value.targetSeconds !== undefined || value.warningSeconds !== 0)
    )
      context.addIssue({
        code: 'custom',
        message: '경과 시간에는 목표와 경고 시간을 지정할 수 없습니다.',
      })
  })
export const EnterPolicySchema = z
  .object({
    visual: z.enum(['keep', 'background-only', 'black', 'bound']),
    audio: z.enum(['keep', 'stop']),
  })
  .strict()
export const CueBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('presentation'), presentationId: id, slideId: id }).strict(),
  z
    .object({
      kind: z.literal('resource'),
      resourceId: id,
      page: z.number().int().min(1).max(1000).optional(),
      rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
    })
    .strict(),
])
export const CueItemSchema = z
  .object({
    id,
    kind: z.enum(['song', 'prayer', 'scripture', 'sermon', 'offering', 'announcement', 'custom']),
    title: z.string().trim().min(1).max(200),
    leader: z.string().max(100).optional(),
    durationSeconds: seconds.optional(),
    operatorNote: z.string().max(2000).optional(),
    stageNote: z.string().max(2000).optional(),
    materialPending: z.boolean().optional(),
    musicPreparationId: id.optional(),
    songItemId: id.optional(),
    binding: CueBindingSchema.optional(),
    enter: EnterPolicySchema,
    timer: TimerPresetSchema.optional(),
  })
  .strict()
  .superRefine((cue, context) => {
    if (
      cue.kind === 'song'
        ? !cue.songItemId || cue.binding !== undefined
        : cue.songItemId !== undefined
    )
      context.addIssue({ code: 'custom', message: '찬양 순서의 연결을 확인해주세요.' })
    if (cue.kind === 'song' && cue.enter.visual !== 'bound')
      context.addIssue({ code: 'custom', message: '찬양은 연결한 곡을 송출합니다.' })
    if (cue.kind !== 'song' && cue.enter.visual === 'bound' && !cue.binding && !cue.materialPending)
      context.addIssue({ code: 'custom', message: '송출할 자료를 연결해주세요.' })
  })
export const ServicePlanSchema = z
  .object({
    version: z.literal(1),
    timezone,
    plannedStartAt: z.string().datetime({ offset: true }).optional(),
    items: z.array(CueItemSchema).max(10000),
  })
  .strict()
  .superRefine((plan, context) => {
    if (new Set(plan.items.map((cue) => cue.id)).size !== plan.items.length)
      context.addIssue({ code: 'custom', message: '중복된 예배 순서입니다.' })
    const songs = plan.items.filter((cue) => cue.kind === 'song')
    if (new Set(songs.map((cue) => cue.songItemId)).size !== songs.length)
      context.addIssue({ code: 'custom', message: '찬양 행을 여러 순서가 공유할 수 없습니다.' })
  })
export type CueItem = z.infer<typeof CueItemSchema>
export type ServicePlan = z.infer<typeof ServicePlanSchema>
export type TimerPreset = z.infer<typeof TimerPresetSchema>
export interface SongReference {
  id: string
  presentationId: string
}

/** Preserve row IDs and snapshot identities; a repeated song still has independent cue IDs. */
export function planFromSongs(
  refs: SongReference[],
  titleFor: (presentationId: string) => string,
  makeId: () => string,
  zone = 'Asia/Seoul',
): ServicePlan {
  return ServicePlanSchema.parse({
    version: 1,
    timezone: zone,
    items: refs.map((ref) => ({
      id: makeId(),
      kind: 'song',
      title: titleFor(ref.presentationId).slice(0, 200).trim() || '찬양',
      songItemId: ref.id,
      enter: { visual: 'bound', audio: 'keep' },
    })),
  })
}

/** The song projection must match, including order, without orphan/duplicate row references. */
export function songProjection(plan: ServicePlan, refs: SongReference[]): SongReference[] {
  const checked = ServicePlanSchema.parse(plan)
  const byId = new Map(refs.map((ref) => [ref.id, ref]))
  if (byId.size !== refs.length) throw new Error('중복된 찬양 행입니다.')
  const songs = checked.items.filter((cue) => cue.kind === 'song')
  if (songs.length !== refs.length) throw new Error('예배 순서와 찬양 목록이 일치하지 않습니다.')
  return songs.map((cue) => {
    const ref = byId.get(cue.songItemId!)
    if (!ref) throw new Error('예배 순서에 연결한 찬양을 찾지 못했습니다.')
    return { ...ref }
  })
}

/** Reorder songs in their existing slots. Non-song cues retain their place and metadata. */
export function reconcileSongs(
  plan: ServicePlan,
  refs: SongReference[],
  titleFor: (presentationId: string) => string,
  makeId: () => string,
): ServicePlan {
  const checked = ServicePlanSchema.parse(plan)
  if (new Set(refs.map((ref) => ref.id)).size !== refs.length)
    throw new Error('중복된 찬양 행입니다.')
  const prior = new Map(
    checked.items.filter((cue) => cue.kind === 'song').map((cue) => [cue.songItemId!, cue]),
  )
  const queue = refs.map(
    (ref) => prior.get(ref.id) || planFromSongs([ref], titleFor, makeId, checked.timezone).items[0],
  )
  const retainedRows = new Set(refs.map((ref) => ref.id))
  const retainedCues = checked.items.filter(
    (cue) => cue.kind !== 'song' || retainedRows.has(cue.songItemId!),
  )
  let index = 0
  const items = retainedCues.map((cue) => (cue.kind === 'song' ? queue[index++] : cue))
  items.push(...queue.slice(index))
  return ServicePlanSchema.parse({ ...checked, items })
}

export interface PlannedCueTime {
  cueId: string
  startAt: string | null
  durationSeconds: number | null
}
/** Unknown duration is not zero. Once unknown, following start times remain unknown. */
export function plannedCueTimes(plan: ServicePlan): PlannedCueTime[] {
  const checked = ServicePlanSchema.parse(plan)
  let cursor = checked.plannedStartAt ? Date.parse(checked.plannedStartAt) : null
  return checked.items.map((cue) => {
    const result = {
      cueId: cue.id,
      startAt: cursor === null ? null : new Date(cursor).toISOString(),
      durationSeconds: cue.durationSeconds ?? null,
    }
    cursor =
      cursor === null || cue.durationSeconds === undefined
        ? null
        : cursor + cue.durationSeconds * 1000
    return result
  })
}

/** Explicit projections: private notes never enter audience or stage data by object spread. */
export function publicCueSummary(cue: CueItem) {
  const checked = CueItemSchema.parse(cue)
  return {
    id: checked.id,
    kind: checked.kind,
    title: checked.title,
    durationSeconds: checked.durationSeconds,
  }
}

export const SaveServicePlanSchema = z
  .object({
    requestId: z.string().uuid(),
    setlistId: id,
    expectedSetlistRevision: z.number().int().nonnegative(),
    plan: ServicePlanSchema,
    restoreSongRows: z
      .array(z.object({ id, presentationId: id }).strict())
      .max(10000)
      .optional(),
  })
  .strict()
export type SaveServicePlan = z.infer<typeof SaveServicePlanSchema>
