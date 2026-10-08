import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Repository } from '../electron/services/repository'
import { DEFAULT_STYLE } from '../shared/model'
import type { Presentation } from '../src/types'
const now = '2026-10-05T00:00:00.000Z'
const song = (id: string, content = id): Presentation => ({
  id,
  title: id,
  createdAt: now,
  updatedAt: now,
  revision: 1,
  globalSlideStyle: { ...DEFAULT_STYLE, fontSize: 72 },
  slides: [
    {
      id: `${id}-slide`,
      type: 'text',
      content,
      label: 'A · 1/1',
      labelColor: '#EC4899',
      borderColor: '#EC4899',
    },
  ],
})
let dir: string, source: Repository, target: Repository
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-playlist-unit-'))
  source = new Repository(path.join(dir, 'source'))
  target = new Repository(path.join(dir, 'target'))
  await source.open()
  await target.open()
  await source.saveDraft(song('a'))
  await source.saveDraft(song('b'))
  await source.saveDraft(song('unrelated'))
  await source.setPlaylist([
    { id: 'p1', presentationId: 'b' },
    { id: 'p2', presentationId: 'a' },
    { id: 'p3', presentationId: 'b' },
  ])
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})
const exported = () => source.exportPlaylist(source.state.playlist)
it('exports only the ordered songs, retaining repeats, part colors and style without personal workspace settings', async () => {
  await source.setSettings({ stageCurrentFontSize: 99 })
  const data = await exported(),
    file = JSON.parse(data)
  expect(file.kind).toBe('playlist')
  expect(file.presentations.map((p: Presentation) => p.title)).toEqual(['b', 'a'])
  expect(
    file.playlist.map(
      (p: { presentationId: string }) =>
        file.presentations.find((x: Presentation) => x.id === p.presentationId).title,
    ),
  ).toEqual(['b', 'a', 'b'])
  expect(file.presentations[0].slides[0].labelColor).toBe('#EC4899')
  expect(file.presentations[0].globalSlideStyle.fontSize).toBe(72)
  expect(file).not.toHaveProperty('settings')
  expect(file).not.toHaveProperty('draft')
  expect(file).not.toHaveProperty('media')
  expect(data).not.toContain('unrelated')
  expect(data).not.toContain(dir)
  expect(data).not.toContain('apiKey')
})
it('persists songs and the whole order together, keeps the open draft and settings, and reuses content after restart', async () => {
  await target.saveDraft(song('operator'))
  await target.setSettings({ stageCurrentFontSize: 87 })
  const draft = structuredClone(target.state.draft),
    data = await exported()
  const result = await target.importProject(data, false, [])
  expect(result).toMatchObject({ added: 2, reused: 0, restored: false })
  expect(target.state.draft).toEqual(draft)
  expect(target.state.settings.stageCurrentFontSize).toBe(87)
  expect(target.playlist().map((item) => item.presentation.title)).toEqual(['b', 'a', 'b'])
  expect(target.state.playlist[0].presentationId).toBe(target.state.playlist[2].presentationId)
  const reopened = new Repository(target.directory)
  await reopened.open()
  expect(reopened.state.library).toHaveLength(3)
  expect(await reopened.importProject(data, false, reopened.state.playlist)).toMatchObject({
    added: 0,
    reused: 2,
  })
  expect(reopened.state.library).toHaveLength(3)
})
it('ignores identity and timestamps when reusing exact contents but never overwrites title or ID collisions', async () => {
  await target.saveDraft({
    ...song('a'),
    slides: [{ ...song('a').slides[0], id: 'other-slide' }],
    revision: 8,
    updatedAt: '2026-10-05T01:00:00.000Z',
  })
  await target.saveDraft(song('b', 'operator lyrics'))
  const original = structuredClone(target.library())
  expect(await target.importProject(await exported(), false, [])).toMatchObject({
    added: 1,
    reused: 1,
  })
  expect(target.library().filter((p) => ['a', 'b'].includes(p.id))).toEqual(original)
  expect(target.playlist()[0].presentation.slides[0].content).toBe('b')
  const changed = JSON.parse(await exported())
  changed.presentations[0].slides[0].labelColor = '#10B981'
  expect(
    await target.importProject(JSON.stringify(changed), false, target.state.playlist),
  ).toMatchObject({ added: 1, reused: 1 })
  expect(target.library().find((p) => p.id === 'a')?.slides[0].labelColor).toBe('#EC4899')
})
it('rejects stale order on export and import before changing any songs', async () => {
  const before = structuredClone(source.state.playlist)
  await source.setPlaylist([])
  await expect(source.exportPlaylist(before)).rejects.toThrow('변경')
  await target.setPlaylist([
    { id: 'existing', presentationId: (await target.saveDraft(song('local')))[0].id },
  ])
  await source.setPlaylist(before)
  const state = structuredClone(target.state)
  await expect(target.importProject(await exported(), false, [])).rejects.toThrow('변경')
  expect(target.state).toEqual(state)
})
it.each(['orphan', 'extra-song', 'future', 'settings', 'duplicate-item', 'wrong-kind'])(
  'rejects invalid %s files without partial changes',
  async (caseName) => {
    const file = JSON.parse(await exported())
    if (caseName === 'orphan') file.playlist[0].presentationId = 'missing'
    if (caseName === 'extra-song') file.presentations.push(song('hidden'))
    if (caseName === 'future') file.schemaVersion = 2
    if (caseName === 'settings') file.settings = { stageCurrentFontSize: 80 }
    if (caseName === 'duplicate-item') file.playlist[1].id = file.playlist[0].id
    if (caseName === 'wrong-kind') file.kind = 'presentation'
    const state = structuredClone(target.state)
    await expect(target.importProject(JSON.stringify(file), false, [])).rejects.toThrow()
    expect(target.state).toEqual(state)
  },
)
it('requires the playlist entry point and an order before saving', async () => {
  await expect(target.importProject(await exported())).rejects.toThrow('불러오기 버튼')
  await source.setPlaylist([])
  await expect(exported()).rejects.toThrow('추가')
})
async function withMedia() {
  const filename = path.join(dir, 'image.png')
  await fs.writeFile(filename, 'synthetic image bytes')
  const asset = await source.register(filename)
  const snapshot = source.playlist()[1].presentation
  await source.saveDraft({
    ...snapshot,
    slides: [
      {
        ...song('a').slides[0],
        backgroundUrl: source.assetURL(asset),
        content: `keep media://asset/${asset.id}/ literally`,
      },
    ],
    revision: 2,
  })
  return asset
}
it('carries referenced media only, resolves asset collisions, and avoids duplicate songs/assets on repeated import', async () => {
  const asset = await withMedia()
  const unused = path.join(dir, 'unused.png')
  await fs.writeFile(unused, 'unused')
  await source.register(unused)
  const data = await exported()
  expect(JSON.parse(data).assets).toHaveLength(1)
  // Simulate an existing local registration using the same ID for different bytes.
  await fs.mkdir(target.mediaDir, { recursive: true })
  await fs.writeFile(path.join(target.mediaDir, asset.filename), 'different')
  await target.transaction((s) => {
    s.assets.push(asset)
  })
  const result = await target.importProject(data, false, [])
  expect(result.added).toBe(2)
  const imported = target.playlist()[1].presentation.slides[0]
  expect(imported.content).toContain(`media://asset/${asset.id}/`)
  expect(imported.backgroundUrl).not.toContain(asset.id)
  expect(await fs.readFile(await target.assetPath(imported.backgroundUrl!), 'utf8')).toBe(
    'synthetic image bytes',
  )
  expect(await target.importProject(data, false, target.state.playlist)).toMatchObject({
    added: 0,
    reused: 2,
  })
  expect(target.state.assets).toHaveLength(2)
  expect(target.library()).toHaveLength(2)
})
it('rolls back created media and songs when the atomic file replacement fails, and rejects tampered media', async () => {
  await withMedia()
  await target.saveDraft(song('operator'))
  const state = structuredClone(target.state),
    disk = await fs.readFile(target.filename, 'utf8')
  const data = await exported()
  const rename = fs.rename.bind(fs)
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (to === target.filename)
      throw Object.assign(new Error('synthetic disk failure'), { code: 'EIO' })
    await rename(from, to)
  })
  await expect(target.importProject(data, false, [])).rejects.toThrow('synthetic disk failure')
  expect(target.state).toEqual(state)
  expect(await fs.readFile(target.filename, 'utf8')).toBe(disk)
  expect(await fs.readdir(target.mediaDir)).toEqual([])
  vi.restoreAllMocks()
  const file = JSON.parse(data)
  file.assets[0].data = Buffer.from('tampered').toString('base64')
  await expect(target.importProject(JSON.stringify(file), false, [])).rejects.toThrow('무결성')
  expect(target.state).toEqual(state)
  expect(await fs.readdir(target.mediaDir)).toEqual([])
})
it('rechecks the order inside the final transaction and cleans up staged media on conflict', async () => {
  await withMedia()
  await target.saveDraft(song('operator'))
  const original = target.transaction.bind(target)
  vi.spyOn(target, 'transaction').mockImplementationOnce(async (change) => {
    await target.setPlaylist([{ id: 'operator-order', presentationId: 'operator' }])
    await original(change)
  })
  await expect(target.importProject(await exported(), false, [])).rejects.toThrow('변경')
  expect(target.library()).toHaveLength(1)
  expect(target.state.playlist[0].id).toBe('operator-order')
  expect(target.state.assets).toEqual([])
  expect(await fs.readdir(target.mediaDir)).toEqual([])
})
it('fails export when a required media file is missing', async () => {
  const asset = await withMedia()
  await fs.rm(path.join(source.mediaDir, asset.filename))
  await expect(exported()).rejects.toThrow()
})
