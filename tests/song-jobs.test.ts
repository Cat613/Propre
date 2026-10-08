import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { PDFDocument } from 'pdf-lib'
import { DEFAULT_STYLE } from '../shared/model'
import { compileSong, type SongDraft, type SongJob } from '../shared/song-preparation'
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 10, height: 10 }) }),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('encrypted:' + s),
    decryptString: (b: Buffer) => b.toString().replace('encrypted:', ''),
    getSelectedStorageBackend: () => 'keychain',
  },
}))
import { Repository } from '../electron/services/repository'
import { SongJobs } from '../electron/services/song-jobs'
import { AIProfiles } from '../electron/services/ai-profiles'
import type { KeyVault } from '../electron/services/security'
let directory: string, repo: Repository, profiles: AIProfiles, jobs: SongJobs, pdf: string
const fixture = (sourceId: string): SongDraft => ({
  id: 's',
  title: '합성 테스트 찬양',
  formEvidence: 'explicit',
  form: {
    parts: [{ id: 'A', label: 'A', pages: ['합성 테스트 원문 가사'], sourceId, sourcePage: 1 }],
    sequence: [{ partId: 'A', repeat: 2 }],
  },
  issues: [],
  confirmed: true,
  originalId: 'forged',
  originalRevision: 0,
  updateOriginal: true,
})
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-ai-jobs-'))
  repo = new Repository(directory)
  await repo.open()
  profiles = new AIProfiles(directory, { get: () => 'synthetic-test-key' } as KeyVault)
  await profiles.open()
  jobs = new SongJobs(
    repo,
    profiles,
    () => {},
    async () => 'synthetic-preview',
  )
  await jobs.open()
  pdf = path.join(directory, 'synthetic.pdf')
  const document = await PDFDocument.create()
  document.addPage([100, 100])
  await fs.writeFile(pdf, await document.save())
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await fs.rm(directory, { recursive: true, force: true })
})
const select = (automatic = false) =>
  jobs.files([pdf], { profileId: 'legacy-gemini', instruction: 'A×2', mode: 'append', automatic })
function respond(job: SongJob, inferred = false) {
  let count = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body)
      expect(
        body.tools[0].functionDeclarations.some((t: any) => t.name === 'apply_prepared_set'),
      ).toBe(false)
      if (++count === 1) {
        const song = fixture(job.sources[0].id)
        if (inferred) song.formEvidence = 'inferred'
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      functionCall: {
                        name: 'stage_song_drafts',
                        args: {
                          expectedDraftRevision: job.draftRevision,
                          draft: { songs: [song], order: ['s'] },
                        },
                      },
                    },
                  ],
                },
              },
            ],
          }),
        )
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: 'complete' }] } }],
        }),
      )
    }),
  )
}
describe('durable jobs, file grants and actual SDK MCP loop', () => {
  it('validates PDFs, copies with source hashes, stages through MCP without original permissions, requires operator review then atomically applies and survives restart', async () => {
    const job = await select()
    expect(job.sources[0].pages).toBe(1)
    respond(job)
    await jobs.analyze(job.id)
    await vi.waitFor(() => expect(jobs.list()[0].status).toBe('needs_review'))
    expect(repo.state.library).toHaveLength(0)
    const current = jobs.list()[0]
    expect(current.draft!.songs[0].originalId).toBeNull()
    expect(current.draft!.songs[0].updateOriginal).toBe(false)
    await expect(jobs.apply(job.id, current.draftRevision)).rejects.toThrow('확인')
    current.draft!.songs[0].confirmed = true
    const saved = await jobs.edit(job.id, {
      expectedDraftRevision: current.draftRevision,
      draft: current.draft,
    })
    const receipt = await jobs.apply(job.id, saved.draftRevision)
    expect(receipt.receipt.added).toBe(1)
    expect(repo.state.playlist).toHaveLength(1)
    expect((await jobs.apply(job.id, saved.draftRevision)).receipt).toEqual(receipt.receipt)
    const reopened = new SongJobs(
      repo,
      profiles,
      () => {},
      async () => '',
    )
    await reopened.open()
    expect(reopened.list()[0].status).toBe('completed')
    expect(reopened.receipt(job.id)).toEqual(receipt.receipt)
    await reopened.remove(job.id)
    expect(repo.state.library).toHaveLength(1)
    expect(repo.state.songReceipts).toHaveLength(1)
  })
  it('inferred forms interrupt automatic application; exact lyric match connects existing original without updating it', async () => {
    const draft = fixture('placeholder')
    draft.originalId = null
    const original = compileSong(draft, DEFAULT_STYLE)
    await repo.saveDraft(original)
    const job = await select(true)
    respond(job, true)
    await jobs.analyze(job.id)
    await vi.waitFor(() => expect(jobs.list()[0].status).toBe('needs_review'))
    const song = jobs.list()[0].draft!.songs[0]
    expect(song.originalId).toBe(original.id)
    expect(song.confirmed).toBe(false)
    expect(song.issues.join('')).toContain('추정')
    expect(repo.state.library).toHaveLength(1)
    expect(repo.state.playlist).toHaveLength(0)
  })
  it('rejects damaged and encrypted-style PDFs, file count limits, forged image signatures, and changed copied source', async () => {
    await fs.writeFile(pdf, '%PDF-1.7\nnot a document')
    await expect(select()).rejects.toThrow('손상')
    await expect(
      jobs.files(
        Array.from({ length: 21 }, () => pdf),
        { profileId: 'legacy-gemini', mode: 'append', automatic: false, instruction: '' },
      ),
    ).rejects.toThrow('20개')
    const image = path.join(directory, 'fake.png')
    await fs.writeFile(image, 'this is not png')
    await expect(
      jobs.files([image], {
        profileId: 'legacy-gemini',
        mode: 'append',
        automatic: false,
        instruction: '',
      }),
    ).rejects.toThrow('PNG')
    const document = await PDFDocument.create()
    document.addPage()
    await fs.writeFile(pdf, await document.save())
    const valid = await select()
    await fs.writeFile(path.join(directory, 'song-jobs', valid.id, valid.sources[0].id), 'modified')
    await expect(jobs.source(valid.id, valid.sources[0].id)).rejects.toThrow('변경')
  })
  it('cancel rejects late model results and preserves current data; reopening an unfinished analysis marks interrupted', async () => {
    const job = await select(),
      before = structuredClone(repo.state)
    let resolve: (v: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done
          }),
      ),
    )
    await jobs.analyze(job.id)
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(1))
    const reopened = new SongJobs(
      repo,
      profiles,
      () => {},
      async () => '',
    )
    await reopened.open()
    expect(reopened.list()[0].status).toBe('interrupted')
    await jobs.cancel(job.id)
    resolve(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'stage_song_drafts',
                      args: {
                        expectedDraftRevision: 0,
                        draft: { songs: [fixture(job.sources[0].id)], order: ['s'] },
                      },
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    )
    await vi.waitFor(() => expect(jobs.list()[0].status).toBe('canceled'))
    expect(repo.state).toEqual(before)
    expect(jobs.list()[0].draft).toBeNull()
  })
  it('profile keys remain protected, registration/provider changes are isolated, default change never mutates pinned jobs', async () => {
    const job = await select()
    await profiles.save(
      { id: 'other', name: 'Other', provider: 'openai', model: 'synthetic' },
      'synthetic-openai-key',
      true,
    )
    expect(jobs.list()[0].profile).toEqual(job.profile)
    expect(profiles.list().defaultId).toBe('other')
    const raw = await fs.readFile(path.join(directory, 'ai-profiles-v1.json'), 'utf8')
    expect(raw).not.toContain('synthetic-openai-key')
    expect(JSON.stringify(profiles.list())).not.toContain('synthetic-openai-key')
    await profiles.save(
      { id: 'other', name: 'Other', provider: 'claude', model: 'synthetic' },
      null,
      false,
    )
    expect(profiles.list().profiles.find((p) => p.id === 'other')?.configured).toBe(false)
    expect(() => profiles.key('other', 'openai')).toThrow('제공자')
    await jobs.switchProfile(job.id, 'other')
    expect(jobs.list()[0].profile.provider).toBe('claude')
    expect(jobs.list()[0].sources).toEqual(job.sources)
  })

  it('cleanup expires finished sources, preserves explicitly retained sources and unfinished recovery drafts, and keeps applied workspace data', async () => {
    const finished = await select(),
      retained = await select(),
      interrupted = await select()
    const old = '2025-01-01T00:00:00.000Z'
    for (const job of [finished, retained, interrupted]) {
      job.createdAt = old
      job.status = job.id === interrupted.id ? 'analyzing' : 'completed'
      job.keepSources = job.id === retained.id
      await fs.writeFile(path.join(directory, 'song-jobs', job.id, 'job.json'), JSON.stringify(job))
    }
    const original = compileSong({ ...fixture('source'), originalId: null })
    await repo.saveDraft(original)
    const reopened = new SongJobs(
      repo,
      profiles,
      () => {},
      async () => '',
    )
    await reopened.open()
    expect(reopened.list().some((job) => job.id === finished.id)).toBe(false)
    expect(reopened.list().some((job) => job.id === retained.id)).toBe(true)
    expect(reopened.list().find((job) => job.id === interrupted.id)?.status).toBe('interrupted')
    expect(repo.state.library[0].id).toBe(original.id)
    expect((await reopened.source(retained.id, retained.sources[0].id)).data).toBeTruthy()
  })

  it('partial analysis preserves successful songs and can resend only a selected failed file', async () => {
    const job = await jobs.files([pdf, pdf], {
      profileId: 'legacy-gemini',
      instruction: 'A×2',
      mode: 'append',
      automatic: false,
    })
    respond(job)
    await jobs.analyze(job.id)
    await vi.waitFor(() => expect(jobs.list()[0].status).toBe('failed'))
    const partial = jobs.list()[0]
    expect(partial.draft!.songs).toHaveLength(1)
    const second = {
      ...fixture(job.sources[1].id),
      id: 'second',
      originalId: null,
      confirmed: false,
      updateOriginal: false,
    }
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body)
        expect(body.contents[0].parts.filter((part: any) => part.inlineData)).toHaveLength(1)
        const part =
          ++calls === 1
            ? {
                functionCall: {
                  name: 'stage_song_drafts',
                  args: {
                    expectedDraftRevision: partial.draftRevision,
                    draft: { songs: [...partial.draft!.songs, second], order: ['s', 'second'] },
                  },
                },
              }
            : { text: 'complete' }
        return new Response(
          JSON.stringify({ candidates: [{ content: { role: 'model', parts: [part] } }] }),
        )
      }),
    )
    await jobs.analyze(job.id, [job.sources[1].id])
    await vi.waitFor(() => expect(jobs.list()[0].status).toBe('needs_review'))
    expect(jobs.list()[0].draft!.songs).toHaveLength(2)
    expect(jobs.list()[0].draft!.songs[0].form).toEqual(partial.draft!.songs[0].form)
    expect(repo.state.library).toHaveLength(0)
  })
})
