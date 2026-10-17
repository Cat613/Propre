import { expect, it, vi } from 'vitest'
import { sectionIndex, nearestSection } from '../shared/sections'
import { compileSong, type SongDraft } from '../shared/song-preparation'
import { SectionNavigation } from '../electron/services/sections'
import type { Repository } from '../electron/services/repository'
import type { WindowManager } from '../electron/services/windows'
import type { OutputSource } from '../electron/services/output-source'
const draft: SongDraft = {
  id: 'draft',
  title: '합성 구간',
  confirmed: true,
  formEvidence: 'explicit',
  issues: [],
  originalId: null,
  originalRevision: null,
  updateOriginal: false,
  form: {
    parts: [
      { id: 'verse', label: '1절', pages: ['절 가사'], sourceId: 'source', sourcePage: 1 },
      {
        id: 'chorus',
        label: '후렴',
        pages: ['후렴 앞', '후렴 뒤'],
        sourceId: 'source',
        sourcePage: 1,
      },
    ],
    sequence: [
      { partId: 'verse', repeat: 1 },
      { partId: 'chorus', repeat: 3 },
    ],
  },
}
it('indexes complete song positions into repeated occurrences with exact next-slide identities', () => {
  const p = compileSong(draft),
    index = sectionIndex(p)
  expect(index.warning).toBe(false)
  expect(index.occurrences.map((s) => s.slideIds.length)).toEqual([1, 2, 2, 2])
  const choruses = index.occurrences.filter((s) => s.partId === 'chorus')
  expect(nearestSection(choruses, p.slides, p.slides[1].id).firstSlideId).toBe(p.slides[3].id)
  expect(nearestSection(choruses, p.slides, p.slides[6].id).firstSlideId).toBe(p.slides[1].id)
  expect(nearestSection(choruses, p.slides, null).firstSlideId).toBe(p.slides[1].id)
})
it('falls back on actual labels after reorder, missing position or inserted slide without modifying the form', () => {
  const p = compileSong(draft),
    form = structuredClone(p.songForm)
  p.slides.splice(2, 0, { id: 'inserted', type: 'text', content: '즉흥 삽입', label: '기도' })
  const index = sectionIndex(p)
  expect(index.warning).toBe(true)
  expect(index.occurrences.some((s) => s.firstSlideId === 'inserted')).toBe(true)
  expect(p.songForm).toEqual(form)
  p.slides.reverse()
  expect(sectionIndex(p).warning).toBe(true)
})
it('groups consecutive explicit labels, keeps non-contiguous repeats and unassigned slides separate', () => {
  const p = compileSong(draft)
  delete p.songForm
  p.slides = ['후렴', '후렴', undefined, undefined, '후렴', '브릿지'].map((label, index) => ({
    id: `slide-${index}`,
    type: 'text',
    label,
  }))
  const result = sectionIndex(p)
  expect(result.warning).toBe(false)
  expect(result.occurrences.map((s) => [s.label, s.slideIds.length])).toEqual([
    ['후렴', 2],
    ['미지정', 1],
    ['미지정', 1],
    ['후렴', 1],
    ['브릿지', 1],
  ])
})
it('rejects stale revision, deleted/non-first slide and changed generation without touching output', async () => {
  const p = { ...compileSong(draft), revision: 4 },
    repo = {
      state: { library: [p], setlistSongs: [], cuePresentations: [] },
    } as unknown as Repository
  const sources = { generation: 3, commitSlides: vi.fn(async () => {}) },
    windows = { live: () => null, stageLive: () => null, notify: vi.fn() }
  const navigation = new SectionNavigation(
    repo,
    windows as unknown as WindowManager,
    sources as unknown as OutputSource,
    () => false,
  )
  const request = {
    presentationId: p.id,
    presentationRevision: 4,
    firstSlideId: p.slides[1].id,
    expectedOutputGeneration: 3,
  }
  for (const change of [
    { presentationRevision: 3 },
    { firstSlideId: 'deleted' },
    { firstSlideId: p.slides[2].id },
    { expectedOutputGeneration: 2 },
  ])
    await expect(navigation.take({ ...request, ...change })).rejects.toThrow('바뀌')
  expect(sources.commitSlides).not.toHaveBeenCalled()
  await navigation.take(request)
  expect(sources.commitSlides.mock.calls[0][1]).toMatchObject({
    current: { id: p.slides[1].id },
    next: { id: p.slides[2].id },
  })
  expect(windows.notify).toHaveBeenCalledWith(
    'service-cue-applied',
    expect.objectContaining({ manual: true }),
  )
})
it('does not publish a manual application after output failure or competing execution', async () => {
  const p = { ...compileSong(draft), revision: 0 },
    repo = {
      state: { library: [p], setlistSongs: [], cuePresentations: [] },
    } as unknown as Repository
  const windows = { live: () => null, stageLive: () => null, notify: vi.fn() },
    sources = {
      generation: 0,
      commitSlides: vi.fn(async () => {
        throw new Error('stopped')
      }),
    }
  const navigation = new SectionNavigation(
    repo,
    windows as unknown as WindowManager,
    sources as unknown as OutputSource,
    () => false,
  )
  await expect(
    navigation.take({
      presentationId: p.id,
      presentationRevision: 0,
      firstSlideId: p.slides[0].id,
      expectedOutputGeneration: 0,
    }),
  ).rejects.toThrow('stopped')
  expect(windows.notify).not.toHaveBeenCalled()
  expect(navigation.executing()).toBe(false)
})
