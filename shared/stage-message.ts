import { z } from 'zod'
export const StageMessageText = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((text) => text.split('\n').length <= 2, '안내는 두 줄 이내로 줄여주세요.')
export const StageMessageCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('send'),
      requestId: z.string().uuid(),
      expectedRevision: z.number().int().nonnegative(),
      text: StageMessageText,
      ttl: z.union([
        z.literal(0),
        z.literal(5),
        z.literal(10),
        z.literal(20),
        z.literal(30),
        z.literal(60),
      ]),
    })
    .strict(),
  z
    .object({
      action: z.literal('clear'),
      id: z.string().uuid(),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
])
export interface StageMessage {
  id: string
  sessionId: string
  revision: number
  text: string
  sentAt: string
  expiresAt?: string
}
export interface StageMessageStatus {
  remainingMs?: number
  revision: number
  message: StageMessage | null
  delivery: 'none' | 'pending' | 'displayed' | 'unconfirmed'
  stage: { width: number; height: number } | null
}
export type StageMessageAction = z.infer<typeof StageMessageCommand>
/** Same fixed font and available width in Control preview and Stage; explicit lines count too. */
export function messageLayout(
  text: string,
  width: number,
  height: number,
  measure: (text: string, fontSize: number) => number,
) {
  const fontSize = Math.max(16, Math.min(28, height * 0.035))
  const available = Math.max(1, width - 64)
  let lines = 0
  const rows: string[] = []
  for (const paragraph of text.split('\n')) {
    let row = ''
    lines++
    for (const character of paragraph) {
      if (row && measure(row + character, fontSize) > available) {
        rows.push(row)
        lines++
        row = character
      } else row += character
    }
    rows.push(row)
  }
  return { fontSize, lines, rows, fits: lines <= 2 && width >= 160 }
}
