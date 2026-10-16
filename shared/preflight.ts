import { z } from 'zod'
import type { CueItem } from './service-plan'
import type { Presentation } from '../src/types'
export interface PreflightResult {
  checkId: string
  cueId?: string
  severity: 'blocking' | 'warning' | 'manual' | 'info'
  status: 'pass' | 'fail' | 'unchecked' | 'acknowledged'
  code: string
  checkedAt?: string
}
export interface PreflightRun {
  id: string
  setlistId: string
  setlistRevision: number
  fingerprint: string
  status: 'running' | 'completed' | 'cancelled' | 'error'
  startedAt: string
  completedAt?: string
  processed: number
  total: number
  results: PreflightResult[]
  error?: string
  stale?: boolean
}
export const PreflightCommand = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('start'),
      setlistId: z.string().min(1).max(160),
      revision: z.number().int().nonnegative(),
      fonts: z.string().max(500),
      layouts: z
        .array(
          z
            .object({
              presentationId: z.string().max(160),
              revision: z.number().int().nonnegative(),
              warning: z.boolean(),
              unmeasured: z.boolean(),
            })
            .strict(),
        )
        .max(10000),
    })
    .strict(),
  z
    .object({
      action: z.literal('get'),
      setlistId: z.string().min(1).max(160),
      fonts: z.string().max(500),
    })
    .strict(),
  z.object({ action: z.literal('cancel'), runId: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal('ack'),
      runId: z.string().uuid(),
      checkId: z.string().max(500),
      fingerprint: z.string().max(128),
      fonts: z.string().max(500),
      acknowledged: z.boolean(),
    })
    .strict(),
])
export type PreflightAction = z.infer<typeof PreflightCommand>
export function cuePresentation(
  cue: CueItem,
  rows: { id: string; presentationId: string }[],
  songs: { presentation: Presentation }[],
  owned: { presentation: Presentation }[],
) {
  const id =
    cue.kind === 'song'
      ? rows.find((row) => row.id === cue.songItemId)?.presentationId
      : cue.binding?.kind === 'presentation'
        ? cue.binding.presentationId
        : undefined
  return [...songs, ...owned].find((entry) => entry.presentation.id === id)?.presentation
}
export function preflightSummary(run: PreflightRun) {
  const counts = { blocking: 0, warning: 0, manual: 0 }
  for (const result of run.results)
    if (result.status !== 'pass' && result.status !== 'acknowledged' && result.severity !== 'info')
      counts[result.severity]++
  return {
    ...counts,
    ready:
      run.status === 'completed' &&
      !run.stale &&
      counts.blocking === 0 &&
      counts.warning === 0 &&
      counts.manual === 0,
  }
}
export const preflightLabels: Record<string, string> = {
  'plan-valid': '순서와 연결 참조 확인',
  'missing-material': '송출 자료 선택 필요',
  'missing-asset': '등록 파일을 찾지 못함 · 새 자료 연결 또는 파일 복원 필요',
  'pdf-page': 'PDF 페이지 확인 필요',
  'web-manual': '웹 접속·로그인·화면을 직접 확인',
  'layout-warning': '본문 또는 요소가 화면을 넘을 수 있음 · 미리보기 확인',
  'layout-manual': '글꼴 또는 본문 측정 불가 · 직접 화면 확인',
  'layout-pass': '본문 크기·캔버스 경계 검사',
  'main-window': '메인 출력 창의 표시 확인 필요',
  'stage-window': '무대 출력 창의 표시 확인 필요',
  'display-missing': '설정한 디스플레이 연결 확인 필요',
  'main-readable': '실제 메인 화면 가독성 확인',
  'stage-readable': '실제 무대 화면 가독성 확인',
  sound: '실제 음향과 음량 확인',
  emergency: '현장에서 전체 중지와 복귀 리허설 확인',
  'empty-plan': '예배 순서를 추가해주세요.',
}
