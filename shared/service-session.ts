import { ServicePlanSchema } from './service-plan'
import { z } from 'zod'
const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/)
export const CueRequestSchema = z
  .object({ setlistId: id, cueId: id, expectedSetlistRevision: z.number().int().nonnegative() })
  .strict()
export type CueRequest = z.infer<typeof CueRequestSchema>
export const ServiceSessionSchema = z
  .object({
    id: z.string().uuid(),
    setlistId: id,
    revision: z.number().int().nonnegative(),
    status: z.enum(['running', 'interrupted', 'finished']),
    currentCueId: id.nullable(),
    startedAt: z.string().datetime(),
    states: z.record(id, z.enum(['running', 'completed', 'skipped'])),
    runs: z
      .array(
        z.object({
          id: z.string().uuid().optional(),
          cueId: id,
          startedAt: z.string().datetime(),
          endedAt: z.string().datetime().optional(),
          outcome: z.enum(['completed', 'skipped', 'interrupted']).optional(),
        }),
      )
      .max(2000),
  })
  .strict()
export type ServiceSessionView = z.infer<typeof ServiceSessionSchema>
export interface PreparedCue {
  token: string
  cueId: string
  setlistId: string
  planRevision: number
}
export const AttachCueSchema = z
  .object({
    requestId: z.string().uuid(),
    setlistId: id,
    cueId: id,
    expectedSetlistRevision: z.number().int().nonnegative(),
    plan: ServicePlanSchema.optional(),
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('presentation'), id, slideId: id }).strict(),
      z
        .object({
          kind: z.literal('resource'),
          id,
          page: z.number().int().min(1).max(1000).optional(),
          rotation: z
            .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
            .optional(),
        })
        .strict(),
      z.object({ kind: z.literal('none') }).strict(),
    ]),
  })
  .strict()
export type AttachCue = z.infer<typeof AttachCueSchema>

export const ServiceFileTargetSchema = z
  .object({ activeId: id.nullable(), revision: z.number().int().nonnegative().nullable() })
  .strict()
export type ServiceFileTarget = z.infer<typeof ServiceFileTargetSchema>
