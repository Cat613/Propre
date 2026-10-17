import { syncSongCues } from './service-plan-storage'
import { createHash, randomUUID } from 'node:crypto'
import type { Repository } from './repository'
import {
  DraftSetSchema,
  compileSong,
  titleKey,
  type ApplyReceipt,
  type SongJob,
} from '../../shared/song-preparation'
import { parsePresentation } from '../../shared/schema'

export function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
export function planHash(job: SongJob) {
  return hash({
    id: job.id,
    revision: job.draftRevision,
    draft: job.draft,
    mode: job.mode,
    targetId: job.targetId,
    targetRevision: job.targetRevision,
    style: job.style,
    sources: job.sources,
    libraryVersions: job.libraryVersions,
  })
}
export async function applySongJob(
  repo: Repository,
  job: SongJob,
  approvedHash: string,
): Promise<ApplyReceipt> {
  if (!job.draft || approvedHash !== planHash(job))
    throw new Error('준비 내용이 변경되었습니다. 다시 확인해주세요.')
  const draft = DraftSetSchema.parse(job.draft)
  if (draft.songs.some((s) => !s.confirmed))
    throw new Error('가사와 송폼을 확인한 뒤 적용해주세요.')
  let receipt: ApplyReceipt | undefined
  await repo.transaction((s) => {
    const prior = s.songReceipts.find((r) => r.requestId === job.requestId)
    if (prior) {
      if (prior.jobId !== job.id || prior.planHash !== approvedHash)
        throw new Error('이미 처리한 요청의 내용이 다릅니다.')
      receipt = prior
      return
    }
    const active = s.setlists.find((x) => x.id === s.activeSetlistId)
    if (
      s.activeSetlistId !== job.targetId ||
      (active?.revision ?? null) !== job.targetRevision ||
      active?.deletedAt
    )
      throw new Error('콘티가 변경되었습니다. 최신 콘티를 다시 확인해주세요.')
    const now = new Date().toISOString()
    const list = active || {
      id: randomUUID(),
      title: 'AI 준비 콘티',
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
      revision: 0,
      items: [],
    }
    if (!active) s.setlists.push(list)
    let added = 0,
      updated = 0
    const ids = new Map<string, string>()
    for (const song of draft.songs) {
      let original = song.originalId ? s.library.find((x) => x.id === song.originalId) : undefined
      if (song.originalId && (!original || (original.revision || 0) !== song.originalRevision))
        throw new Error('찬양 목록의 원곡이 변경되었습니다. 다시 확인해주세요.')
      // A song added concurrently must be resolved before registration.
      if (
        !song.originalId &&
        s.library.some(
          (p) =>
            titleKey(p.title) === titleKey(song.title) && !Object.hasOwn(job.libraryVersions, p.id),
        )
      )
        throw new Error('같은 제목의 곡이 있습니다. 원곡 연결을 확인해주세요.')
      const prepared = parsePresentation(compileSong(song, job.style))
      if (!original) {
        original = prepared
        s.library.push(original)
        added++
      } else if (song.updateOriginal) {
        original = {
          ...prepared,
          id: original.id,
          createdAt: original.createdAt,
          revision: (original.revision || 0) + 1,
        }
        s.library = s.library.map((p) => (p.id === original!.id ? original! : p))
        if (s.draft?.id === original.id)
          throw new Error(
            '편집 중인 원곡은 이 화면에서 갱신할 수 없습니다. 콘티에서 별도로 반영해주세요.',
          )
        updated++
      }
      const id = 'setlist_' + randomUUID()
      s.setlistSongs.push({
        presentation: { ...prepared, id },
        sourcePresentationId: original.id,
        sourceRevision: original.revision || 0,
      })
      ids.set(song.id, id)
    }
    const priorServicePlan = active?.servicePlan ? structuredClone(active.servicePlan) : undefined
    const priorItems = structuredClone(list.items)
    const next = draft.order.map((id) => ({ id: randomUUID(), presentationId: ids.get(id)! }))
    list.items = job.mode === 'append' ? [...list.items, ...next] : next
    syncSongCues(s, list)
    list.revision++
    list.updatedAt = now
    s.activeSetlistId = list.id
    s.playlist = structuredClone(list.items)
    receipt = {
      jobId: job.id,
      requestId: job.requestId,
      planHash: approvedHash,
      appliedAt: now,
      setlistId: list.id,
      finalRevision: list.revision,
      priorItems,
      priorServicePlan,
      finalItems: structuredClone(list.items),
      added,
      updated,
    }
    s.songReceipts.push(receipt)
  })
  return structuredClone(receipt!)
}
export async function undoSongApply(repo: Repository, requestId: string) {
  await repo.transaction((s) => {
    const receipt = s.songReceipts.find((r) => r.requestId === requestId)
    if (!receipt) throw new Error('적용 기록을 찾지 못했습니다.')
    if (receipt.undoneAt) return
    const list = s.setlists.find((x) => x.id === receipt.setlistId)
    if (
      !list ||
      list.revision !== receipt.finalRevision ||
      hash(list.items) !== hash(receipt.finalItems) ||
      list.deletedAt
    )
      throw new Error('적용 후 콘티가 변경되어 자동으로 되돌릴 수 없습니다.')
    list.items = structuredClone(receipt.priorItems)
    list.servicePlan = receipt.priorServicePlan
      ? structuredClone(receipt.priorServicePlan)
      : undefined
    syncSongCues(s, list)
    list.revision++
    list.updatedAt = new Date().toISOString()
    if (s.activeSetlistId === list.id) s.playlist = structuredClone(list.items)
    receipt.undoneAt = list.updatedAt
  })
}
