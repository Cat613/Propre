import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Repository } from '../electron/services/repository'
import { DEFAULT_STYLE } from '../shared/model'
const now = '2026-10-06T00:00:00.000Z'
const song = (id = 'a', revision = 1) => ({
  id,
  title: id,
  createdAt: now,
  updatedAt: now,
  revision,
  globalSlideStyle: { ...DEFAULT_STYLE, fontSize: 73 },
  slides: [
    {
      id: `${id}-slide`,
      type: 'text' as const,
      content: `lyrics ${revision}`,
      label: 'A',
      labelColor: '#EC4899',
    },
  ],
})
let dir: string, repo: Repository
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-setlist-unit-'))
  repo = new Repository(dir)
  await repo.open()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})
const active = () => repo.state.setlists.find((x) => x.id === repo.state.activeSetlistId)!
async function seed() {
  await repo.saveDraft(song())
  await repo.setPlaylist([
    { id: 'one', presentationId: 'a' },
    { id: 'repeat', presentationId: 'a' },
  ])
  return active().id
}
async function create(title: string, fromCurrent: boolean) {
  await repo.manageSetlist({
    operation: 'create',
    title,
    fromCurrent,
    expectedActiveId: repo.state.activeSetlistId,
    expectedRevision: active()?.revision ?? null,
  })
  return active().id
}
async function open(id: string) {
  const list = repo.state.setlists.find((x) => x.id === id)!
  await repo.manageSetlist({
    operation: 'open',
    id,
    expectedRevision: list.revision,
    expectedActiveId: repo.state.activeSetlistId,
  })
}
it('freezes the song, repeat order, part color and style when the original is modified or deleted', async () => {
  await seed()
  const order = structuredClone(repo.playlist())
  await repo.saveDraft({
    ...song('a', 2),
    title: 'changed',
    globalSlideStyle: { ...DEFAULT_STYLE, fontSize: 45 },
  })
  expect(repo.playlist()).toEqual(order)
  expect(order[0].presentation.id).not.toBe('a')
  expect(order[0].presentation.id).toBe(order[1].presentation.id)
  await repo.delete('a')
  expect(repo.playlist()).toEqual(order)
})
it('edits the selected snapshot without touching the original or other setlists, and survives reopen', async () => {
  const firstId = await seed(),
    first = structuredClone(repo.playlist()[0].presentation)
  const original = structuredClone(repo.library())
  const secondId = await create('Second worship', true)
  const second = repo.playlist()[0].presentation
  expect(second.id).not.toBe(first.id)
  await repo.saveDraft({
    ...second,
    revision: 2,
    slides: [
      { ...second.slides[0], content: 'Second only' },
      { id: 'ending', type: 'text', content: 'repeat ending' },
    ],
  })
  expect(repo.library()).toEqual(original)
  expect(repo.state.setlistSongs.find((x) => x.presentation.id === first.id)?.presentation).toEqual(
    first,
  )
  expect(repo.playlist()[1].presentation.slides).toHaveLength(2)
  await open(firstId)
  expect(repo.playlist()[0].presentation.slides[0].content).toBe('lyrics 1')
  expect(repo.state.draft?.id).toBe(second.id)
  const reopened = new Repository(dir)
  await reopened.open()
  expect(reopened.state.activeSetlistId).toBe(firstId)
  expect(reopened.state.draft?.slides[0].content).toBe('Second only')
  expect(reopened.state.setlists.find((x) => x.id === secondId)?.items).toHaveLength(2)
})
it('explicitly publishes to the original while every saved setlist keeps its own version', async () => {
  const first = await seed(),
    original = repo.library()[0]
  const firstSong = structuredClone(repo.playlist()[0].presentation)
  await create('new worship', true)
  const p = repo.playlist()[0].presentation
  await repo.saveDraft({
    ...p,
    revision: 3,
    title: 'new title',
    slides: [{ ...p.slides[0], content: 'new worship lyrics' }],
  })
  await repo.publishSetlistSong(p.id, 3, original.revision || 0)
  expect(repo.library()[0].id).toBe('a')
  expect(repo.library()[0].title).toBe('new title')
  expect(
    repo.state.setlistSongs.find((x) => x.presentation.id === firstSong.id)?.presentation,
  ).toEqual(firstSong)
  await open(first)
  expect(repo.playlist()[0].presentation.title).toBe('a')
})
it('rejects snapshot and original version conflicts during publishing without partial changes', async () => {
  await seed()
  const p = repo.playlist()[0].presentation
  await repo.saveDraft(song('a', 3))
  const before = structuredClone(repo.state)
  await expect(repo.publishSetlistSong(p.id, 0, 1)).rejects.toThrow('원곡이 변경')
  await expect(repo.publishSetlistSong(p.id, 7, 3)).rejects.toThrow('콘티의 곡이 변경')
  expect(repo.state).toEqual(before)
})
it('creates a new original through explicit publishing when the source was deleted', async () => {
  await seed()
  const p = repo.playlist()[0].presentation
  await repo.delete('a')
  await repo.publishSetlistSong(p.id, 0, null)
  expect(repo.library()).toHaveLength(1)
  expect(repo.library()[0].id).not.toBe('a')
  expect(repo.state.setlistSongs[0].sourcePresentationId).toBe(repo.library()[0].id)
  expect(repo.playlist()[0].presentation.id).toBe(p.id)
})
it('supports create, rename/date, duplicate, trash and restore without changing the open draft', async () => {
  await seed()
  const draft = structuredClone(repo.state.draft)
  await repo.manageSetlist({
    operation: 'rename',
    id: active().id,
    expectedRevision: active().revision,
    title: 'Sunday',
    date: '2026-10-11',
  })
  await repo.manageSetlist({
    operation: 'duplicate',
    id: active().id,
    expectedRevision: active().revision,
    title: 'Wednesday',
  })
  const duplicate = active(),
    p = repo.playlist()[0].presentation
  expect(duplicate.date).toBe('2026-10-11')
  await repo.manageSetlist({
    operation: 'delete',
    id: duplicate.id,
    expectedRevision: duplicate.revision,
  })
  expect(repo.state.activeSetlistId).toBeNull()
  expect(repo.playlist()).toEqual([])
  expect(repo.state.draft).toEqual(draft)
  const deleted = repo.state.setlists.find((x) => x.id === duplicate.id)!
  await repo.manageSetlist({
    operation: 'restore',
    id: deleted.id,
    expectedRevision: deleted.revision,
  })
  await open(deleted.id)
  expect(repo.playlist()[0].presentation.id).toBe(p.id)
  expect(repo.state.setlists.find((x) => x.id === deleted.id)?.deletedAt).toBeUndefined()
})
it('rejects stale setlist changes and failed disk replacement without committing new songs or lists', async () => {
  await seed()
  const before = structuredClone(repo.state),
    disk = await fs.readFile(repo.filename, 'utf8')
  await expect(
    repo.manageSetlist({
      operation: 'rename',
      id: active().id,
      expectedRevision: 900,
      title: 'stale',
    }),
  ).rejects.toThrow('변경')
  const rename = fs.rename.bind(fs)
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (to === repo.filename) throw new Error('disk failed')
    await rename(from, to)
  })
  await expect(create('not committed', true)).rejects.toThrow('disk failed')
  expect(repo.state).toEqual(before)
  expect(await fs.readFile(repo.filename, 'utf8')).toBe(disk)
})
it('imports the old workspace into v2 with frozen songs, preserves old bytes, IDs, order, draft and settings', async () => {
  const old = {
    ...repo.state,
    schemaVersion: 1,
    library: [song()],
    playlist: [
      { id: 'legacy-one', presentationId: 'a' },
      { id: 'legacy-repeat', presentationId: 'a' },
    ],
    draft: song(),
    settings: { stageCurrentFontSize: 95 },
  }
  const bytes = JSON.stringify(old),
    filename = path.join(dir, 'workspace-v1.json')
  await fs.writeFile(filename, bytes)
  const migrated = new Repository(dir)
  await migrated.open()
  expect(migrated.state.schemaVersion).toBe(2)
  expect(migrated.library()[0].id).toBe('a')
  expect(migrated.state.draft).toMatchObject({ id: 'a' })
  expect(migrated.state.settings.stageCurrentFontSize).toBe(95)
  expect(migrated.playlist().map((x) => x.id)).toEqual(['legacy-one', 'legacy-repeat'])
  expect(migrated.state.setlistSongs).toHaveLength(1)
  expect(await fs.readFile(filename, 'utf8')).toBe(bytes)
  const reopened = new Repository(dir)
  await reopened.open()
  expect(reopened.state.setlistSongs[0].presentation.id).toBe(
    migrated.state.setlistSongs[0].presentation.id,
  )
})
it('uses a valid old checkpoint during migration and blocks unrecoverable old data without replacing it', async () => {
  const old = { ...repo.state, schemaVersion: 1, library: [song()] }
  const filename = path.join(dir, 'workspace-v1.json')
  await fs.writeFile(filename, '{corrupt')
  await fs.writeFile(filename + '.bak1', JSON.stringify(old))
  const migrated = new Repository(dir)
  await migrated.open()
  expect(migrated.library()).toHaveLength(1)
  expect(migrated.warnings).toHaveLength(1)
  expect(await fs.readFile(filename, 'utf8')).toBe('{corrupt')
  await fs.rm(migrated.filename)
  await fs.rm(filename + '.bak1')
  const blocked = new Repository(dir)
  await blocked.open()
  await expect(blocked.saveDraft(song())).rejects.toThrow('원본')
  await expect(fs.stat(blocked.filename)).rejects.toThrow()
})
it('backs up and restores all archives, active order, snapshots and original separation', async () => {
  await seed()
  await create('second', true)
  const originalState = structuredClone(repo.state)
  const backup = await repo.exportProject(undefined)
  const other = new Repository(path.join(dir, 'other'))
  await other.open()
  await other.importProject(backup, true)
  expect(other.state.setlists).toEqual(originalState.setlists)
  expect(other.state.setlistSongs).toEqual(originalState.setlistSongs)
  expect(other.state.activeSetlistId).toBe(originalState.activeSetlistId)
  await other.saveDraft(song('a', 4))
  expect(other.playlist()[0].presentation.slides[0].content).toBe('lyrics 1')
})
it('exports the archived version and name after original changes, then imports a distinct setlist with songs in the library', async () => {
  await seed()
  await repo.manageSetlist({
    operation: 'rename',
    id: active().id,
    expectedRevision: active().revision,
    title: 'Historic worship',
    date: '2026-10-11',
  })
  await repo.saveDraft(song('a', 5))
  const data = await repo.exportPlaylist(repo.state.playlist),
    file = JSON.parse(data)
  expect(file.playlistName).toBe('Historic worship')
  expect(file.playlistDate).toBe('2026-10-11')
  expect(file.presentations[0].slides[0].content).toBe('lyrics 1')
  const other = new Repository(path.join(dir, 'other'))
  await other.open()
  await other.importProject(data, false, [])
  expect(other.state.setlists[0].title).toBe('Historic worship')
  expect(other.state.setlists[0].date).toBe('2026-10-11')
  expect(other.library()).toHaveLength(1)
  const saved = structuredClone(other.state.setlists[0])
  await other.importProject(data, false, other.state.playlist)
  expect(other.library()).toHaveLength(1)
  expect(other.state.setlists).toHaveLength(2)
  expect(other.state.setlists[0]).toEqual(saved)
  expect(other.state.setlists[1].items[0].presentationId).not.toBe(saved.items[0].presentationId)
})
it('retains media used only by a saved or trashed setlist', async () => {
  const file = path.join(dir, 'image.png')
  await fs.writeFile(file, 'fixture')
  const asset = await repo.register(file)
  await repo.saveDraft({
    ...song(),
    slides: [{ id: 's', type: 'image', backgroundUrl: repo.assetURL(asset) }],
  })
  await repo.setPlaylist([{ id: 'one', presentationId: 'a' }])
  await repo.delete('a')
  await repo.setMedia([])
  await repo.manageSetlist({
    operation: 'delete',
    id: active().id,
    expectedRevision: active().revision,
  })
  // Move past old checkpoints to prove retention comes from the setlist snapshots themselves.
  for (let i = 0; i < 6; i++) await repo.setSettings({ stageCurrentFontSize: 80 + i })
  expect(await repo.cleanup()).toBe(0)
  expect(await repo.assetPath(repo.assetURL(asset))).toBeTruthy()
})

it('rejects missing private-song recovery instead of inserting it into the original library', async () => {
  const p = { ...song(), id: 'setlist_missing' }
  await expect(repo.saveDraft(p)).rejects.toThrow('저장 위치')
  expect(repo.library()).toEqual([])
})
it('rejects invalid worship dates before changing a setlist', async () => {
  await seed()
  const before = structuredClone(repo.state)
  await expect(
    repo.manageSetlist({
      operation: 'rename',
      id: active().id,
      expectedRevision: active().revision,
      title: 'bad date',
      date: '2026-02-30',
    }),
  ).rejects.toThrow()
  expect(repo.state).toEqual(before)
})
