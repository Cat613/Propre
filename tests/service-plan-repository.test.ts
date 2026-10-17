import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Repository } from '../electron/services/repository'
import type { ServicePlan } from '../shared/service-plan'
let dir: string, repo: Repository
const now = '2026-10-16T00:00:00.000Z'
const song = {
  id: 'song',
  title: '합성 찬양',
  slides: [{ id: 'slide', type: 'text' as const, content: '합성 가사' }],
  createdAt: now,
  updatedAt: now,
  revision: 1,
}
const active = () => repo.state.setlists.find((list) => list.id === repo.state.activeSetlistId)!
const command = (plan: ServicePlan) => ({
  requestId: randomUUID(),
  setlistId: active().id,
  expectedSetlistRevision: active().revision,
  plan,
})
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-service-storage-'))
  repo = new Repository(dir)
  await repo.open()
  await repo.saveDraft(song)
  await repo.setPlaylist([
    { id: 'one', presentationId: 'song' },
    { id: 'two', presentationId: 'song' },
  ])
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})
function withPrayer() {
  const plan = structuredClone(active().servicePlan!)
  plan.items.splice(1, 0, {
    id: 'prayer',
    kind: 'prayer',
    title: '대표기도',
    operatorNote: '비공개 합성 메모',
    enter: { visual: 'keep', audio: 'keep' },
  })
  return plan
}
it('migrates v3 with snapshots and draft intact, preserving source and all checkpoints byte-for-byte', async () => {
  const legacy = {
    ...repo.state,
    schemaVersion: 3,
    cuePresentations: undefined,
    cueResources: undefined,
    setlists: repo.state.setlists.map(({ servicePlan: _plan, ...list }) => list),
  }
  const bytes = JSON.stringify(legacy)
  await fs.writeFile(path.join(dir, 'workspace-v3.json'), bytes)
  await fs.writeFile(path.join(dir, 'workspace-v3.json.bak1'), bytes)
  await fs.rm(repo.filename)
  const migrated = new Repository(dir)
  await migrated.open()
  expect(migrated.state.schemaVersion).toBe(5)
  expect(migrated.playlist()).toEqual(repo.playlist())
  expect(migrated.state.draft).toEqual(repo.state.draft)
  expect(migrated.state.setlists[0].servicePlan?.items.map((cue) => cue.songItemId)).toEqual([
    'one',
    'two',
  ])
  expect(await fs.readFile(path.join(dir, 'workspace-v3.json'), 'utf8')).toBe(bytes)
  expect(await fs.readFile(path.join(dir, 'workspace-v3.json.bak1'), 'utf8')).toBe(bytes)
})
it('atomically saves mixed order and keeps non-song cues through existing song reorder/removal', async () => {
  await repo.saveServicePlan(command(withPrayer()))
  await repo.setPlaylist([...repo.state.playlist].reverse())
  expect(active().servicePlan?.items.map((cue) => cue.songItemId || cue.id)).toEqual([
    'two',
    'prayer',
    'one',
  ])
  await repo.setPlaylist([repo.state.playlist[1]])
  expect(active().servicePlan?.items.map((cue) => cue.songItemId || cue.id)).toEqual([
    'prayer',
    'one',
  ])
  const reopened = new Repository(dir)
  await reopened.open()
  expect(reopened.state).toEqual(repo.state)
})
it('deduplicates concurrent requests and refuses changed content with the same request ID', async () => {
  const cmd = command(withPrayer())
  const revision = active().revision
  const [first, second] = await Promise.all([repo.saveServicePlan(cmd), repo.saveServicePlan(cmd)])
  expect(first).toEqual(second)
  expect(active().revision).toBe(revision + 1)
  first.setlists[0].title = 'mutated return'
  expect((await repo.saveServicePlan(cmd)).setlists[0].title).not.toBe('mutated return')
  await expect(repo.saveServicePlan({ ...cmd, plan: { ...cmd.plan, items: [] } })).rejects.toThrow(
    '요청 ID',
  )
})
it('rejects stale edits, unknown song rows and cross-owner bindings without changing disk', async () => {
  const cmd = command(withPrayer())
  const before = await fs.readFile(repo.filename, 'utf8')
  await expect(repo.saveServicePlan({ ...cmd, expectedSetlistRevision: 999 })).rejects.toThrow(
    '변경',
  )
  const bad = structuredClone(cmd)
  bad.plan.items[0].songItemId = 'missing'
  await expect(repo.saveServicePlan(bad)).rejects.toThrow()
  const wrongBinding = withPrayer()
  wrongBinding.items[1].binding = { kind: 'presentation', presentationId: 'song', slideId: 'slide' }
  await expect(repo.saveServicePlan(command(wrongBinding))).rejects.toThrow('슬라이드')
  expect(await fs.readFile(repo.filename, 'utf8')).toBe(before)
})
it('rolls back disk failure and allows retry of the same request', async () => {
  const cmd = command(withPrayer())
  const state = structuredClone(repo.state)
  const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('synthetic disk failure'))
  await expect(repo.saveServicePlan(cmd)).rejects.toThrow('disk failure')
  expect(repo.state).toEqual(state)
  rename.mockRestore()
  await repo.saveServicePlan(cmd)
  expect(active().servicePlan?.items).toHaveLength(3)
})
it('duplicates plan, notes, rows and owned presentation snapshots independently', async () => {
  await repo.transaction((s) => {
    s.cuePresentations.push({
      ownerSetlistId: active().id,
      presentation: { ...song, id: 'cue-owned' },
    })
  })
  const plan = withPrayer()
  plan.items[1].binding = { kind: 'presentation', presentationId: 'cue-owned', slideId: 'slide' }
  await repo.saveServicePlan(command(plan))
  const original = structuredClone(active())
  await repo.manageSetlist({
    operation: 'duplicate',
    id: original.id,
    expectedRevision: original.revision,
    title: '복사 예배',
  })
  const copy = active()
  expect(copy.items[0].id).not.toBe(original.items[0].id)
  expect(copy.items[0].presentationId).not.toBe(original.items[0].presentationId)
  expect(copy.servicePlan?.items.map((cue) => cue.id)).not.toEqual(
    original.servicePlan?.items.map((cue) => cue.id),
  )
  expect(copy.servicePlan?.items[1].operatorNote).toBe('비공개 합성 메모')
  expect(copy.servicePlan?.items[1].binding).not.toEqual(original.servicePlan?.items[1].binding)
  expect(
    repo.state.cuePresentations.filter((entry) => entry.ownerSetlistId === copy.id),
  ).toHaveLength(1)
})
it('round trips schema-3 backup with plans and owned documents, including deleted setlists', async () => {
  await repo.transaction((s) => {
    s.cuePresentations.push({
      ownerSetlistId: active().id,
      presentation: { ...song, id: 'cue-owned' },
    })
  })
  const plan = withPrayer()
  plan.items[1].binding = { kind: 'presentation', presentationId: 'cue-owned', slideId: 'slide' }
  await repo.saveServicePlan(command(plan))
  await repo.manageSetlist({
    operation: 'delete',
    id: active().id,
    expectedRevision: active().revision,
  })
  const backup = await repo.exportProject(undefined)
  expect(JSON.parse(backup).schemaVersion).toBe(4)
  const restored = new Repository(path.join(dir, 'target'))
  await restored.open()
  await restored.importProject(backup, true)
  expect(restored.state.setlists).toEqual(repo.state.setlists)
  expect(restored.state.cuePresentations).toEqual(repo.state.cuePresentations)
})
it('blocks a future workspace without falling back to older checkpoints or modifying it', async () => {
  const bytes = JSON.stringify({ ...repo.state, schemaVersion: 6 })
  await fs.writeFile(repo.filename, bytes)
  const reopened = new Repository(dir)
  await reopened.open()
  expect(reopened.warnings.join(' ')).toContain('새로운 앱')
  await expect(reopened.saveDraft(song)).rejects.toThrow('원본')
  expect(await fs.readFile(repo.filename, 'utf8')).toBe(bytes)
})
it('rejects malformed v4 projection rather than repairing it silently', async () => {
  const before = structuredClone(repo.state)
  await expect(
    repo.transaction((s) => {
      s.setlists[0].servicePlan!.items.reverse()
    }),
  ).rejects.toThrow('일치')
  expect(repo.state).toEqual(before)
})
it('preserves legacy song lists above the new authoring limit instead of dropping rows', async () => {
  const legacyRows = Array.from({ length: 1001 }, (_, index) => ({
    id: `legacy-${index}`,
    presentationId: active().items[0].presentationId,
  }))
  const legacy = {
    ...repo.state,
    schemaVersion: 3,
    playlist: legacyRows,
    setlists: repo.state.setlists.map(({ servicePlan: _plan, ...list }) => ({
      ...list,
      items: legacyRows,
    })),
  }
  await fs.writeFile(path.join(dir, 'workspace-v3.json'), JSON.stringify(legacy))
  await fs.rm(repo.filename)
  const migrated = new Repository(dir)
  await migrated.open()
  expect(migrated.state.setlists[0].servicePlan?.items).toHaveLength(1001)
  expect(migrated.warnings).toEqual([])
})
it('attaches a presentation and metadata in one transaction and keeps its saved copy independent', async () => {
  const plan = withPrayer()
  plan.items[1].binding = { kind: 'presentation', presentationId: 'song', slideId: 'slide' }
  plan.items[1].enter.visual = 'bound'
  await repo.attachServiceCue({
    requestId: randomUUID(),
    setlistId: active().id,
    cueId: 'prayer',
    expectedSetlistRevision: active().revision,
    plan,
    source: { kind: 'presentation', id: 'song', slideId: 'slide' },
  })
  const saved = structuredClone(repo.state.cuePresentations[0].presentation)
  await repo.saveDraft({
    ...song,
    revision: 2,
    slides: [{ ...song.slides[0], content: '원곡만 변경' }],
  })
  expect(repo.state.cuePresentations[0].presentation).toEqual(saved)
  await repo.saveDraft({
    ...saved,
    revision: 2,
    slides: [{ ...saved.slides[0], content: '예배 사본만 변경' }],
  })
  expect(repo.library()[0].slides[0].content).toBe('원곡만 변경')
  expect(repo.state.cuePresentations[0].presentation.slides[0].content).toBe('예배 사본만 변경')
  await expect(repo.saveDraft({ ...saved, revision: 3, slides: [] })).rejects.toThrow('슬라이드')
})
it('rejects a failed material attachment without leaving a new cue or changing existing notes', async () => {
  const before = structuredClone(repo.state)
  const plan = withPrayer()
  await expect(
    repo.attachServiceCue({
      requestId: randomUUID(),
      setlistId: active().id,
      cueId: 'prayer',
      expectedSetlistRevision: active().revision,
      plan,
      source: { kind: 'presentation', id: 'missing', slideId: 'none' },
    }),
  ).rejects.toThrow('슬라이드')
  expect(repo.state).toEqual(before)
})
it('deduplicates concurrent material attachments and permits retry after a failed atomic write', async () => {
  const plan = withPrayer()
  const cmd = {
    requestId: randomUUID(),
    setlistId: active().id,
    cueId: 'prayer',
    expectedSetlistRevision: active().revision,
    plan,
    source: { kind: 'presentation' as const, id: 'song', slideId: 'slide' },
  }
  const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('synthetic failure'))
  await expect(repo.attachServiceCue(cmd)).rejects.toThrow('synthetic failure')
  expect(repo.state.cuePresentations).toHaveLength(0)
  rename.mockRestore()
  const [first, second] = await Promise.all([
    repo.attachServiceCue(cmd),
    repo.attachServiceCue(cmd),
  ])
  expect(first).toEqual(second)
  expect(repo.state.cuePresentations).toHaveLength(1)
  await expect(repo.attachServiceCue({ ...cmd, source: { kind: 'none' } })).rejects.toThrow(
    '요청 ID',
  )
})
it('restores deleted song rows with their exact private snapshot during cuesheet Undo', async () => {
  const original = structuredClone(active()),
    plan = structuredClone(original.servicePlan!)
  plan.items = plan.items.filter((cue) => cue.songItemId !== 'one')
  await repo.saveServicePlan(command(plan))
  expect(active().items).toHaveLength(1)
  await repo.saveServicePlan({ ...command(original.servicePlan!), restoreSongRows: original.items })
  expect(active().items).toEqual(original.items)
  expect(active().servicePlan).toEqual(original.servicePlan)
})
