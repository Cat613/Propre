import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { Repository } from '../electron/services/repository'
import type { ServicePlan } from '../shared/service-plan'
let dir: string, source: Repository, target: Repository
const now = '2026-10-16T00:00:00.000Z'
const song = {
  id: 'song',
  title: '합성 찬양',
  slides: [{ id: 'slide', type: 'text' as const, content: '합성 가사' }],
  createdAt: now,
  updatedAt: now,
  revision: 1,
}
const list = (repo: Repository) =>
  repo.state.setlists.find((x) => x.id === repo.state.activeSetlistId)!
const expected = () => ({
  activeId: target.state.activeSetlistId,
  revision: list(target)?.revision ?? null,
})
const exported = () => source.exportService(list(source).id, list(source).revision)
const load = (data: string) => target.importProject(data, false, undefined, false, expected())
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-service-files-'))
  source = new Repository(path.join(dir, 'source'))
  target = new Repository(path.join(dir, 'target'))
  await source.open()
  await target.open()
  await source.saveDraft(song)
  await source.setPlaylist([
    { id: 'row1', presentationId: song.id },
    { id: 'row2', presentationId: song.id },
  ])
  const image = path.join(dir, 'synthetic.png')
  await fs.writeFile(image, 'synthetic image')
  const asset = await source.register(image)
  const copy = source.playlist()[0].presentation
  await source.saveDraft({
    ...copy,
    revision: 2,
    slides: [
      {
        ...copy.slides[0],
        backgroundUrl: source.assetURL(asset),
        content: `literal media://asset/${asset.id}/ unchanged`,
      },
    ],
  })
  const doc = await PDFDocument.create()
  doc.addPage([100, 150])
  doc.addPage([100, 150])
  const pdf = path.join(dir, 'synthetic.pdf')
  await fs.writeFile(pdf, await doc.save())
  await source.registerPDF(pdf)
  const plan: ServicePlan = structuredClone(list(source).servicePlan!)
  plan.items.splice(1, 0, {
    id: 'sermon',
    kind: 'sermon',
    title: '합성 설교',
    leader: '합성 담당자',
    operatorNote: '비공개 메모',
    durationSeconds: 600,
    binding: {
      kind: 'resource',
      resourceId: source.state.outputResources[0].id,
      page: 2,
      rotation: 90,
    },
    enter: { visual: 'bound', audio: 'stop' },
  })
  await source.attachServiceCue({
    requestId: randomUUID(),
    setlistId: list(source).id,
    expectedSetlistRevision: list(source).revision,
    cueId: 'sermon',
    plan,
    source: { kind: 'resource', id: source.state.outputResources[0].id, page: 2, rotation: 90 },
  })
  await target.saveDraft({ ...song, id: 'operator', title: '보존할 편집' })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})
it('exports only one service with notes, independent song copies, owned PDF and referenced assets', async () => {
  await source.saveDraft({ ...song, id: 'unrelated', title: '제외할 원곡' })
  await source.setSettings({ stageCurrentFontSize: 99 })
  const data = await exported(),
    file = JSON.parse(data)
  expect(file.kind).toBe('service')
  expect(file.schemaVersion).toBe(3)
  expect(file.setlists).toHaveLength(1)
  expect(file.presentations).toEqual([])
  expect(file.setlistSongs).toHaveLength(1)
  expect(file.cueResources).toHaveLength(1)
  expect(file.assets).toHaveLength(2)
  expect(file.setlists[0].servicePlan.items[1]).toMatchObject({
    operatorNote: '비공개 메모',
    binding: { page: 2, rotation: 90 },
  })
  for (const field of ['settings', 'draft', 'media', 'outputResources'])
    expect(file).not.toHaveProperty(field)
  expect(data).not.toContain('제외할 원곡')
  expect(data).not.toContain(dir)
})
it('imports fresh identities and repeated rows, keeps library/draft/settings and reuses assets across imports and restart', async () => {
  await target.setSettings({ stageCurrentFontSize: 87 })
  const draft = structuredClone(target.state.draft),
    library = structuredClone(target.state.library),
    original = structuredClone(list(source)),
    data = await exported()
  await load(data)
  const first = structuredClone(list(target))
  expect(first.title).toBe(original.title)
  expect(first.id).not.toBe(original.id)
  expect(first.items[0].presentationId).toBe(first.items[1].presentationId)
  expect(first.items[0].id).not.toBe(original.items[0].id)
  expect(first.items[0].presentationId).not.toBe(original.items[0].presentationId)
  expect(first.servicePlan!.items[1].id).not.toBe('sermon')
  expect(first.servicePlan!.items[1].binding).toMatchObject({ page: 2, rotation: 90 })
  expect(target.state.library).toEqual(library)
  expect(target.state.draft).toEqual(draft)
  expect(target.state.settings.stageCurrentFontSize).toBe(87)
  const reopened = new Repository(target.directory)
  await reopened.open()
  target = reopened
  await load(data)
  expect(list(target).id).not.toBe(first.id)
  expect(target.state.assets).toHaveLength(2)
  expect(target.state.cueResources).toHaveLength(2)
  expect(target.state.setlists.find((x) => x.id === first.id)).toEqual(first)
})
it('remaps colliding media IDs without changing literal note/text values or existing local files', async () => {
  const data = await exported(),
    file = JSON.parse(data),
    asset = file.assets.find((a: { type: string }) => a.type === 'image')
  await fs.mkdir(target.mediaDir, { recursive: true })
  await fs.writeFile(path.join(target.mediaDir, asset.id + '.png'), 'other image')
  await target.transaction((s) => {
    s.assets.push({
      id: asset.id,
      name: 'local',
      type: 'image',
      extension: '.png',
      filename: asset.id + '.png',
    })
  })
  await load(data)
  const imported = target.playlist()[0].presentation.slides[0]
  expect(imported.content).toContain(`media://asset/${asset.id}/`)
  expect(imported.backgroundUrl).not.toContain(asset.id)
  expect(await fs.readFile(await target.assetPath(imported.backgroundUrl!), 'utf8')).toBe(
    'synthetic image',
  )
  expect(await fs.readFile(path.join(target.mediaDir, asset.id + '.png'), 'utf8')).toBe(
    'other image',
  )
  await load(data)
  expect(target.state.assets).toHaveLength(3)
})
it.each(['owner', 'page', 'projection', 'extra-song', 'extra-asset', 'settings', 'hash'] as const)(
  'rejects %s corruption without changes',
  async (name) => {
    const file = JSON.parse(await exported()),
      before = structuredClone(target.state)
    if (name === 'owner') file.cueResources[0].ownerSetlistId = 'other'
    if (name === 'page') file.setlists[0].servicePlan.items[1].binding.page = 3
    if (name === 'projection') file.setlists[0].servicePlan.items[0].songItemId = 'missing'
    if (name === 'extra-song') file.setlistSongs.push({ presentation: { ...song, id: 'extra' } })
    if (name === 'extra-asset') file.assets.push({ ...file.assets[0], id: 'extra' })
    if (name === 'settings') file.settings = { stageCurrentFontSize: 90 }
    if (name === 'hash') file.assets[0].data = Buffer.from('tampered').toString('base64')
    await expect(load(JSON.stringify(file))).rejects.toThrow()
    expect(target.state).toEqual(before)
    expect(await fs.readdir(target.mediaDir).catch(() => [])).toEqual([])
  },
)
it('checks active service revision again at commit and removes all staged assets on conflict or disk failure', async () => {
  await target.setPlaylist([{ id: 'existing', presentationId: 'operator' }])
  const data = await exported(),
    before = structuredClone(target.state),
    transaction = target.transaction.bind(target)
  vi.spyOn(target, 'transaction').mockImplementationOnce(async (change) => {
    throw new Error('synthetic disk failure')
  })
  await expect(load(data)).rejects.toThrow('disk failure')
  expect(target.state).toEqual(before)
  expect(await fs.readdir(target.mediaDir)).toEqual([])
  vi.restoreAllMocks()
  vi.spyOn(target, 'transaction').mockImplementationOnce(async (change) => {
    await transaction((state) => {
      state.activeSetlistId = null
      state.playlist = []
    })
    await transaction(change)
  })
  await expect(load(data)).rejects.toThrow('변경')
  expect(target.state.assets).toEqual([])
  expect(await fs.readdir(target.mediaDir)).toEqual([])
})
it('requires the dedicated entry point and rejects stale export revisions', async () => {
  const data = await exported()
  await expect(target.importProject(data)).rejects.toThrow('예배 파일')
  await expect(source.exportService(list(source).id, 999)).rejects.toThrow('변경')
})
it('protects snapshotted media bytes from relink while allowing restoration of identical bytes', async () => {
  const asset = source.state.assets.find((a) => a.type === 'image')!,
    replacement = path.join(dir, 'replacement.png')
  await fs.writeFile(replacement, 'changed')
  await expect(source.relink(asset.id, replacement)).rejects.toThrow('예배 사본')
  await fs.writeFile(replacement, 'synthetic image')
  await source.relink(asset.id, replacement)
  expect(await fs.readFile(path.join(source.mediaDir, asset.filename), 'utf8')).toBe(
    'synthetic image',
  )
})
