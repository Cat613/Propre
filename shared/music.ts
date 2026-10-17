import { z } from 'zod'
const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/)
export function musicURL(input: string): string {
  const url = new URL(input)
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'music.youtube.com' ||
    url.port ||
    url.username ||
    url.password
  )
    throw new Error('유튜브 뮤직의 HTTPS 곡 또는 재생목록 주소를 입력해주세요.')
  const video = url.searchParams.get('v'),
    list = url.searchParams.get('list')
  const valid = (value: string | null) => !!value && /^[a-zA-Z0-9_-]{1,160}$/.test(value)
  if (url.pathname === '/playlist' && valid(list))
    return `https://music.youtube.com/playlist?list=${list}`
  if (url.pathname === '/watch' && valid(video))
    return `https://music.youtube.com/watch?v=${video}${valid(list) ? `&list=${list}` : ''}`
  throw new Error('유튜브 뮤직의 곡 또는 재생목록 링크를 확인해주세요.')
}
export const LocalMusicSchema = z
  .object({
    url: z
      .string()
      .max(2048)
      .regex(/^media:\/\/asset\/[a-zA-Z0-9_-]+\/[^/?#]+$/),
    startSeconds: z.number().finite().min(0).max(86400).default(0),
    endSeconds: z.number().finite().positive().max(86400).optional(),
    volume: z.number().finite().min(0).max(1).default(0.5),
    loop: z.boolean().default(false),
    fadeSeconds: z.number().finite().min(0).max(10).default(3),
  })
  .strict()
  .refine(
    (x) => x.endSeconds === undefined || x.endSeconds > x.startSeconds,
    '끝 시간은 시작 시간보다 커야 합니다.',
  )
export const MusicItemSchema = z
  .object({
    id,
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(200),
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('local'), local: LocalMusicSchema }).strict(),
      z
        .object({
          kind: z.literal('youtube-music'),
          url: z.string().max(2048).transform(musicURL),
          fallback: LocalMusicSchema.optional(),
        })
        .strict(),
    ]),
  })
  .strict()
export const MusicItemsSchema = z
  .array(MusicItemSchema)
  .max(200)
  .refine((xs) => new Set(xs.map((x) => x.id)).size === xs.length)
export const SaveMusicSchema = z
  .object({
    setlistId: id,
    expectedRevision: z.number().int().nonnegative(),
    items: MusicItemsSchema,
  })
  .strict()
export type MusicItem = z.infer<typeof MusicItemSchema>
export type LocalMusic = z.infer<typeof LocalMusicSchema>
export type SaveMusic = z.infer<typeof SaveMusicSchema>
export type MusicBridgeState = {
  sequence?: number
  connected: boolean
  stale: boolean
  playing: boolean | null
  title: string
  videoId: string
  listId: string
  bindingId: string
  pageVideoId?: string
  pageListId?: string
  canStart?: boolean
  error?: string
}

/** Loaded playback and an explicitly startable playlist page are separate observations. */
export function musicTargetMatches(url: string, state: MusicBridgeState, allowStart = true) {
  const target = new URL(musicURL(url))
  if (target.pathname === '/playlist') {
    const list = target.searchParams.get('list')
    return (
      (!!state.videoId && list === state.listId) ||
      (allowStart && state.canStart === true && list === state.pageListId)
    )
  }
  return !!state.videoId && target.searchParams.get('v') === state.videoId
}
