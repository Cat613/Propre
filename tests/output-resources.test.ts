import { beforeEach, afterEach, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { Repository } from '../electron/services/repository'
import { normalizeWebURL } from '../shared/output-resources'
let dir: string, repo: Repository
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-resources-'))
  repo = new Repository(dir)
  await repo.open()
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})
it('normalizes addresses and rejects local schemes, credentials and saved authentication links', () => {
  expect(normalizeWebURL('example.com')).toBe('https://example.com/')
  for (const url of [
    'file:///etc/passwd',
    'app://propre/index.html',
    'javascript:alert(1)',
    'https://id:secret@example.com',
    'https://example.com/?token=x',
  ])
    expect(() => normalizeWebURL(url)).toThrow()
})
it('migrates v2 without changing original bytes or automatically opening a URL', async () => {
  const bytes = JSON.stringify({ ...repo.state, schemaVersion: 2, outputResources: undefined })
  await fs.writeFile(path.join(dir, 'workspace-v2.json'), bytes)
  repo = new Repository(dir)
  await repo.open()
  expect(repo.state.schemaVersion).toBe(5)
  expect(repo.state.outputResources).toEqual([])
  expect(await fs.readFile(path.join(dir, 'workspace-v2.json'), 'utf8')).toBe(bytes)
  expect(JSON.parse(await fs.readFile(repo.filename, 'utf8')).schemaVersion).toBe(5)
})
it('copies a PDF, protects revision and references, and round trips its hash and registered URL in a backup', async () => {
  const pdf = await PDFDocument.create()
  pdf.addPage([300, 500])
  pdf.addPage([500, 300])
  const file = path.join(dir, 'sample.pdf')
  await fs.writeFile(file, await pdf.save())
  const r = await repo.registerPDF(file)
  await fs.rm(file)
  expect(r.pageCount).toBe(2)
  await repo.manageOutputResource({ action: 'create-web', name: 'fixture', url: 'example.com' })
  expect(await repo.cleanup()).toBe(0)
  await expect(
    repo.manageOutputResource({ action: 'delete', id: r.id, revision: 9 }),
  ).rejects.toThrow()
  await expect(repo.rememberPDF(r.id, 0, 3, 0)).rejects.toThrow()
  await repo.rememberPDF(r.id, 0, 2, 90)
  const backup = await repo.exportProject(undefined)
  expect(JSON.parse(backup)).toMatchObject({ schemaVersion: 4, kind: 'backup' })
  const target = new Repository(path.join(dir, 'restored'))
  await target.open()
  await target.importProject(backup, true)
  expect(target.state.outputResources).toEqual(repo.state.outputResources)
  expect(
    await fs.readFile(await target.assetPath(target.assetURL(target.state.assets[0]))),
  ).toEqual(await fs.readFile(await repo.assetPath(repo.assetURL(repo.state.assets[0]))))
})
it('rejects invalid PDF without registering any asset or changing stored state', async () => {
  const file = path.join(dir, 'bad.pdf')
  await fs.writeFile(file, 'invalid')
  await expect(repo.registerPDF(file)).rejects.toThrow()
  expect(repo.state.assets).toEqual([])
  expect(repo.state.outputResources).toEqual([])
})
it('uses the sandbox validation callback and rolls back failed relinking before metadata changes', async () => {
  const document = await PDFDocument.create()
  document.addPage([300, 400])
  const file = path.join(dir, 'source.pdf')
  await fs.writeFile(file, await document.save())
  let calls = 0
  const resource = await repo.registerPDF(file, async (bytes) => {
    calls++
    expect(bytes.subarray(0, 8).toString()).toContain('%PDF-')
    return 1
  })
  expect(calls).toBe(1)
  const before = structuredClone(repo.state)
  const asset = repo.state.assets.find((a) => a.id === resource.assetId)!
  const original = await fs.readFile(await repo.assetPath(repo.assetURL(asset)))
  const replacement = await PDFDocument.create()
  replacement.addPage([600, 500])
  await fs.writeFile(file, await replacement.save())
  await expect(
    repo.relink(asset.id, file, async () => {
      throw new Error('invalid render')
    }),
  ).rejects.toThrow('invalid render')
  expect(repo.state).toEqual(before)
  expect(await fs.readFile(await repo.assetPath(repo.assetURL(asset)))).toEqual(original)
  await repo.relink(asset.id, file, async () => 1)
  expect(repo.state.outputResources[0]).toMatchObject({ revision: 1, pageCount: 1 })
})
it('keeps deleted PDF recoverable across checkpoints, cleanup, restart and full backup', async () => {
  const pdf = await PDFDocument.create()
  pdf.addPage([300, 500])
  const file = path.join(dir, 'retained.pdf')
  await fs.writeFile(file, await pdf.save())
  const original = await repo.registerPDF(file)
  await repo.rememberPDF(original.id, 0, 1, 90)
  const removed = (
    await repo.manageOutputResource({ action: 'delete', id: original.id, revision: 0 })
  )[0]
  expect(removed).toMatchObject({ id: original.id, revision: 1, rotation: 90 })
  expect(removed.deletedAt).toBeTruthy()
  for (let n = 0; n < 6; n++) await repo.setSettings({ showAudioPlayer: n % 2 === 0 })
  expect(await repo.cleanup()).toBe(0)
  const restarted = new Repository(dir)
  await restarted.open()
  await expect(
    restarted.manageOutputResource({ action: 'restore', id: original.id, revision: 0 }),
  ).rejects.toThrow()
  const backup = await restarted.exportProject(undefined)
  const restored = new Repository(path.join(dir, 'backup'))
  await restored.open()
  await restored.importProject(backup, true)
  const entries = await restored.manageOutputResource({
    action: 'restore',
    id: original.id,
    revision: removed.revision,
  })
  expect(entries[0]).toMatchObject({ id: original.id, revision: 2, rotation: 90, pageCount: 1 })
  expect(entries[0].deletedAt).toBeUndefined()
  const asset = restored.state.assets[0]
  expect(await fs.readFile(await restored.assetPath(restored.assetURL(asset)))).toEqual(
    await fs.readFile(file),
  )
})
it('recovers a legacy hard-deleted resource from checkpoints without rolling back other workspace edits', async () => {
  const [r] = await repo.manageOutputResource({
    action: 'create-web',
    name: 'old deletion',
    url: 'example.com',
  })
  await repo.transaction((s) => {
    s.outputResources = []
  })
  await repo.setSettings({ showAudioPlayer: false })
  const before = structuredClone(repo.state)
  const recovered = await repo.manageOutputResource({ action: 'recover-deleted' })
  expect(recovered).toHaveLength(1)
  expect(recovered[0]).toMatchObject({ id: r.id, url: 'https://example.com/', revision: 1 })
  expect(recovered[0].deletedAt).toBeUndefined()
  expect(repo.state.settings).toEqual(before.settings)
  expect(repo.state.library).toEqual(before.library)
  await expect(repo.manageOutputResource({ action: 'recover-deleted' })).rejects.toThrow(
    '되돌릴 자료',
  )
})
