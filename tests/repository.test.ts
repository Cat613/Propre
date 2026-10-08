import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Repository } from '../electron/services/repository'
const now = '2026-10-04T00:00:00.000Z'
const presentation = (id = 'a', revision = 1) => ({
  id,
  title: id,
  slides: [{ id: 's', type: 'text' as const, content: `v${revision}` }],
  createdAt: now,
  updatedAt: now,
  revision,
})
let dir: string, repo: Repository
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-unit-'))
  repo = new Repository(dir)
  await repo.open()
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})
describe('durable operations', () => {
  it('writes ordered checkpoints and reopens the latest draft', async () => {
    await Promise.all([repo.saveDraft(presentation('a', 1)), repo.saveDraft(presentation('a', 2))])
    const reopened = new Repository(dir)
    await reopened.open()
    expect(reopened.state.draft?.revision).toBe(2)
    expect(reopened.state.library).toHaveLength(1)
    expect((await fs.readdir(dir)).some((f) => f.endsWith('.tmp'))).toBe(false)
  })
  it('rejects stale saves without replacing newer content', async () => {
    await repo.saveDraft(presentation('a', 5))
    await expect(repo.saveDraft(presentation('a', 4))).rejects.toThrow()
    expect(repo.state.library[0].revision).toBe(5)
  })
  it('does not commit memory or disk when an atomic transaction fails', async () => {
    await repo.saveDraft(presentation())
    await expect(
      repo.transaction((s) => {
        s.library[0].title = 'bad'
        throw new Error('simulated failure')
      }),
    ).rejects.toThrow('simulated')
    expect(repo.library()[0].title).toBe('a')
    expect(JSON.parse(await fs.readFile(repo.filename, 'utf8')).library[0].title).toBe('a')
  })
  it('recovers corrupt primary from a validated previous checkpoint and preserves the damaged original', async () => {
    await repo.saveDraft(presentation('a', 1))
    await repo.saveDraft(presentation('a', 2))
    await fs.writeFile(repo.filename, '{damaged')
    const reopened = new Repository(dir)
    await reopened.open()
    expect(reopened.state.draft?.revision).toBe(1)
    expect(reopened.warnings).toHaveLength(1)
    expect((await fs.readdir(dir)).some((f) => f.includes('.damaged-'))).toBe(true)
  })
  it('does not overwrite unrecoverable corrupt state', async () => {
    await fs.writeFile(repo.filename, '{damaged')
    const reopened = new Repository(dir)
    await reopened.open()
    await expect(reopened.saveDraft(presentation())).rejects.toThrow('원본')
    expect(await fs.readFile(repo.filename, 'utf8')).toBe('{damaged')
  })
  it('does not overwrite corrupt legacy configuration during migration', async () => {
    await fs.writeFile(path.join(dir, 'config.json'), '{damaged')
    const reopened = new Repository(dir)
    await reopened.open()
    await expect(reopened.saveDraft(presentation())).rejects.toThrow()
    expect(await fs.readFile(path.join(dir, 'config.json'), 'utf8')).toBe('{damaged')
  })
  it('migrates legacy playlist snapshots to references without deleting legacy data', async () => {
    await fs.writeFile(
      path.join(dir, 'config.json'),
      JSON.stringify({
        library: [presentation()],
        playlist: [{ id: 'p1', presentationId: 'a', presentation: presentation() }],
        wasStageActive: true,
      }),
    )
    const reopened = new Repository(dir)
    await reopened.open()
    expect(reopened.playlist()[0].presentation.title).toBe('a')
    expect(reopened.state.playlist[0].id).toBe('p1')
    expect(reopened.state.setlistSongs[0].sourcePresentationId).toBe('a')
    expect(reopened.state.playlist[0].presentationId).not.toBe('a')
    expect(reopened.state.wasStageActive).toBe(true)
    expect(await fs.stat(path.join(dir, 'config.json'))).toBeTruthy()
  })
  it('imports with fresh identities and leaves existing documents intact', async () => {
    await repo.saveDraft(presentation())
    await repo.merge([{ ...presentation(), title: 'import' }])
    expect(repo.library()).toHaveLength(2)
    expect(repo.library().find((p) => p.id === 'a')?.title).toBe('a')
  })
  it('keeps playlist song snapshots when the original is edited or deleted', async () => {
    await repo.saveDraft(presentation())
    await repo.setPlaylist([{ id: 'p', presentationId: 'a' }])
    await repo.saveDraft({ ...presentation('a', 2), title: 'changed' })
    expect(repo.playlist()[0].presentation.title).toBe('a')
    await repo.delete('a')
    expect(repo.playlist()).toHaveLength(1)
    expect(repo.playlist()[0].presentation.title).toBe('a')
  })
  it('rejects orphan playlist entries without committing them', async () => {
    await expect(repo.setPlaylist([{ id: 'p', presentationId: 'missing' }])).rejects.toThrow()
    expect(repo.playlist()).toEqual([])
  })
})
describe('managed media and portable recovery', () => {
  it('encodes names containing spaces and hashes and blocks unregistered/traversal URLs', async () => {
    const original = path.join(dir, 'test # one.png')
    await fs.writeFile(original, Buffer.from('fixture'))
    const asset = await repo.register(original),
      url = repo.assetURL(asset)
    expect(url).not.toContain('#')
    expect(await fs.readFile(await repo.assetPath(url), 'utf8')).toBe('fixture')
    await expect(repo.assetPath('media://asset/../../config.json')).rejects.toThrow()
    await expect(repo.assetPath('file:///etc/passwd')).rejects.toThrow()
  })
  it('blocks symlinks escaping the managed asset directory', async () => {
    const original = path.join(dir, 'fixture.png')
    await fs.writeFile(original, 'fixture')
    const asset = await repo.register(original)
    await fs.rm(path.join(repo.mediaDir, asset.filename))
    await fs.symlink(original, path.join(repo.mediaDir, asset.filename))
    await expect(repo.assetPath(repo.assetURL(asset))).rejects.toThrow('허용')
  })
  it('moves media, settings, playlist and document styles together without exporting secrets', async () => {
    const original = path.join(dir, 'image.png')
    await fs.writeFile(original, 'fixture')
    const asset = await repo.register(original)
    await repo.saveDraft({
      ...presentation(),
      slides: [{ id: 's', type: 'image', backgroundUrl: repo.assetURL(asset) }],
    })
    await repo.setPlaylist([{ id: 'p', presentationId: 'a' }])
    await repo.setSettings({ stageCurrentFontSize: 99 })
    const backup = await repo.exportProject(undefined)
    expect(backup).not.toContain('apiKey')
    const destination = path.join(dir, 'other'),
      restored = new Repository(destination)
    await restored.open()
    await restored.importProject(backup, true)
    expect(restored.state.settings.stageCurrentFontSize).toBe(99)
    expect(restored.playlist()).toHaveLength(1)
    expect(
      await fs.readFile(
        await restored.assetPath(restored.state.library[0].slides[0].backgroundUrl!),
        'utf8',
      ),
    ).toBe('fixture')
  })
  it('rejects corrupted portable media without changing repository state', async () => {
    const original = path.join(dir, 'image.png')
    await fs.writeFile(original, 'fixture')
    await repo.register(original)
    const data = JSON.parse(await repo.exportProject(undefined))
    data.assets[0].data = Buffer.from('tampered').toString('base64')
    await expect(repo.importProject(JSON.stringify(data), true)).rejects.toThrow('무결성')
    expect(repo.state.library).toEqual([])
  })
  it('retains media used by current documents and automatic checkpoints', async () => {
    const original = path.join(dir, 'image.png')
    await fs.writeFile(original, 'fixture')
    const asset = await repo.register(original)
    await repo.saveDraft({
      ...presentation(),
      slides: [{ id: 's', type: 'image', backgroundUrl: repo.assetURL(asset) }],
    })
    await repo.setMedia([])
    await repo.delete('a')
    expect(await repo.cleanup()).toBe(0)
    expect(await repo.assetPath(repo.assetURL(asset))).toBeTruthy()
  })
  it('imports legacy media without reading external files and preserves URL text in content', async () => {
    const original = path.join(dir, 'outside # one.png')
    await fs.writeFile(original, 'fixture')
    const rawURL = 'file://' + original
    const result = await repo.importProject(
      JSON.stringify({
        title: 'Legacy',
        slides: [{ id: 's', type: 'image', backgroundUrl: rawURL, content: rawURL }],
      }),
    )
    const slide = result.presentations[0].slides[0]
    expect(slide.content).toBe(rawURL)
    expect(slide.backgroundUrl).toMatch(/^media:\/\/asset\//)
    await repo.saveDraft(result.presentations[0])
    expect(repo.state.media).toHaveLength(1)
    await expect(repo.assetPath(slide.backgroundUrl!)).rejects.toThrow()
    await repo.relink(repo.state.assets[0].id, original)
    expect(await fs.readFile(await repo.assetPath(slide.backgroundUrl!), 'utf8')).toBe('fixture')
  })
  it('imports managed legacy media and makes it available in the persistent catalog', async () => {
    await fs.mkdir(repo.mediaDir, { recursive: true })
    const original = path.join(repo.mediaDir, 'managed # one.png')
    await fs.writeFile(original, 'fixture')
    const result = await repo.importProject(
      JSON.stringify({
        title: 'Legacy',
        slides: [{ id: 's', type: 'image', backgroundUrl: 'file://' + original }],
      }),
    )
    expect(
      await fs.readFile(
        await repo.assetPath(result.presentations[0].slides[0].backgroundUrl!),
        'utf8',
      ),
    ).toBe('fixture')
    expect(repo.state.media[0].type).toBe('image')
    expect(await fs.readFile(original, 'utf8')).toBe('fixture')
  })
})
