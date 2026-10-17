import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Repository } from '../electron/services/repository'
import { applySongJob, planHash, undoSongApply } from '../electron/services/song-apply'
import {
  compileSong,
  SongFormSchema,
  DraftSetSchema,
  type SongJob,
  type SongDraft,
} from '../shared/song-preparation'
import { DEFAULT_STYLE } from '../shared/model'
import { parsePresentation, parseProject } from '../shared/schema'
const now = '2026-10-06T00:00:00.000Z'
export const song = (): SongDraft => ({
  id: 'song',
  title: '합성 찬양',
  formEvidence: 'explicit',
  issues: [],
  confirmed: true,
  originalId: null,
  originalRevision: null,
  updateOriginal: false,
  form: {
    parts: [
      ['A', ['합성 첫 페이지', '합성 두 번째']],
      ['B', ['합성 후렴 시작', '합성 후렴 끝']],
      ['C', ['합성 브리지']],
      ['TAG', ['합성 엔딩']],
    ].map(([id, pages]) => ({
      id: id as string,
      label: id as string,
      pages: pages as string[],
      sourceId: 'file',
      sourcePage: 1,
    })),
    sequence: [
      ['A', 1],
      ['B', 1],
      ['A', 1],
      ['B', 2],
      ['C', 1],
      ['B', 1],
      ['TAG', 1],
    ].map(([partId, repeat]) => ({ partId: partId as string, repeat: repeat as number })),
  },
})
const job = (repo: Repository): SongJob => ({
  id: randomUUID(),
  requestId: randomUUID(),
  createdAt: now,
  updatedAt: now,
  profile: { id: 'p', provider: 'gemini', name: '합성 AI', model: 'synthetic' },
  sources: [],
  instruction: '',
  mode: 'append',
  automatic: false,
  keepSources: false,
  status: 'ready',
  targetId: repo.state.activeSetlistId,
  targetRevision:
    repo.state.setlists.find((x) => x.id === repo.state.activeSetlistId)?.revision ?? null,
  draftRevision: 1,
  draft: { songs: [song()], order: ['song'] },
  style: DEFAULT_STYLE,
  libraryVersions: Object.fromEntries(repo.state.library.map((p) => [p.id, p.revision || 0])),
})
let directory: string, repo: Repository
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-ai-unit-'))
  repo = new Repository(directory)
  await repo.open()
})
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})
describe('song form and durable setlist preparation', () => {
  it('expands 14 pages in exact form, repeats have unique identities, metadata survives schema and portable round trips', async () => {
    const p = compileSong(song())
    expect(p.slides).toHaveLength(14)
    expect(new Set(p.slides.map((s) => s.id)).size).toBe(14)
    expect(p.slides.map((s) => s.songPosition?.partId)).toEqual([
      'A',
      'A',
      'B',
      'B',
      'A',
      'A',
      'B',
      'B',
      'B',
      'B',
      'C',
      'B',
      'B',
      'TAG',
    ])
    expect(
      p.slides
        .filter((s) => s.songPosition?.partId === 'B')
        .every((s) => s.labelColor === '#3B82F6'),
    ).toBe(true)
    expect(parsePresentation(p).songForm).toEqual(p.songForm)
    await repo.saveDraft(p)
    const data = await repo.exportProject(JSON.stringify(p))
    expect(parseProject(data).presentations[0].songForm).toEqual(p.songForm)
    const blank = song()
    blank.form.parts[0].pages = ['']
    expect(compileSong(blank).slides[0].content).toBe('')
  })
  it('rejects unresolved references, infinite/zero repeat, slide budget, and orphan drafts without crashing', () => {
    const form = song().form
    expect(
      SongFormSchema.safeParse({ ...form, sequence: [{ partId: 'unknown', repeat: 1 }] }).success,
    ).toBe(false)
    expect(
      SongFormSchema.safeParse({ ...form, sequence: [{ partId: 'A', repeat: 0 }] }).success,
    ).toBe(false)
    expect(
      SongFormSchema.safeParse({
        ...form,
        sequence: Array.from({ length: 100 }, () => ({ partId: 'A', repeat: 20 })),
      }).success,
    ).toBe(false)
    expect(DraftSetSchema.safeParse({ songs: [song()], order: ['missing'] }).success).toBe(false)
  })
  it('registers new songs, preserves appended item identities and repeats, keeps current draft and old originals', async () => {
    const original = compileSong({ ...song(), title: '기존 찬양' })
    await repo.saveDraft(original)
    await repo.setPlaylist([
      { id: 'existing', presentationId: original.id },
      { id: 'again', presentationId: original.id },
    ])
    const before = structuredClone(repo.state),
      prepared = job(repo)
    prepared.draft!.order = ['song', 'song']
    const receipt = await applySongJob(repo, prepared, planHash(prepared))
    expect(receipt.added).toBe(1)
    expect(repo.state.library).toHaveLength(2)
    expect(repo.state.playlist.slice(0, 2)).toEqual(before.playlist)
    expect(repo.state.playlist).toHaveLength(4)
    expect(repo.state.playlist[2].id).not.toBe(repo.state.playlist[3].id)
    expect(repo.state.draft).toEqual(before.draft)
    expect(repo.state.setlistSongs.at(-1)?.presentation.songForm).toEqual(song().form)
  })
  it('existing original stays unchanged unless explicitly chosen, while historical snapshots remain independent', async () => {
    const original = compileSong(song())
    await repo.saveDraft(original)
    await repo.setPlaylist([{ id: 'existing', presentationId: original.id }])
    await repo.saveDraft({ ...compileSong(song()), title: '운영자 편집' })
    const historical = structuredClone(repo.state.setlistSongs[0]),
      prepared = job(repo)
    Object.assign(prepared.draft!.songs[0], { originalId: original.id, originalRevision: 0 })
    prepared.draft!.songs[0].form.parts[0].pages = ['예배별 합성 가사']
    await applySongJob(repo, prepared, planHash(prepared))
    expect(repo.state.library.find((p) => p.id === original.id)?.slides).toEqual(original.slides)
    const update = job(repo)
    Object.assign(update.draft!.songs[0], {
      originalId: original.id,
      originalRevision: 0,
      updateOriginal: true,
    })
    update.draft!.songs[0].form.parts[0].pages = ['명시적으로 갱신한 합성 가사']
    await applySongJob(repo, update, planHash(update))
    expect(repo.state.library.find((p) => p.id === original.id)?.slides[0].content).toBe(
      '명시적으로 갱신한 합성 가사',
    )
    expect(repo.state.setlistSongs[0]).toEqual(historical)
  })
  it('replace commits without pre-clearing; replays return receipt after restart; conflicting request hash rejects; undo preserves registered songs', async () => {
    const original = compileSong({ ...song(), title: '기존' })
    await repo.saveDraft(original)
    await repo.setPlaylist([{ id: 'before', presentationId: original.id }])
    const prior = structuredClone(repo.state.playlist)
    const prepared = job(repo)
    prepared.mode = 'replace'
    const receipt = await applySongJob(repo, prepared, planHash(prepared))
    const reopened = new Repository(directory)
    await reopened.open()
    expect(await applySongJob(reopened, prepared, planHash(prepared))).toEqual(receipt)
    expect(reopened.state.library).toHaveLength(2)
    const changed = { ...prepared, draftRevision: 2 }
    await expect(applySongJob(reopened, changed, planHash(changed))).rejects.toThrow(
      '내용이 다릅니다',
    )
    await undoSongApply(reopened, prepared.requestId)
    expect(reopened.state.playlist).toEqual(prior)
    expect(reopened.state.library).toHaveLength(2)
    await undoSongApply(reopened, prepared.requestId)
    expect(reopened.state.playlist).toEqual(prior)
  })
  it('rejects changed setlist, changed originals, concurrent new originals, and unconfirmed plans with no partial write', async () => {
    const prepared = job(repo)
    await repo.manageSetlist({
      operation: 'create',
      title: '변경한 콘티',
      fromCurrent: false,
      expectedActiveId: null,
      expectedRevision: null,
    })
    const before = structuredClone(repo.state)
    await expect(applySongJob(repo, prepared, planHash(prepared))).rejects.toThrow('콘티가 변경')
    expect(repo.state).toEqual(before)
    const concurrent = job(repo)
    await repo.saveDraft(compileSong(song()))
    const same = structuredClone(repo.state)
    await expect(applySongJob(repo, concurrent, planHash(concurrent))).rejects.toThrow('같은 제목')
    expect(repo.state).toEqual(same)
    const existing = job(repo)
    existing.draft!.songs[0].originalId = repo.state.library[0].id
    existing.draft!.songs[0].originalRevision = 999
    await expect(applySongJob(repo, existing, planHash(existing))).rejects.toThrow('원곡이 변경')
    const unconfirmed = job(repo)
    unconfirmed.draft!.songs[0].confirmed = false
    await expect(applySongJob(repo, unconfirmed, planHash(unconfirmed))).rejects.toThrow('확인')
  })
  it('a disk failure leaves all collections and receipts unchanged, retry succeeds; undo refuses intervening order changes', async () => {
    const prepared = job(repo),
      before = structuredClone(repo.state)
    await fs.mkdir(repo.filename)
    await expect(applySongJob(repo, prepared, planHash(prepared))).rejects.toThrow()
    expect(repo.state).toEqual(before)
    await fs.rm(repo.filename, { recursive: true })
    await applySongJob(repo, prepared, planHash(prepared))
    await repo.setPlaylist(repo.state.playlist)
    await expect(undoSongApply(repo, prepared.requestId)).rejects.toThrow('콘티가 변경')
  })
})
