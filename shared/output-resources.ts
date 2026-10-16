import { z } from 'zod'
const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/)
export function normalizeWebURL(value: string, persistent = true): string {
  const trimmed = value.trim()
  const url = new URL(
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[^/:]+:\d+(?:\/|$)/.test(trimmed)
      ? trimmed
      : `https://${trimmed}`,
  )
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.href.length > 2048
  )
    throw new Error(
      'HTTP 또는 HTTPS 주소를 입력해주세요. 로그인 정보가 포함된 주소는 사용할 수 없습니다.',
    )
  if (
    persistent &&
    [...url.searchParams.keys()].some((key) =>
      /^(access_token|token|password|secret|code|api_key|auth)$/i.test(key),
    )
  )
    throw new Error('인증 정보가 포함된 주소는 저장할 수 없습니다. 홈페이지 주소를 등록해주세요.')
  return url.href
}
const base = {
  id,
  name: z.string().trim().min(1).max(200),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().optional(),
}
export const Rotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
export const OutputResourceSchema = z.discriminatedUnion('kind', [
  z.object({
    ...base,
    kind: z.literal('web'),
    url: z
      .string()
      .max(2048)
      .refine((v) => {
        try {
          return normalizeWebURL(v) === v
        } catch {
          return false
        }
      }),
  }),
  z.object({
    ...base,
    kind: z.literal('pdf'),
    assetId: id,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    pageCount: z.number().int().min(1).max(1000),
    lastPreparedPage: z.number().int().min(1).max(1000),
    rotation: Rotation,
  }),
])
export const OutputResourcesSchema = z
  .array(OutputResourceSchema)
  .max(10000)
  .refine((items) => new Set(items.map((x) => x.id)).size === items.length)
export type OutputResource = z.infer<typeof OutputResourceSchema>
export const VisualSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('slides') }),
  z.object({
    kind: z.literal('pdf'),
    rotation: Rotation.optional(),
    resourceId: id,
    name: z.string().max(200),
    page: z.number().int().min(1).max(1000),
    pageCount: z.number().int().min(1).max(1000),
    frameURL: z.string().regex(/^output:\/\/frame\/[a-zA-Z0-9_-]+$/),
    nextFrameURL: z
      .string()
      .regex(/^output:\/\/frame\/[a-zA-Z0-9_-]+$/)
      .optional(),
  }),
  z.object({
    kind: z.literal('web'),
    resourceId: id,
    name: z.string().max(200),
    host: z.string().max(300),
    frozenFrame: z
      .string()
      .max(1500000)
      .regex(/^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/)
      .optional(),
  }),
])
export type VisualSource = z.infer<typeof VisualSourceSchema>
export interface PreparedOutput {
  generation: number
  token: string
  resourceId: string
  revision: number
  page?: number
  rotation?: 0 | 90 | 180 | 270
  frameURL?: string
}
export interface ExternalOutputStatus {
  source: VisualSource
  generation: number
  browser?: {
    resourceId: string
    url: string
    loading: boolean
    muted: boolean
    zoom: number
    live: boolean
  }
  error?: string
}
export const ResourceCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('recover-deleted') }).strict(),
  z
    .object({
      action: z.literal('create-web'),
      name: z.string().max(200),
      url: z.string().max(2048),
    })
    .strict(),
  z
    .object({
      action: z.literal('update-web'),
      id,
      revision: z.number().int().nonnegative(),
      name: z.string().min(1).max(200),
      url: z.string().max(2048),
    })
    .strict(),
  z
    .object({ action: z.enum(['delete', 'restore']), id, revision: z.number().int().nonnegative() })
    .strict(),
])
export const PrepareRequest = z
  .object({
    resourceId: id,
    revision: z.number().int().nonnegative(),
    page: z.number().int().min(1).max(1000).optional(),
    rotation: Rotation.optional(),
  })
  .strict()
export const BrowserCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.enum(['back', 'forward', 'reload', 'show', 'reset']),
      generation: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal('zoom'),
      generation: z.number().int().nonnegative(),
      value: z.number().min(0.5).max(2),
    })
    .strict(),
  z
    .object({
      action: z.literal('mute'),
      generation: z.number().int().nonnegative(),
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('input'),
      generation: z.number().int().nonnegative(),
      type: z.enum(['click', 'wheel', 'key']),
      x: z.number().min(0).max(1).optional(),
      y: z.number().min(0).max(1).optional(),
      delta: z.number().min(-1000).max(1000).optional(),
      key: z.string().min(1).max(30).optional(),
    })
    .strict(),
])
