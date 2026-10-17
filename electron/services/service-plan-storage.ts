import type { z } from 'zod'
import type { PortableSchema } from '../../shared/schema'
import { randomUUID } from 'node:crypto'
import {
  planFromSongs,
  reconcileSongs,
  songProjection,
  ServicePlanSchema,
} from '../../shared/service-plan'
import type { RepositoryState } from './repository'

type List = RepositoryState['setlists'][number]
const clone = <T>(value: T): T => structuredClone(value)
const titleFor = (s: RepositoryState) => (id: string) =>
  s.setlistSongs.find((x) => x.presentation.id === id)?.presentation.title || '찬양'
export function migrateServicePlans(s: RepositoryState) {
  for (const list of s.setlists)
    list.servicePlan ||= planFromSongs(list.items, titleFor(s), randomUUID)
}
export function syncSongCues(s: RepositoryState, list: List) {
  const priorLimit = Math.max(1000, list.servicePlan?.items.length || 0)
  list.servicePlan = list.servicePlan
    ? reconcileSongs(list.servicePlan, list.items, titleFor(s), randomUUID)
    : planFromSongs(list.items, titleFor(s), randomUUID)
  if (list.servicePlan.items.length > priorLimit)
    throw new Error('새 예배 순서는 1,000개까지 추가할 수 있습니다.')
}
export function copyServicePlan(s: RepositoryState, source: List, target: List) {
  if (source.music)
    target.music = source.music.map((x) => ({ ...clone(x), id: randomUUID(), revision: 0 }))
  if (!source.servicePlan) return
  const plan = clone(source.servicePlan)
  const rowMapping = new Map(source.items.map((row, index) => [row.id, target.items[index]?.id]))
  for (const cue of plan.items) {
    cue.id = randomUUID()
    if (cue.musicPreparationId) {
      const index = source.music?.findIndex((x) => x.id === cue.musicPreparationId) ?? -1
      cue.musicPreparationId = target.music?.[index]?.id
    }
    if (cue.kind === 'song') cue.songItemId = rowMapping.get(cue.songItemId!)
    if (cue.binding?.kind === 'presentation') {
      const presentationId = cue.binding.presentationId
      const old = s.cuePresentations.find(
        (x) => x.ownerSetlistId === source.id && x.presentation.id === presentationId,
      )
      if (!old) throw new Error('복사할 순서 자료를 찾지 못했습니다.')
      const presentation = { ...clone(old.presentation), id: 'cue_' + randomUUID(), revision: 0 }
      s.cuePresentations.push({ ownerSetlistId: target.id, presentation })
      cue.binding.presentationId = presentation.id
    } else if (cue.binding?.kind === 'resource') {
      const resourceId = cue.binding.resourceId
      const old = s.cueResources.find(
        (x) => x.ownerSetlistId === source.id && x.resource.id === resourceId,
      )
      if (!old) throw new Error('복사할 외부 자료를 찾지 못했습니다.')
      const resource = { ...clone(old.resource), id: randomUUID(), revision: 0 }
      s.cueResources.push({ ownerSetlistId: target.id, resource })
      cue.binding.resourceId = resource.id
    }
  }
  target.servicePlan = plan
  // Remap song rows and presentation snapshots together before validating the copy.
  syncSongCues(s, target)
}
export function validateServicePlans(s: RepositoryState) {
  const globalIds = new Set([
    ...s.library.map((x) => x.id),
    ...s.setlistSongs.map((x) => x.presentation.id),
    ...s.deletedLibrary.map((x) => x.presentation.id),
  ])
  const resourceIds = new Set(s.outputResources.map((x) => x.id))
  for (const entry of s.cuePresentations) {
    if (
      globalIds.has(entry.presentation.id) ||
      !s.setlists.some((list) => list.id === entry.ownerSetlistId)
    )
      throw new Error('예배 자료의 소유권을 확인해주세요.')
    globalIds.add(entry.presentation.id)
  }
  for (const entry of s.cueResources) {
    if (
      resourceIds.has(entry.resource.id) ||
      !s.setlists.some((list) => list.id === entry.ownerSetlistId)
    )
      throw new Error('예배 외부 자료의 소유권을 확인해주세요.')
    resourceIds.add(entry.resource.id)
  }
  for (const list of s.setlists) {
    if (!list.servicePlan) throw new Error('예배 순서를 찾지 못했습니다.')
    const plan = ServicePlanSchema.parse(list.servicePlan)
    if (JSON.stringify(songProjection(plan, list.items)) !== JSON.stringify(list.items))
      throw new Error('예배 순서와 찬양 목록이 일치하지 않습니다.')
    if (
      s.cuePresentations.filter((x) => x.ownerSetlistId === list.id).length +
        s.cueResources.filter((x) => x.ownerSetlistId === list.id).length >
      1000
    )
      throw new Error('예배별 자료는 1,000개까지 보관할 수 있습니다.')
    for (const cue of plan.items) {
      if (cue.musicPreparationId && !list.music?.some((x) => x.id === cue.musicPreparationId))
        throw new Error('연결한 음악을 확인해주세요.')
      if (cue.binding?.kind === 'presentation') {
        const binding = cue.binding
        const p = s.cuePresentations.find(
          (x) => x.ownerSetlistId === list.id && x.presentation.id === binding.presentationId,
        )?.presentation
        if (!p || !p.slides.some((slide) => slide.id === binding.slideId))
          throw new Error('예배 순서에 연결한 슬라이드를 확인해주세요.')
      } else if (cue.binding?.kind === 'resource') {
        const binding = cue.binding
        const r = s.cueResources.find(
          (x) => x.ownerSetlistId === list.id && x.resource.id === binding.resourceId,
        )?.resource
        if (
          !r ||
          r.deletedAt ||
          (r.kind === 'pdf'
            ? !binding.page || binding.page > r.pageCount
            : binding.page !== undefined || binding.rotation !== undefined)
        )
          throw new Error('예배 순서에 연결한 외부 자료를 확인해주세요.')
      }
    }
  }
}

/** All imported ownership identities are fresh. Original-library links are intentionally not reused. */
export function importServiceState(s: RepositoryState, portable: z.infer<typeof PortableSchema>) {
  const source = portable.setlists![0]
  const now = new Date().toISOString()
  const rowIds = new Map(source.items.map((row) => [row.id, randomUUID()]))
  const songIds = new Map(
    (portable.setlistSongs || []).map((song) => [song.presentation.id, 'setlist_' + randomUUID()]),
  )
  const presentationIds = new Map(
    (portable.cuePresentations || []).map((entry) => [
      entry.presentation.id,
      'cue_' + randomUUID(),
    ]),
  )
  const resourceIds = new Map(
    (portable.cueResources || []).map((entry) => [entry.resource.id, randomUUID()]),
  )
  const list: List = {
    ...clone(source),
    id: randomUUID(),
    revision: 0,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    items: source.items.map((row) => ({
      id: rowIds.get(row.id)!,
      presentationId: songIds.get(row.presentationId)!,
    })),
    music: source.music?.map((x) => ({ ...clone(x), id: randomUUID(), revision: 0 })),
    servicePlan: clone(source.servicePlan!),
  }
  for (const cue of list.servicePlan!.items) {
    cue.id = randomUUID()
    if (cue.musicPreparationId) {
      const index = source.music?.findIndex((x) => x.id === cue.musicPreparationId) ?? -1
      cue.musicPreparationId = list.music?.[index]?.id
    }
    if (cue.kind === 'song') cue.songItemId = rowIds.get(cue.songItemId!)!
    if (cue.binding?.kind === 'presentation')
      cue.binding.presentationId = presentationIds.get(cue.binding.presentationId)!
    else if (cue.binding?.kind === 'resource')
      cue.binding.resourceId = resourceIds.get(cue.binding.resourceId)!
  }
  s.setlists.push(list)
  s.setlistSongs.push(
    ...(portable.setlistSongs || []).map((song) => ({
      presentation: {
        ...clone(song.presentation),
        id: songIds.get(song.presentation.id)!,
        revision: 0,
      },
    })),
  )
  s.cuePresentations.push(
    ...(portable.cuePresentations || []).map((entry) => ({
      ownerSetlistId: list.id,
      presentation: {
        ...clone(entry.presentation),
        id: presentationIds.get(entry.presentation.id)!,
        revision: 0,
      },
    })),
  )
  s.cueResources.push(
    ...(portable.cueResources || []).map((entry) => ({
      ownerSetlistId: list.id,
      resource: { ...clone(entry.resource), id: resourceIds.get(entry.resource.id)!, revision: 0 },
    })),
  )
  s.activeSetlistId = list.id
  s.playlist = clone(list.items)
  return list
}
