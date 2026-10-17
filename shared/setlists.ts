import { z } from 'zod'
import { Id, SetlistSchema, type CuePresentationsSchema, type CueResourcesSchema } from './schema'
import type { Presentation, PlaylistItem } from '../src/types'
export type Setlist = z.infer<typeof SetlistSchema>
export interface SetlistSong {
  presentation: Presentation
  sourcePresentationId?: string
  sourceRevision?: number
}
export interface SetlistWorkspace {
  serviceTemplates: z.infer<typeof import('./schema').ServiceTemplatesSchema>
  library: Presentation[]
  playlist: PlaylistItem[]
  setlists: Setlist[]
  setlistSongs: SetlistSong[]
  activeSetlistId: string | null
  cuePresentations: z.infer<typeof CuePresentationsSchema>
  cueResources: z.infer<typeof CueResourcesSchema>
}
const expected = z.number().int().nonnegative()
const edit = { id: Id, expectedRevision: expected }
export const SetlistCommandSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('create'),
      title: SetlistSchema.shape.title,
      date: SetlistSchema.shape.date,
      fromCurrent: z.boolean(),
      expectedActiveId: Id.nullable(),
      expectedRevision: expected.nullable(),
    })
    .strict(),
  z.object({ operation: z.literal('open'), ...edit, expectedActiveId: Id.nullable() }).strict(),
  z
    .object({
      operation: z.literal('duplicate'),
      ...edit,
      title: SetlistSchema.shape.title,
      date: SetlistSchema.shape.date,
    })
    .strict(),
  z
    .object({
      operation: z.literal('rename'),
      ...edit,
      title: SetlistSchema.shape.title,
      date: SetlistSchema.shape.date,
    })
    .strict(),
  z.object({ operation: z.literal('delete'), ...edit }).strict(),
  z.object({ operation: z.literal('restore'), ...edit }).strict(),
])
export type SetlistCommand = z.infer<typeof SetlistCommandSchema>
