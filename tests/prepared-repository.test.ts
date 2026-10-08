import { beforeEach, afterEach, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Repository } from '../electron/services/repository'
let dir: string, repo: Repository
const now = '2026-10-05T00:00:00.000Z'
const p = (id: string, revision = 1) => ({
  id,
  title: id,
  slides: [{ id: `${id}-s`, type: 'text', content: id }],
  revision,
  createdAt: now,
  updatedAt: now,
})
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-prepared-'))
  repo = new Repository(dir)
  await repo.open()
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})
it('saves preparation without changing the operator draft and persists it across reopen', async () => {
  await repo.saveDraft(p('operator'))
  await repo.savePrepared(p('ai'), null)
  expect(repo.state.draft?.id).toBe('operator')
  const reopened = new Repository(dir)
  await reopened.open()
  expect(reopened.library().map((x) => x.id)).toEqual(['operator', 'ai'])
  expect(reopened.state.draft?.id).toBe('operator')
})
it('only one compare-and-save wins and failed writes preserve the confirmed state', async () => {
  await repo.savePrepared(p('ai'), null)
  const results = await Promise.allSettled([
    repo.savePrepared(p('ai', 2), 1),
    repo.savePrepared(p('ai', 3), 1),
  ])
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
  expect(repo.library()[0].revision).toBe(2)
  await expect(repo.savePrepared(p('ai', 4), null)).rejects.toMatchObject({
    code: 'REVISION_CONFLICT',
  })
  await fs.rm(repo.filename)
  await fs.mkdir(repo.filename)
  await expect(repo.savePrepared(p('new'), null)).rejects.toThrow()
  expect(repo.library().map((x) => x.id)).toEqual(['ai'])
})
it('validates original playlist inside the transaction and preserves repeats', async () => {
  await repo.savePrepared(p('a'), null)
  const initial = [{ id: 'first', presentationId: 'a' }]
  await repo.setPlaylist(initial)
  const repeated = [
    { id: 'x', presentationId: 'a' },
    { id: 'y', presentationId: 'a' },
  ]
  const actualInitial = structuredClone(repo.state.playlist)
  await repo.setPreparedPlaylist(repeated, actualInitial)
  expect(repo.playlist()).toHaveLength(2)
  await expect(repo.setPreparedPlaylist([], initial)).rejects.toMatchObject({
    code: 'REVISION_CONFLICT',
  })
  await expect(
    repo.setPreparedPlaylist([{ id: 'bad', presentationId: 'missing' }], repo.state.playlist),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect(repo.playlist()).toHaveLength(2)
})
