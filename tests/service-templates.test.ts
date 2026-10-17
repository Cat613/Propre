import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { Repository } from '../electron/services/repository'
import { mutateTemplate } from '../electron/services/service-templates'
import { TemplateCommand } from '../shared/service-template'
import { parseProject } from '../shared/schema'
let dir: string, repo: Repository
const now = '2026-10-16T00:00:00.000Z'
const song = {
  id: 'song',
  title: '합성 원곡',
  slides: [{ id: 'slide', type: 'text' as const, content: '보존할 합성 가사' }],
  revision: 1,
  createdAt: now,
  updatedAt: now,
}
const active = () => repo.state.setlists.find((list) => list.id === repo.state.activeSetlistId)!
const template = () => repo.state.serviceTemplates.at(-1)!
async function save(fixedCueIds: string[] = []) {
  await repo.manageServiceTemplate({
    action: 'save-from-service',
    requestId: randomUUID(),
    setlistId: active().id,
    expectedRevision: active().revision,
    name: '합성 템플릿',
    description: '합성 설명',
    includeLeaders: false,
    includeOperatorNotes: false,
    includeStageNotes: false,
    fixedCueIds,
  })
}
const generate = (slots: Record<string, unknown> = {}) => ({
  action: 'instantiate' as const,
  requestId: randomUUID(),
  id: template().id,
  expectedRevision: template().revision,
  title: '새 합성 예배',
  date: '2026-10-18',
  expectedActiveId: repo.state.activeSetlistId,
  expectedActiveRevision: active()?.revision ?? null,
  slots,
})
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-template-unit-'))
  repo = new Repository(dir)
  await repo.open()
  await repo.saveDraft(song)
  await repo.setPlaylist([{ id: 'row', presentationId: 'song' }])
  const plan = structuredClone(active().servicePlan!)
  plan.items[0].leader = '제외할 담당자'
  plan.items[0].operatorNote = '제외할 운영 메모'
  plan.items[0].stageNote = '제외할 무대 초안'
  plan.items.push({
    id: 'prayer',
    kind: 'prayer',
    title: '합성 기도',
    durationSeconds: 60,
    enter: { visual: 'keep', audio: 'keep' },
  })
  await repo.saveServicePlan({
    requestId: randomUUID(),
    setlistId: active().id,
    expectedSetlistRevision: active().revision,
    plan,
  })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})
it('defaults to reusable slots and excludes personal/date/runtime fields, without changing the current service or draft', async () => {
  const before = structuredClone(repo.state),
    original = active().id
  await save()
  expect(repo.state.setlists).toEqual(before.setlists)
  expect(repo.state.draft).toEqual(before.draft)
  expect(repo.state.activeSetlistId).toBe(original)
  expect(template().items.every((item) => item.materialMode === 'slot')).toBe(true)
  const data = await repo.exportServiceTemplate(template().id, template().revision)
  expect(data).not.toContain('제외할')
  expect(data).not.toContain('startedAt')
  expect(data).not.toContain('2026-10-18')
  expect(data).not.toContain(dir)
  expect(parseProject(data).portable?.kind).toBe('service-template')
})
it('fixed snapshots survive original/source/template mutations and create independent services with fresh identities', async () => {
  await save([active().servicePlan!.items[0].id])
  const fixed = structuredClone(template()),
    firstService = active().id
  const cmd = generate()
  const [a, b] = await Promise.all([
    repo.manageServiceTemplate(cmd),
    repo.manageServiceTemplate(cmd),
  ])
  expect(a).toEqual(b)
  expect(repo.state.setlists).toHaveLength(2)
  const created = structuredClone(active()),
    draft = structuredClone(repo.state.draft)
  expect(created.id).not.toBe(firstService)
  expect(repo.playlist()[0].presentation.slides[0].content).toBe('보존할 합성 가사')
  expect(repo.state.draft).toEqual(draft)
  await repo.saveDraft({
    ...song,
    revision: 2,
    slides: [{ ...song.slides[0], content: '바뀐 원곡' }],
  })
  const editing = template()
  await repo.manageServiceTemplate({
    action: 'update',
    requestId: randomUUID(),
    id: editing.id,
    expectedRevision: editing.revision,
    name: '수정 템플릿',
    description: '',
    items: editing.items.map((item) => ({ ...item, title: '새 템플릿 제목' })),
    sources: {},
  })
  expect(repo.state.setlists.find((list) => list.id === created.id)).toEqual(created)
  expect(template().presentations[0].slides[0].content).toBe(
    fixed.presentations[0].slides[0].content,
  )
  await repo.manageServiceTemplate(generate())
  expect(active().items[0].presentationId).not.toBe(created.items[0].presentationId)
})
it('allows unfinished slots with explicit pending state and fills a song slot without touching the original', async () => {
  await save()
  await repo.manageServiceTemplate(generate())
  const cue = active().servicePlan!.items[0],
    row = active().items[0]
  expect(cue.materialPending).toBe(true)
  expect(repo.playlist()[0].presentation.slides).toEqual([])
  await repo.attachServiceCue({
    requestId: randomUUID(),
    setlistId: active().id,
    cueId: cue.id,
    expectedSetlistRevision: active().revision,
    source: { kind: 'presentation', id: song.id, slideId: 'slide' },
  })
  expect(active().servicePlan!.items[0].materialPending).toBeUndefined()
  expect(active().items[0].id).toBe(row.id)
  expect(repo.playlist()[0].presentation.id).not.toBe(song.id)
  expect(repo.library()[0].slides[0].content).toBe('보존할 합성 가사')
})
it('fills slots with revision checks, rejects stale active/template/source and rolls back failed generation for same-request retry', async () => {
  await save()
  const cmd = generate({
    [template().items[0].id]: { kind: 'presentation', id: song.id, revision: 1, slideId: 'slide' },
  })
  const before = structuredClone(repo.state)
  for (const change of [
    { expectedRevision: 999 },
    { expectedActiveRevision: 999 },
    {
      slots: {
        [template().items[0].id]: {
          kind: 'presentation',
          id: song.id,
          revision: 999,
          slideId: 'slide',
        },
      },
    },
  ])
    await expect(repo.manageServiceTemplate({ ...cmd, ...change })).rejects.toThrow('바뀌')
  expect(repo.state).toEqual(before)
  vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('synthetic disk failure'))
  await expect(repo.manageServiceTemplate(cmd)).rejects.toThrow('disk failure')
  expect(repo.state).toEqual(before)
  vi.restoreAllMocks()
  await repo.manageServiceTemplate(cmd)
  expect(active().servicePlan!.items[0].title).toBe(song.title)
  expect(active().servicePlan!.items[0].materialPending).toBeUndefined()
})
it('duplicates, soft-deletes/restores and round trips templates in a full backup without sharing service references', async () => {
  await save([active().servicePlan!.items[0].id])
  const original = structuredClone(template())
  await repo.manageServiceTemplate({
    action: 'duplicate',
    requestId: randomUUID(),
    id: original.id,
    expectedRevision: original.revision,
  })
  expect(template().items[0].id).not.toBe(original.items[0].id)
  expect(template().presentations[0].id).not.toBe(original.presentations[0].id)
  await repo.manageServiceTemplate({
    action: 'delete',
    requestId: randomUUID(),
    id: template().id,
    expectedRevision: template().revision,
  })
  const backup = await repo.exportProject(undefined),
    restored = new Repository(path.join(dir, 'restored'))
  await restored.open()
  await restored.importProject(backup, true)
  expect(restored.state.serviceTemplates).toEqual(repo.state.serviceTemplates)
  const trash = template()
  await repo.manageServiceTemplate({
    action: 'restore',
    requestId: randomUUID(),
    id: trash.id,
    expectedRevision: trash.revision,
  })
  expect(template().deletedAt).toBeUndefined()
})
it('exports owned PDF/media only, remaps all IDs and PDF assets on import, and reuses hashes on repeated import', async () => {
  const image = path.join(dir, 'synthetic.png')
  await fs.writeFile(image, 'synthetic image')
  const asset = await repo.register(image),
    p = repo.playlist()[0].presentation
  await repo.saveDraft({
    ...p,
    revision: 2,
    slides: [
      {
        ...p.slides[0],
        backgroundUrl: repo.assetURL(asset),
        content: `literal media://asset/${asset.id}/`,
      },
    ],
  })
  const doc = await PDFDocument.create()
  doc.addPage([100, 150])
  const pdf = path.join(dir, 'fixture.pdf')
  await fs.writeFile(pdf, await doc.save())
  await repo.registerPDF(pdf)
  const plan = structuredClone(active().servicePlan!)
  plan.items[1].binding = {
    kind: 'resource',
    resourceId: repo.state.outputResources[0].id,
    page: 1,
    rotation: 90,
  }
  plan.items[1].enter.visual = 'bound'
  await repo.attachServiceCue({
    requestId: randomUUID(),
    setlistId: active().id,
    expectedSetlistRevision: active().revision,
    cueId: 'prayer',
    plan,
    source: { kind: 'resource', id: repo.state.outputResources[0].id, page: 1, rotation: 90 },
  })
  await save(active().servicePlan!.items.map((cue) => cue.id))
  const original = structuredClone(template()),
    data = await repo.exportServiceTemplate(template().id, template().revision)
  expect(JSON.parse(data).assets).toHaveLength(2)
  await repo.importProject(data, false, undefined, false, undefined, true)
  expect(template().id).not.toBe(original.id)
  expect(template().presentations[0].id).not.toBe(original.presentations[0].id)
  expect(template().resources[0].id).not.toBe(original.resources[0].id)
  expect(repo.state.assets).toHaveLength(2)
  await repo.importProject(data, false, undefined, false, undefined, true)
  expect(repo.state.assets).toHaveLength(2)
  expect(template().presentations[0].slides[0].content).toContain(`media://asset/${asset.id}/`)
  const bad = JSON.parse(data)
  bad.serviceTemplates[0].items[0].binding.presentationId = 'missing'
  await expect(
    repo.importProject(JSON.stringify(bad), false, undefined, false, undefined, true),
  ).rejects.toThrow()
  await expect(repo.importProject(data)).rejects.toThrow('템플릿 파일')
})
it('enforces the template cap and structural validation atomically', async () => {
  await save()
  const before = structuredClone(repo.state)
  await expect(
    repo.transaction((state) => {
      const entry = state.serviceTemplates[0]
      state.serviceTemplates = Array.from({ length: 201 }, (_, index) => ({
        ...entry,
        id: `template-${index}`,
      }))
    }),
  ).rejects.toThrow()
  expect(repo.state).toEqual(before)
  expect(() =>
    mutateTemplate(
      structuredClone(before),
      TemplateCommand.parse({
        action: 'update',
        requestId: randomUUID(),
        id: template().id,
        expectedRevision: template().revision,
        name: '손상',
        description: '',
        items: [
          {
            ...template().items[0],
            materialMode: 'fixed',
            binding: { kind: 'presentation', presentationId: 'foreign', slideId: 'slide' },
          },
        ],
        sources: {},
      }),
    ),
  ).toThrow('고정 슬라이드')
})

it('protects fixed template-only media from cleanup and relinking after original services are removed', async () => {
  const file = path.join(dir, 'only-template.png')
  await fs.writeFile(file, 'template bytes')
  const asset = await repo.register(file),
    p = repo.playlist()[0].presentation
  await repo.saveDraft({
    ...p,
    revision: 2,
    slides: [{ ...p.slides[0], backgroundUrl: repo.assetURL(asset) }],
  })
  await save([active().servicePlan!.items[0].id])
  await repo.transaction((state) => {
    state.library = []
    state.setlists = []
    state.setlistSongs = []
    state.playlist = []
    state.activeSetlistId = null
    state.draft = null
    state.media = []
    state.deletedLibrary = []
    state.deletedMedia = []
  })
  for (let index = 0; index < 6; index++)
    await repo.setSettings({ stageCurrentFontSize: 80 + index })
  await repo.cleanup()
  expect(repo.state.assets.some((entry) => entry.id === asset.id)).toBe(true)
  await fs.writeFile(file, 'replacement')
  await expect(repo.relink(asset.id, file)).rejects.toThrow('예배 사본')
  expect(await fs.readFile(path.join(repo.mediaDir, asset.filename), 'utf8')).toBe('template bytes')
})

it('remaps a colliding PDF asset on template import without overwriting the target registration', async () => {
  const pdf = await PDFDocument.create()
  pdf.addPage([100, 150])
  const file = path.join(dir, 'fixture.pdf')
  await fs.writeFile(file, await pdf.save())
  await repo.registerPDF(file)
  const plan = structuredClone(active().servicePlan!)
  plan.items[1].binding = {
    kind: 'resource',
    resourceId: repo.state.outputResources[0].id,
    page: 1,
    rotation: 0,
  }
  plan.items[1].enter.visual = 'bound'
  await repo.attachServiceCue({
    requestId: randomUUID(),
    setlistId: active().id,
    cueId: 'prayer',
    expectedSetlistRevision: active().revision,
    plan,
    source: { kind: 'resource', id: repo.state.outputResources[0].id, page: 1 },
  })
  await save(['prayer'])
  const data = await repo.exportServiceTemplate(template().id, template().revision),
    asset = repo.state.assets[0],
    target = new Repository(path.join(dir, 'collision'))
  await target.open()
  await fs.mkdir(target.mediaDir, { recursive: true })
  await fs.writeFile(path.join(target.mediaDir, asset.filename), 'other PDF bytes')
  await target.transaction((state) => state.assets.push(asset))
  await target.importProject(data, false, undefined, false, undefined, true)
  const imported = target.state.serviceTemplates[0].resources[0]
  expect(imported.kind).toBe('pdf')
  if (imported.kind !== 'pdf') throw new Error('expected PDF')
  expect(imported.assetId).not.toBe(asset.id)
  expect(await fs.readFile(path.join(target.mediaDir, asset.filename), 'utf8')).toBe(
    'other PDF bytes',
  )
  expect(
    await fs.readFile(
      path.join(
        target.mediaDir,
        target.state.assets.find((entry) => entry.id === imported.assetId)!.filename,
      ),
    ),
  ).toEqual(await fs.readFile(file))
})
