import { expect, it } from 'vitest'
import {
  CueItemSchema,
  ServicePlanSchema,
  TimerPresetSchema,
  planFromSongs,
  plannedCueTimes,
  publicCueSummary,
  reconcileSongs,
  songProjection,
  type CueItem,
} from '../shared/service-plan'
let serial = 0
const makeId = () => `cue-${++serial}`
const refs = [
  { id: 'row-a', presentationId: 'snapshot-a' },
  { id: 'row-b', presentationId: 'snapshot-a' },
]
const titleFor = () => '찬양 A'
const prayer: CueItem = {
  id: 'prayer',
  kind: 'prayer',
  title: '대표기도',
  leader: '합성 담당자',
  operatorNote: '비공개 운영 메모',
  stageNote: '무대 초안',
  enter: { visual: 'keep', audio: 'keep' },
}

it('migrates repeated songs without changing row/snapshot identities or source inputs', () => {
  const before = structuredClone(refs)
  const plan = planFromSongs(refs, titleFor, makeId)
  expect(plan.items[0].id).not.toBe(plan.items[1].id)
  expect(songProjection(plan, refs)).toEqual(refs)
  expect(refs).toEqual(before)
  expect(plan.items.every((cue) => cue.enter.visual === 'bound')).toBe(true)
})
it('reorders only song slots and retains cue identity, notes and non-song order', () => {
  const plan = planFromSongs(refs, titleFor, makeId)
  plan.items[0].operatorNote = '첫 곡 메모'
  plan.items.splice(1, 0, prayer)
  const changed = reconcileSongs(plan, [...refs].reverse(), titleFor, makeId)
  expect(changed.items.map((cue) => cue.id)).toEqual([plan.items[2].id, 'prayer', plan.items[0].id])
  expect(changed.items[1]).toEqual(prayer)
  expect(changed.items[2].operatorNote).toBe('첫 곡 메모')
  expect(songProjection(changed, refs)).toEqual([...refs].reverse())
  expect(plan.items[0].songItemId).toBe('row-a')
})
it('removes song cues with their notes without deleting non-song cues, and appends new rows', () => {
  const plan = planFromSongs(refs, titleFor, makeId)
  plan.items.splice(1, 0, prayer)
  const removed = reconcileSongs(plan, [], titleFor, makeId)
  expect(removed.items).toEqual([prayer])
  const added = reconcileSongs(removed, refs, titleFor, makeId)
  expect(added.items[0]).toEqual(prayer)
  expect(songProjection(added, refs)).toEqual(refs)
})
it('rejects duplicate cue IDs, shared song rows, missing references, duplicate rows and orphan songs', () => {
  const plan = planFromSongs(refs, titleFor, makeId)
  expect(() =>
    ServicePlanSchema.parse({ ...plan, items: [plan.items[0], plan.items[0]] }),
  ).toThrow()
  expect(() =>
    ServicePlanSchema.parse({
      ...plan,
      items: [plan.items[0], { ...plan.items[1], songItemId: 'row-a' }],
    }),
  ).toThrow()
  expect(() => songProjection(plan, [refs[0]])).toThrow()
  expect(() =>
    songProjection(plan, [refs[0], { id: 'other', presentationId: 'snapshot-a' }]),
  ).toThrow()
  expect(() => reconcileSongs(plan, [refs[0], refs[0]], titleFor, makeId)).toThrow()
})
it('validates kind-specific binding rules, strict input, duration bounds and timezone', () => {
  expect(() => CueItemSchema.parse({ ...prayer, songItemId: 'row-a' })).toThrow()
  expect(() =>
    CueItemSchema.parse({ ...prayer, enter: { visual: 'bound', audio: 'keep' } }),
  ).toThrow()
  expect(() => CueItemSchema.parse({ ...prayer, kind: 'song' })).toThrow()
  expect(() => CueItemSchema.parse({ ...prayer, durationSeconds: -1 })).toThrow()
  expect(() => CueItemSchema.parse({ ...prayer, durationSeconds: 1.5 })).toThrow()
  expect(() => CueItemSchema.parse({ ...prayer, durationSeconds: 86401 })).toThrow()
  expect(() => CueItemSchema.parse({ ...prayer, arbitrary: true })).toThrow()
  expect(() =>
    ServicePlanSchema.parse({ version: 1, timezone: 'invalid-zone', items: [] }),
  ).toThrow()
  expect(() => ServicePlanSchema.parse({ version: 2, timezone: 'Asia/Seoul', items: [] })).toThrow()
})
it('keeps missing duration unknown and supports zero duration and midnight crossing', () => {
  const plan = ServicePlanSchema.parse({
    version: 1,
    timezone: 'Asia/Seoul',
    plannedStartAt: '2026-10-16T23:59:00+09:00',
    items: [
      { ...prayer, id: 'one', durationSeconds: 120 },
      { ...prayer, id: 'two', durationSeconds: 0 },
      { ...prayer, id: 'three' },
      { ...prayer, id: 'four', durationSeconds: 20 },
    ],
  })
  expect(plannedCueTimes(plan).map((entry) => entry.startAt)).toEqual([
    '2026-10-16T14:59:00.000Z',
    '2026-10-16T15:01:00.000Z',
    '2026-10-16T15:01:00.000Z',
    null,
  ])
  delete plan.plannedStartAt
  expect(plannedCueTimes(plan).every((entry) => entry.startAt === null)).toBe(true)
})
it('public projection never leaks private notes, leader, bindings or timer config', () => {
  const result = publicCueSummary(prayer)
  expect(Object.keys(result).sort()).toEqual(['durationSeconds', 'id', 'kind', 'title'])
  expect(JSON.stringify(result)).not.toMatch(/비공개|합성 담당자|무대 초안/)
})
it('rejects invalid timer targets and makes countdown automation opt-in', () => {
  const timer = TimerPresetSchema.parse({ mode: 'countdown', targetSeconds: 180 })
  expect(timer.autoStart).toBe(false)
  expect(timer.showOnStage).toBe(false)
  expect(() => TimerPresetSchema.parse({ mode: 'countdown', targetSeconds: 0 })).toThrow()
  expect(() =>
    TimerPresetSchema.parse({ mode: 'countdown', targetSeconds: 30, warningSeconds: 60 }),
  ).toThrow()
  expect(() =>
    TimerPresetSchema.parse({ mode: 'countup', warningSeconds: 0, targetSeconds: 1 }),
  ).toThrow()
  expect(TimerPresetSchema.parse({ mode: 'countup', warningSeconds: 0 }).mode).toBe('countup')
})

it('deleting a song preserves the relative position of surviving non-song cues', () => {
  const plan = planFromSongs(refs, titleFor, makeId)
  plan.items.splice(1, 0, prayer)
  const result = reconcileSongs(plan, [refs[1]], titleFor, makeId)
  expect(result.items.map((cue) => cue.id)).toEqual(['prayer', plan.items[2].id])
  expect(songProjection(result, [refs[1]])).toEqual([refs[1]])
})

it('projects interleaved new and retained rows in exactly the requested order', () => {
  const plan = planFromSongs(refs, titleFor, makeId)
  plan.items.splice(1, 0, prayer)
  const next = [{ id: 'new', presentationId: 'new-song' }, refs[1]]
  const result = reconcileSongs(plan, next, titleFor, makeId)
  expect(songProjection(result, next)).toEqual(next)
  expect(result.items.some((cue) => cue.id === prayer.id)).toBe(true)
})
