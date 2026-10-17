import { z } from 'zod'
import { plannedCueTimes, type ServicePlan } from './service-plan'
import { sectionIndex } from './sections'
import type { SetlistWorkspace } from './setlists'
import type { OutputResource } from './output-resources'
export const CuesheetOptionsSchema = z
  .object({
    preset: z.enum(['public', 'team', 'operator']),
    orientation: z.enum(['portrait', 'landscape']),
    size: z.enum(['normal', 'large']),
    leader: z.boolean(),
    operatorNote: z.boolean(),
    stageNote: z.boolean(),
    policies: z.boolean(),
    materials: z.boolean(),
    sections: z.boolean(),
    hosts: z.boolean(),
    times: z.boolean(),
  })
  .strict()
export type CuesheetOptions = z.infer<typeof CuesheetOptionsSchema>
export const cuesheetPreset = (preset: CuesheetOptions['preset']): CuesheetOptions => ({
  preset,
  orientation: 'portrait',
  size: 'normal',
  leader: preset === 'operator',
  operatorNote: preset === 'operator',
  stageNote: false,
  policies: preset === 'operator',
  materials: preset === 'operator',
  sections: preset === 'team',
  hosts: false,
  times: false,
})
export interface CuesheetDTO {
  setlistId: string
  revision: number
  title: string
  date?: string
  timezone: string
  generatedAt: string
  included: string[]
  rows: {
    number: number
    kind: string
    title: string
    duration: string
    time?: string
    leader?: string
    details: { label: string; text: string }[]
  }[]
}
export interface CuesheetJob {
  id: string
  setlistId: string
  revision: number
  title: string
  generatedAt: string
  pages: number
  url: string
  stale: boolean
  included: string[]
  saved: boolean
}
const kinds = {
    song: '찬양',
    prayer: '기도',
    scripture: '봉독',
    sermon: '설교',
    offering: '헌금',
    announcement: '광고',
    custom: '기타',
  },
  policies = {
    keep: '현재 화면 유지',
    'background-only': '배경만 유지',
    black: '검정 화면',
    bound: '연결 자료 송출',
  }
function plannedTime(start: string | null, plan: ServicePlan) {
  if (!start || !plan.plannedStartAt) return '미정'
  const day = (value: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: plan.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value))
  const offset = Math.round(
    (Date.parse(day(start)) - Date.parse(day(plan.plannedStartAt))) / 86400000,
  )
  return `${new Intl.DateTimeFormat('ko-KR', { timeZone: plan.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(start))}${offset ? ` +${offset}일` : ''}`
}
/** An allowlist projection: no cue spread, ephemeral state, paths or raw URLs. */
export function cuesheetDTO(
  workspace: SetlistWorkspace,
  setlistId: string,
  raw: unknown,
  generatedAt = new Date().toISOString(),
): CuesheetDTO {
  const options = CuesheetOptionsSchema.parse(raw),
    list = workspace.setlists.find((list) => list.id === setlistId && !list.deletedAt)
  if (!list?.servicePlan || list.servicePlan.items.length > 1000)
    throw new Error('출력할 예배는1,000개 순서 이내로 준비해주세요.')
  const plan = list.servicePlan,
    times = plannedCueTimes(plan),
    included = []
  if (options.leader) included.push('담당자')
  if (options.operatorNote) included.push('운영 메모')
  if (options.stageNote) included.push('무대 안내 초안')
  if (options.hosts) included.push('웹 호스트명')
  return {
    setlistId,
    revision: list.revision,
    title: list.title,
    date: list.date,
    timezone: plan.timezone,
    generatedAt,
    included,
    rows: plan.items.map((cue, index) => {
      const p =
        cue.kind === 'song'
          ? workspace.setlistSongs.find(
              (entry) =>
                entry.presentation.id ===
                list.items.find((row) => row.id === cue.songItemId)?.presentationId,
            )?.presentation
          : cue.binding?.kind === 'presentation'
            ? workspace.cuePresentations.find(
                (entry) =>
                  entry.ownerSetlistId === list.id &&
                  entry.presentation.id ===
                    (cue.binding as { presentationId: string }).presentationId,
              )?.presentation
            : undefined
      const resource: OutputResource | undefined =
        cue.binding?.kind === 'resource'
          ? workspace.cueResources.find(
              (entry) =>
                entry.ownerSetlistId === list.id &&
                entry.resource.id === (cue.binding as { resourceId: string }).resourceId,
            )?.resource
          : undefined
      const details: { label: string; text: string }[] = []
      if (options.policies)
        details.push({
          label: '진행',
          text: `${policies[cue.enter.visual]} · 소리 ${cue.enter.audio === 'stop' ? '중지' : '유지'}`,
        })
      if (cue.materialPending || (cue.kind === 'song' && !p?.slides.length))
        details.push({ label: '자료', text: '자료 미정' })
      else if (options.materials)
        details.push({
          label: '자료',
          text:
            p?.title ||
            (resource
              ? `${resource.name}${resource.kind === 'pdf' && cue.binding?.kind === 'resource' ? ` · ${cue.binding.page}페이지` : ''}`
              : '연결 없음'),
        })
      if (options.sections && cue.kind === 'song') {
        const result = p && sectionIndex(p)
        details.push({
          label: '구간',
          text: !result
            ? '자료 미정'
            : result.warning
              ? '구간 확인 필요'
              : result.occurrences.every((section) => section.label === '미지정')
                ? '구간 정보 없음'
                : result.occurrences.map((section) => section.label).join(' → '),
        })
      }
      if (options.hosts && resource?.kind === 'web')
        details.push({ label: '웹', text: new URL(resource.url).hostname })
      if (options.operatorNote && cue.operatorNote)
        details.push({ label: '운영 메모', text: cue.operatorNote })
      if (options.stageNote && cue.stageNote)
        details.push({ label: '무대 초안', text: cue.stageNote })
      return {
        number: index + 1,
        kind: kinds[cue.kind],
        title: cue.title,
        duration:
          cue.durationSeconds === undefined
            ? '미정'
            : cue.durationSeconds < 60
              ? `${cue.durationSeconds}초`
              : `${Math.floor(cue.durationSeconds / 60)}분${cue.durationSeconds % 60 ? ` ${cue.durationSeconds % 60}초` : ''}`,
        ...(options.times ? { time: plannedTime(times[index].startAt, plan) } : {}),
        ...(options.leader ? { leader: cue.leader || '' } : {}),
        details,
      }
    }),
  }
}
export const CuesheetRequest = z
  .object({
    requestId: z.string().uuid(),
    setlistId: z.string().min(1).max(160),
    revision: z.number().int().nonnegative(),
    options: CuesheetOptionsSchema,
  })
  .strict()
