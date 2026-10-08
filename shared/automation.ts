import { z } from 'zod'
import { GlobalStyle, Id } from './schema'
import type { GlobalSlideStyle, PlaylistItem, Slide } from '../src/types'

export const AI_REQUEST_BYTES = 1024 * 1024
export const AI_RECEIPT_LIMIT = 500
export const TextSlideInput = z
  .object({
    type: z.enum(['text', 'bible']).default('text'),
    content: z.string().max(100000),
    label: z.string().max(100).optional(),
    bibleReference: z.string().max(200).optional(),
  })
  .strict()
const requestId = z
  .string()
  .uuid()
  .describe(
    'Generate a UUID for this operation. Reuse it only when retrying identical arguments in this connection session.',
  )
const revision = z.number().int().nonnegative()
export const AI_TOOL_SCHEMAS = {
  get_app_state: z.object({}).strict(),
  search_presentations: z
    .object({
      query: z.string().max(200).default(''),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
  get_presentation: z
    .object({
      presentationId: Id,
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(50).default(20),
    })
    .strict(),
  lookup_bible: z.object({ query: z.string().min(1).max(100) }).strict(),
  create_presentation: z
    .object({
      requestId,
      title: z.string().trim().min(1).max(200),
      slides: z.array(TextSlideInput).min(1).max(200),
      style: GlobalStyle.optional(),
    })
    .strict(),
  update_presentation: z
    .object({
      requestId,
      presentationId: Id,
      expectedRevision: revision,
      title: z.string().trim().min(1).max(200).optional(),
      patches: z
        .array(
          z
            .object({
              slideId: Id,
              content: z.string().max(100000).optional(),
              label: z.string().max(100).optional(),
            })
            .strict(),
        )
        .max(200)
        .optional(),
      appendSlides: z.array(TextSlideInput).min(1).max(200).optional(),
      style: GlobalStyle.partial().optional(),
    })
    .strict(),
  get_playlist: z.object({}).strict(),
  set_playlist: z
    .object({
      requestId,
      expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
      presentationIds: z.array(Id).max(1000),
    })
    .strict(),
  get_preview: z.object({ presentationId: Id, slideId: Id }).strict(),
} as const
export type AITool = keyof typeof AI_TOOL_SCHEMAS
export const AI_WRITE_TOOLS = new Set<AITool>([
  'create_presentation',
  'update_presentation',
  'set_playlist',
])
export type AIPermission = 'read' | 'prepare'
export interface AIConnectionState {
  enabled: boolean
  permission: AIPermission
  connected: boolean
  lastActivityAt: string | null
  lastOperation: { tool: AITool; status: 'completed' | 'error'; at: string } | null
}
export interface AICommand {
  id: string
  session: string
  tool: AITool
  arguments: unknown
}
export interface PreparedPreview {
  slide: Slide
  style: GlobalSlideStyle
}
export interface AICommandResult {
  data?: Record<string, unknown>
  preview?: PreparedPreview
  error?: { code: string; message: string; applied?: boolean }
}
export class PreparationError extends Error {
  constructor(
    public code: string,
    message: string,
    public applied = false,
  ) {
    super(message)
  }
}
export const playlistRefs = (items: Pick<PlaylistItem, 'id' | 'presentationId'>[]) =>
  items.map(({ id, presentationId }) => ({ id, presentationId }))
export async function playlistRevision(
  items: Pick<PlaylistItem, 'id' | 'presentationId'>[],
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(playlistRefs(items)))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
export const AI_TOOL_INFO: Record<AITool, { title: string; description: string }> = {
  get_app_state: {
    title: 'ProPre 상태 확인',
    description:
      'Check preparation readiness, selected presentation, save state and software output status. Does not start or change output.',
  },
  search_presentations: {
    title: '자료 검색',
    description:
      'Search ProPre presentation titles and text. Returns IDs, revisions and pagination. Empty query lists presentations.',
  },
  get_presentation: {
    title: '자료 내용 조회',
    description:
      'Read a presentation and paginated text slides. Read its revision immediately before editing. Media bytes and private file paths are not returned.',
  },
  lookup_bible: {
    title: '성경 위치 조회',
    description:
      'Look up verses in the Bible dataset bundled with ProPre. Use a location such as 요 3:16 or 시편 23:1-6. Returns existing source text; do not invent missing verses.',
  },
  create_presentation: {
    title: '새 자료 준비',
    description:
      'Create and durably save a NEW presentation from text or Bible slides. Keeps the operator selection, draft and live output. Choose slide breaks explicitly. Requires preparation permission.',
  },
  update_presentation: {
    title: '자료 일괄 수정',
    description:
      'Update title, slide text/labels, global style or append slides, using expectedRevision from get_presentation. Preserves existing slide IDs and media. Rejects current materials while outputs are open or any live content is active. Does not select or transmit the presentation. Selected-document edits support one-step Undo.',
  },
  get_playlist: {
    title: '진행 순서 조회',
    description:
      'Read ordered presentation references and a revision token. Read immediately before replacing the playlist.',
  },
  set_playlist: {
    title: '진행 순서 구성',
    description:
      'Replace the ordered playlist with presentation IDs, including repeats if requested, using expectedRevision from get_playlist. Saves before confirming. Keeps current selection and live output.',
  },
  get_preview: {
    title: '준비 슬라이드 미리보기',
    description:
      'Render one prepared slide as a PNG using the app renderer. Does not select or transmit it. This is a preparation preview, not proof of physical display output.',
  },
}
