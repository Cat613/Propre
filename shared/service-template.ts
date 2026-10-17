import { z } from 'zod'
import {
  CueItemSchema,
  CueBindingSchema,
  EnterPolicySchema,
  TimerPresetSchema,
} from './service-plan'
const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/)
export const TemplateItemSchema = z
  .object({
    id,
    kind: CueItemSchema.shape.kind,
    title: CueItemSchema.shape.title,
    leader: CueItemSchema.shape.leader,
    durationSeconds: CueItemSchema.shape.durationSeconds,
    operatorNote: CueItemSchema.shape.operatorNote,
    stageNote: CueItemSchema.shape.stageNote,
    enter: EnterPolicySchema,
    timer: TimerPresetSchema.optional(),
    musicPreparationId: id.optional(),
    materialMode: z.enum(['slot', 'fixed']),
    slotName: z.string().max(100).optional(),
    required: z.boolean(),
    binding: CueBindingSchema.optional(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.kind === 'song' && (item.enter.visual !== 'bound' || !item.required))
      context.addIssue({
        code: 'custom',
        message: '찬양은 자료 필수 슬롯 또는 고정 자료로 설정해주세요.',
      })
    if (
      (item.materialMode === 'fixed' && !item.binding) ||
      (item.materialMode === 'slot' && item.binding) ||
      (item.kind === 'song' &&
        item.materialMode === 'fixed' &&
        item.binding?.kind !== 'presentation')
    )
      context.addIssue({ code: 'custom', message: '고정 자료 또는 슬롯 연결을 확인해주세요.' })
  })
export const TemplateSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('presentation'),
      id,
      revision: z.number().int().nonnegative(),
      slideId: id,
    })
    .strict(),
  z
    .object({
      kind: z.literal('resource'),
      id,
      revision: z.number().int().nonnegative(),
      page: z.number().int().min(1).max(1000).optional(),
      rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
    })
    .strict(),
])
export type TemplateSource = z.infer<typeof TemplateSourceSchema>
const request = { requestId: z.string().uuid() },
  edit = { id, expectedRevision: z.number().int().nonnegative() }
export const TemplateCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('save-from-service'),
      ...request,
      setlistId: id,
      expectedRevision: z.number().int().nonnegative(),
      name: z.string().trim().min(1).max(100),
      description: z.string().max(500),
      includeLeaders: z.boolean(),
      includeOperatorNotes: z.boolean(),
      includeStageNotes: z.boolean(),
      fixedCueIds: z.array(id).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      ...request,
      ...edit,
      name: z.string().trim().min(1).max(100),
      description: z.string().max(500),
      items: z.array(TemplateItemSchema).max(1000),
      sources: z.record(id, TemplateSourceSchema).default({}),
    })
    .strict(),
  z.object({ action: z.enum(['duplicate', 'delete', 'restore']), ...request, ...edit }).strict(),
  z
    .object({
      action: z.literal('instantiate'),
      ...request,
      ...edit,
      title: z.string().trim().min(1).max(200),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      plannedStartAt: z.string().datetime({ offset: true }).optional(),
      expectedActiveId: id.nullable(),
      expectedActiveRevision: z.number().int().nonnegative().nullable(),
      slots: z.record(id, TemplateSourceSchema.nullable()),
    })
    .strict(),
])
export type TemplateAction = z.infer<typeof TemplateCommand>
