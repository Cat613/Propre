import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { nativeImage } from 'electron'
import { PDFDocument } from 'pdf-lib'
import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  JobSchema,
  SourceSchema,
  StageSchema,
  StartJobSchema,
  DraftSetSchema,
  compileSong,
  titleKey,
  type SongJob,
  type DraftSet,
  type ApplyReceipt,
} from '../../shared/song-preparation'
import { GlobalStyle, Id, boundedJSON } from '../../shared/schema'
import { slideText } from '../../shared/model'
import { atomicWrite, type Repository } from './repository'
import { applySongJob, planHash, undoSongApply } from './song-apply'
import { SongProvider, type ModelTool, type ProviderFile } from './song-providers'
import type { AIProfiles } from './ai-profiles'
import {
  SONG_PREPARATION_RULES,
  SONG_TOOL_DESCRIPTIONS,
  songBatchPrompt,
  assertBatchPreserved,
} from './song-prompt'
import { isDeepStrictEqual } from 'node:util'

const processing = new Set(['analyzing', 'committing'])
export class SongJobs {
  private jobs = new Map<string, SongJob>()
  private batchSources = new Map<string, Set<string>>()
  private controllers = new Map<string, AbortController>()
  private tail: Promise<unknown> = Promise.resolve()
  constructor(
    private repo: Repository,
    private profiles: AIProfiles,
    private notify: (job: SongJob) => void,
    private preview: (p: {
      slide: ReturnType<typeof compileSong>['slides'][number]
      style: SongJob['style']
    }) => Promise<string>,
  ) {}
  private directory(id: string) {
    return path.join(this.repo.directory, 'song-jobs', Id.parse(id))
  }
  private async serial<T>(action: () => Promise<T>): Promise<T> {
    const op = this.tail.catch(() => {}).then(action)
    this.tail = op
    return op
  }
  private get(id: string) {
    const job = this.jobs.get(Id.parse(id))
    if (!job) throw new Error('준비 작업이 만료되었거나 없습니다.')
    return job
  }
  private async store(job: SongJob) {
    job.updatedAt = new Date().toISOString()
    if (Buffer.byteLength(JSON.stringify(job)) > 4 * 1024 * 1024)
      throw new Error('준비 작업 크기가 너무 큽니다. 곡 수를 줄여주세요.')
    await atomicWrite(path.join(this.directory(job.id), 'job.json'), JSON.stringify(job))
    this.jobs.set(job.id, structuredClone(job))
    this.notify(structuredClone(job))
    return structuredClone(job)
  }
  async open() {
    const root = path.join(this.repo.directory, 'song-jobs')
    await fs.mkdir(root, { recursive: true })
    for (const name of await fs.readdir(root)) {
      if (!Id.safeParse(name).success) continue
      try {
        const raw = JobSchema.parse(
          boundedJSON(
            await fs.readFile(path.join(root, name, 'job.json'), 'utf8'),
            4 * 1024 * 1024,
          ),
        )
        const job = { ...raw, style: GlobalStyle.parse(raw.style) } as SongJob
        const receipt = this.repo.state.songReceipts.find((r) => r.jobId === job.id)
        if (receipt) {
          job.status = 'completed'
          delete job.error
        } else if (processing.has(job.status)) {
          job.status = 'interrupted'
          job.error = '분석이 중단되었습니다. 초안을 확인하거나 다시 분석해주세요.'
        }
        if (
          !job.keepSources &&
          ['completed', 'canceled'].includes(job.status) &&
          Date.now() - Date.parse(job.createdAt) > 7 * 86400000
        ) {
          await fs.rm(path.join(root, name), { recursive: true, force: true })
          continue
        }
        await this.store(job)
      } catch {
        /* Preserve damaged jobs for manual recovery; never expose contents in diagnostics. */
      }
    }
  }
  list() {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((j) => structuredClone(j))
  }
  async files(filenames: string[], rawOptions: unknown) {
    const options = StartJobSchema.parse(rawOptions),
      profile = this.profiles.get(options.profileId)
    if (!filenames.length || filenames.length > 20) throw new Error('파일은 1~20개를 선택해주세요.')
    const now = new Date().toISOString(),
      active = this.repo.state.setlists.find((l) => l.id === this.repo.state.activeSetlistId)
    const preset = this.repo.state.settings.globalStylePresets?.find(
      (p) => p.id === this.repo.state.settings.defaultSongPresetId,
    )
    const job: SongJob = {
      id: randomUUID(),
      requestId: randomUUID(),
      createdAt: now,
      updatedAt: now,
      profile,
      sources: [],
      analysisSources: [],
      instruction: options.instruction,
      mode: options.mode,
      automatic: options.automatic,
      keepSources: false,
      status: 'queued',
      targetId: active?.id || null,
      targetRevision: active?.revision ?? null,
      libraryVersions: Object.fromEntries(
        this.repo.state.library.map((p) => [p.id, p.revision || 0]),
      ),
      draftRevision: 0,
      draft: null,
      style: GlobalStyle.parse(
        preset?.style || {
          fontSize: 60,
          fontColor: '#ffffff',
          fontFamily: 'sans-serif',
          align: 'center',
          verticalAlign: 'center',
        },
      ),
    }
    await fs.mkdir(this.directory(job.id), { recursive: true })
    try {
      let total = 0,
        pages = 0
      for (const filename of filenames) {
        const info = await fs.stat(filename)
        if (!info.isFile() || info.size < 1 || info.size > 20 * 1024 * 1024)
          throw new Error('파일당 20MB 이하의 PDF·PNG·JPG·WEBP를 선택해주세요.')
        total += info.size
        if (total > 40 * 1024 * 1024) throw new Error('전체 파일 크기는 40MB 이하로 선택해주세요.')
        const data = await fs.readFile(filename),
          extension = path.extname(filename).toLowerCase()
        let mime: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp',
          count = 1
        if (extension === '.pdf') {
          if (!data.subarray(0, 1024).includes(Buffer.from('%PDF-')))
            throw new Error('PDF 파일 형식을 확인해주세요.')
          try {
            const pdf = await PDFDocument.load(data, { updateMetadata: false })
            count = pdf.getPageCount()
          } catch {
            throw new Error(
              '암호화되었거나 손상된 PDF입니다. 암호를 해제한 유효 PDF를 선택해주세요.',
            )
          }
          mime = 'application/pdf'
        } else {
          mime =
            extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
          const valid =
            extension === '.png'
              ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : extension === '.webp'
                ? data.toString('ascii', 0, 4) === 'RIFF' &&
                  data.toString('ascii', 8, 12) === 'WEBP'
                : ['.jpg', '.jpeg'].includes(extension) && data[0] === 255 && data[1] === 216
          const image = valid ? nativeImage.createFromBuffer(data) : undefined
          if (
            !image ||
            image.isEmpty() ||
            image.getSize().width * image.getSize().height > 40000000
          )
            throw new Error('읽을 수 있는 4천만 화소 이하의 PNG·JPG·WEBP를 선택해주세요.')
        }
        pages += count
        if (pages > 50) throw new Error('전체 50페이지 이하로 선택해주세요.')
        const source = SourceSchema.parse({
          id: randomUUID(),
          name: path.basename(filename),
          mime,
          bytes: data.length,
          pages: count,
          hash: createHash('sha256').update(data).digest('hex'),
        })
        await atomicWrite(path.join(this.directory(job.id), source.id), data)
        job.sources.push(source)
      }
      return await this.store(job)
    } catch (e) {
      await fs.rm(this.directory(job.id), { recursive: true, force: true })
      throw e
    }
  }
  async source(id: string, sourceId: string) {
    const job = this.get(id),
      source = job.sources.find((s) => s.id === Id.parse(sourceId))
    if (!source) throw new Error('원본 파일을 찾지 못했습니다.')
    const data = await fs.readFile(path.join(this.directory(id), source.id))
    if (createHash('sha256').update(data).digest('hex') !== source.hash)
      throw new Error('원본 파일이 변경되었습니다. 다시 선택해주세요.')
    return { ...source, data: data.toString('base64') }
  }
  private checkDraft(job: SongJob, draft: DraftSet) {
    DraftSetSchema.parse(draft)
    if (
      draft.songs.some((s) =>
        s.form.parts.some(
          (p) => !job.sources.some((f) => f.id === p.sourceId && p.sourcePage <= f.pages),
        ),
      )
    )
      throw new Error('원본 파일과 페이지 근거를 확인해주세요.')
  }
  async edit(id: string, raw: unknown) {
    return this.serial(async () => {
      const job = structuredClone(this.get(id)),
        args = StageSchema.parse(raw)
      if (processing.has(job.status) || job.status === 'completed')
        throw new Error('현재 작업 상태에서는 수정할 수 없습니다.')
      if (job.draftRevision !== args.expectedDraftRevision)
        throw new Error('다른 수정본이 있습니다. 다시 열어주세요.')
      this.checkDraft(job, args.draft)
      job.draft = args.draft
      job.draftRevision++
      job.status = args.draft.songs.every((s) => s.confirmed) ? 'ready' : 'needs_review'
      delete job.error
      return this.store(job)
    })
  }
  async rebase(id: string) {
    return this.serial(async () => {
      const job = structuredClone(this.get(id))
      if (processing.has(job.status) || job.status === 'completed')
        throw new Error('작업이 진행 중이거나 완료되었습니다.')
      const active = this.repo.state.setlists.find((l) => l.id === this.repo.state.activeSetlistId)
      job.targetId = active?.id || null
      job.targetRevision = active?.revision ?? null
      job.draftRevision++
      if (job.draft)
        for (const song of job.draft.songs) {
          if (
            !song.originalId &&
            this.repo.state.library.some(
              (p) =>
                titleKey(p.title) === titleKey(song.title) &&
                !Object.hasOwn(job.libraryVersions, p.id),
            )
          ) {
            song.confirmed = false
            song.issues.push('같은 제목' + '의 곡이 새로 저장되었습니다. 원곡 연결을 확인해주세요.')
          }
        }
      job.libraryVersions = Object.fromEntries(
        this.repo.state.library.map((p) => [p.id, p.revision || 0]),
      )
      if (job.draft)
        for (const song of job.draft.songs) {
          const original = this.repo.state.library.find((p) => p.id === song.originalId)
          if (
            song.originalId &&
            (!original || song.originalRevision !== (original.revision || 0))
          ) {
            song.originalRevision = original?.revision ?? null
            song.originalId = original?.id || null
            song.confirmed = false
            song.updateOriginal = false
          }
        }
      job.status = !job.draft
        ? 'queued'
        : job.draft.songs.every((s) => s.confirmed)
          ? 'ready'
          : 'needs_review'
      delete job.error
      return this.store(job)
    })
  }
  async cancel(id: string) {
    this.controllers.get(id)?.abort()
    return this.serial(async () => {
      const job = structuredClone(this.get(id))
      if (job.status === 'committing' || this.repo.state.songReceipts.some((r) => r.jobId === id))
        return job
      job.status = 'canceled'
      job.automatic = false
      return this.store(job)
    })
  }
  async retain(id: string, keep: boolean) {
    return this.serial(async () => {
      const job = structuredClone(this.get(id))
      job.keepSources = keep
      return this.store(job)
    })
  }
  async remove(id: string) {
    return this.serial(async () => {
      const job = this.get(id)
      if (processing.has(job.status) || this.controllers.has(id))
        throw new Error('진행 중인 작업은 취소한 뒤 삭제해주세요.')
      await fs.rm(this.directory(id), { recursive: true, force: true })
      this.jobs.delete(id)
    })
  }
  receipt(id: string) {
    return structuredClone(
      this.repo.state.songReceipts.find((r) => r.jobId === Id.parse(id)) || null,
    )
  }
  private validation(job: SongJob) {
    if (!job.draft) throw new Error('곡 초안을 먼저 준비해주세요.')
    this.checkDraft(job, job.draft)
    return {
      planHash: planHash(job),
      ready: job.draft.songs.every((s) => s.confirmed),
      draftRevision: job.draftRevision,
    }
  }
  async previewDraft(id: string, songId: string, index: number) {
    const job = this.get(id),
      song = job.draft?.songs.find((s) => s.id === songId)
    if (!song) throw new Error('준비한 곡을 찾지 못했습니다.')
    const p = compileSong(song, job.style),
      slide = p.slides[index]
    if (!slide) throw new Error('슬라이드를 찾지 못했습니다.')
    return { png: await this.preview({ slide, style: job.style }), slideCount: p.slides.length }
  }
  private async bridge(id: string, approved?: string) {
    const server = new McpServer({ name: 'ProPre song preparation', version: '1.0.0' })
    const empty = z.object({}).strict()
    const register = (
      name: string,
      schema: z.ZodObject<any>,
      action: (args: any) => Promise<unknown> | unknown,
    ) =>
      server.registerTool(
        name,
        { description: SONG_TOOL_DESCRIPTIONS[name] || name, inputSchema: schema },
        async (args: any) => {
          try {
            const result = await action(args)
            return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
          } catch (e) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text:
                    e instanceof z.ZodError
                      ? `초안 형식을 확인해주세요: ${e.issues
                          .slice(0, 5)
                          .map((issue) => `${issue.path.join('.') || 'draft'}: ${issue.message}`)
                          .join('; ')}`
                      : e instanceof Error
                        ? e.message
                        : '작업을 완료하지 못했습니다.',
                },
              ],
            }
          }
        },
      )
    register('get_song_job', empty, () => {
      const job = this.get(id)
      return {
        sources: job.sources,
        instruction: job.instruction,
        analysisSources: [...(this.batchSources.get(id) || [])],
        draftRevision: job.draftRevision,
        draft: job.draft,
      }
    })
    register('stage_song_drafts', StageSchema, async (raw) =>
      this.serial(async () => {
        const args = StageSchema.parse(raw)
        const job = structuredClone(this.get(id))
        if (job.status !== 'analyzing' || this.controllers.get(id)?.signal.aborted)
          throw new Error('분석 권한이 종료되었습니다.')
        if (args.expectedDraftRevision !== job.draftRevision)
          throw new Error('초안 버전이 다릅니다. get_song_job으로 다시 조회해주세요.')
        this.checkDraft(job, args.draft)
        const scope = this.batchSources.get(id)
        if (!scope) throw new Error('현재 분석 파일 범위를 확인해주세요.')
        assertBatchPreserved(job.draft, args.draft, scope)
        for (const song of args.draft.songs) {
          if (job.draft?.songs.some((old) => old.id === song.id && isDeepStrictEqual(old, song)))
            continue
          const candidates = this.repo.state.library.filter(
            (p) => titleKey(p.title) === titleKey(song.title),
          )
          song.originalId = null
          song.originalRevision = null
          song.updateOriginal = false
          if (song.formEvidence === 'inferred')
            song.issues.push('송폼이 명시되지 않아 추정한 순서입니다. 진행 순서를 확인해주세요.')
          const lyric = song.form.parts
            .flatMap((p: DraftSet['songs'][number]['form']['parts'][number]) => p.pages)
            .join('')
            .replace(/\s/g, '')
          const exact = candidates.filter((p) => {
            const old = [
              ...new Set(p.slides.map(slideText).map((t) => t.replace(/\s/g, ''))),
            ].filter(Boolean)
            const current = [
              ...new Set(
                song.form.parts
                  .flatMap((part: DraftSet['songs'][number]['form']['parts'][number]) => part.pages)
                  .map((t: string) => t.replace(/\s/g, '')),
              ),
            ].filter(Boolean)
            return (
              lyric.length >= 8 &&
              old.length > 0 &&
              old.every((t) => current.includes(t)) &&
              current.every((t) => old.includes(t))
            )
          })
          if (exact.length === 1) {
            song.originalId = exact[0].id
            song.originalRevision = exact[0].revision || 0
          } else if (candidates.length)
            song.issues.push(
              '같은 제목의 곡이 있습니다. 연결할 원곡 또는 새 곡 저장을 선택해주세요.',
            )
          song.confirmed = job.automatic && song.issues.length === 0
        }
        job.draft = args.draft
        job.draftRevision++
        await this.store(job)
        return { staged: true, draftRevision: job.draftRevision }
      }),
    )
    register(
      'stage_setlist',
      z
        .object({
          expectedDraftRevision: z.number().int().nonnegative(),
          order: z.array(Id).min(1).max(1000),
        })
        .strict(),
      async (args) =>
        this.serial(async () => {
          const job = structuredClone(this.get(id))
          if (
            !job.draft ||
            job.status !== 'analyzing' ||
            this.controllers.get(id)?.signal.aborted ||
            job.draftRevision !== args.expectedDraftRevision
          )
            throw new Error('현재 초안 버전을 확인해주세요.')
          const draft = { ...job.draft, order: args.order }
          this.checkDraft(job, draft)
          const scope = this.batchSources.get(id)
          if (!scope) throw new Error('현재 분석 파일 범위를 확인해주세요.')
          assertBatchPreserved(job.draft, draft, scope)
          job.draft = draft
          job.draftRevision++
          await this.store(job)
          return { staged: true, draftRevision: job.draftRevision }
        }),
    )
    register('validate_prepared_set', empty, () => this.validation(this.get(id)))
    register(
      'get_prepared_preview',
      z.object({ songId: Id, index: z.number().int().nonnegative() }),
      (args) => this.previewDraft(id, args.songId, args.index),
    )
    register('get_apply_receipt', empty, () => this.receipt(id))
    if (approved)
      register('apply_prepared_set', empty, async () =>
        applySongJob(this.repo, this.get(id), approved),
      )
    const [a, b] = InMemoryTransport.createLinkedPair(),
      client = new Client({ name: 'ProPre app runner', version: '1.0.0' })
    await server.connect(b)
    await client.connect(a)
    return {
      client,
      close: async () => {
        await client.close()
        await server.close()
      },
    }
  }
  async apply(id: string, expected: number): Promise<{ job: SongJob; receipt: ApplyReceipt }> {
    return this.serial(async () => {
      let job = structuredClone(this.get(id))
      const existing = this.receipt(id)
      if (existing) {
        job.status = 'completed'
        return { job: await this.store(job), receipt: existing }
      }
      if (
        job.draftRevision !== expected ||
        !['ready', 'needs_review', 'failed', 'interrupted'].includes(job.status)
      )
        throw new Error('현재 준비 내용을 다시 확인해주세요.')
      for (const source of job.sources) await this.source(job.id, source.id)
      const validation = this.validation(job)
      if (!validation.ready) throw new Error('모든 곡의 가사·송폼을 확인해주세요.')
      job.status = 'committing'
      job = await this.store(job)
      const bridge = await this.bridge(id, validation.planHash)
      try {
        const result = await bridge.client.callTool({ name: 'apply_prepared_set', arguments: {} })
        if (result.isError)
          throw new Error((result.content as { text: string }[])[0]?.text || '저장에 실패했습니다.')
        const receipt = this.receipt(id)
        if (!receipt) throw new Error('저장 결과를 확인하지 못했습니다.')
        job.status = 'completed'
        delete job.error
        return { job: await this.store(job), receipt }
      } catch (e) {
        job.status = 'ready'
        job.error = e instanceof Error ? e.message : '저장에 실패했습니다.'
        await this.store(job)
        throw e
      } finally {
        await bridge.close()
      }
    })
  }
  async undo(id: string) {
    await undoSongApply(this.repo, this.get(id).requestId)
    return this.receipt(id)
  }
  async switchProfile(id: string, profileId: string) {
    return this.serial(async () => {
      const job = structuredClone(this.get(id))
      if (this.controllers.has(id) || ['completed', 'committing'].includes(job.status))
        throw new Error('현재 작업에서는 AI를 바꿀 수 없습니다.')
      job.profile = this.profiles.get(profileId)
      job.automatic = false
      job.status = 'queued'
      delete job.error
      if (job.draft) for (const song of job.draft.songs) song.confirmed = false
      job.draftRevision++
      return this.store(job)
    })
  }
  async analyze(id: string, rawSources?: unknown) {
    return this.serial(async () => {
      if (this.controllers.size)
        throw new Error('다른 분석이 진행 중입니다. 완료하거나 취소해주세요.')
      const job = structuredClone(this.get(id))
      if (['completed', 'committing'].includes(job.status))
        throw new Error('이 작업은 다시 분석할 수 없습니다.')
      const selected =
        z.array(Id).min(1).max(20).optional().parse(rawSources) ||
        job.sources.map((source) => source.id)
      if (selected.some((id) => !job.sources.some((source) => source.id === id)))
        throw new Error('분석할 파일을 다시 선택해주세요.')
      job.analysisSources = [...new Set(selected)]
      const key = this.profiles.key(job.profile.id, job.profile.provider),
        controller = new AbortController()
      this.controllers.set(id, controller)
      job.status = 'analyzing'
      delete job.error
      try {
        await this.store(job)
      } catch (e) {
        this.controllers.delete(id)
        throw e
      }
      void this.run(id, key, controller)
        .catch(() => {})
        .finally(() => this.controllers.delete(id))
      return this.get(id)
    })
  }
  private async run(id: string, key: string, controller: AbortController) {
    const timer = setTimeout(
      () => controller.abort(new DOMException('Analysis timed out', 'TimeoutError')),
      600000,
    )
    let bridge: Awaited<ReturnType<SongJobs['bridge']>> | undefined
    try {
      bridge = await this.bridge(id)
      const discovered = await bridge.client.listTools(),
        tools = discovered.tools.filter(
          (t) => !['get_prepared_preview', 'get_apply_receipt'].includes(t.name),
        ) as ModelTool[]
      const job = this.get(id),
        batches: ProviderFile[][] = [[]]
      let batchBytes = 0
      for (const source of job.sources.filter((source) =>
        job.analysisSources.includes(source.id),
      )) {
        const file = await this.source(id, source.id),
          bytes = Math.ceil((source.bytes * 4) / 3)
        const cap = (job.profile.provider === 'gemini' ? 18 : 28) * 1024 * 1024
        if (bytes > cap)
          throw new Error('이 AI에서 처리할 수 있도록 큰 파일을 나누거나 크기를 줄여주세요.')
        if (batchBytes + bytes > cap) {
          batches.push([])
          batchBytes = 0
        }
        batches.at(-1)!.push(file)
        batchBytes += bytes
      }
      let calls = 0,
        turns = 0
      for (const batch of batches) {
        const provider = new SongProvider(job.profile, key),
          initialRevision = this.get(id).draftRevision
        this.batchSources.set(id, new Set(batch.map((file) => file.id)))
        const prompt = songBatchPrompt(job.instruction, batch)
        for (;;) {
          if (controller.signal.aborted)
            throw new Error('분석이 취소되었거나 제한 시간이 지났습니다.')
          if (++turns > 12)
            throw new Error('AI 응답 횟수 한도에 도달했습니다. 확보한 초안을 확인해주세요.')
          const turn = await provider.turn(
            prompt,
            batch,
            tools,
            controller.signal,
            SONG_PREPARATION_RULES,
          )
          if (controller.signal.aborted) throw new Error('분석이 취소되었습니다.')
          if (turn.usage)
            await this.serial(async () => {
              const current = structuredClone(this.get(id))
              if (controller.signal.aborted || current.status !== 'analyzing') return
              current.usage = { ...current.usage }
              for (const [k, v] of Object.entries(turn.usage))
                current.usage[k] = (current.usage[k] || 0) + v
              await this.store(current)
            })
          if (!turn.calls.length) break
          const results = []
          for (const call of turn.calls) {
            if (++calls > 40) throw new Error('도구 호출 한도에 도달했습니다. 초안을 확인해주세요.')
            if (!tools.some((t) => t.name === call.name) || controller.signal.aborted)
              results.push({ error: '허용되지 않은 도구입니다.' })
            else
              results.push(
                await bridge.client.callTool({
                  name: call.name,
                  arguments: call.arguments as Record<string, unknown>,
                }),
              )
          }
          provider.answer(turn.calls, results)
        }
        if (
          !this.get(id).draft ||
          batch.some(
            (source) =>
              !this.get(id).draft!.songs.some((song) =>
                song.form.parts.some((part) => part.sourceId === source.id),
              ),
          )
        )
          throw new Error(
            '일부 파일의 곡을 준비하지 못했습니다. 확보한 초안을 확인하고 준비된 곡만 사용하거나 다시 분석해주세요.',
          )
        if (this.get(id).draftRevision === initialRevision)
          throw new Error('AI가 유효한 곡 초안을 준비하지 못했습니다. 다시 분석해주세요.')
      }
      await this.serial(async () => {
        const j = structuredClone(this.get(id))
        if (controller.signal.aborted || j.status !== 'analyzing') return j
        j.status = j.draft?.songs.every((s) => s.confirmed) ? 'ready' : 'needs_review'
        return this.store(j)
      })
    } catch (e) {
      await this.serial(async () => {
        const j = structuredClone(this.get(id))
        if (j.status !== 'analyzing') return
        const timedOut =
          controller.signal.aborted && controller.signal.reason?.name === 'TimeoutError'
        j.status = timedOut ? 'interrupted' : controller.signal.aborted ? 'canceled' : 'failed'
        j.error = timedOut
          ? '분석 제한 시간(10분)이 지났습니다. 확보된 초안을 확인하거나 파일을 나누어 다시 분석해주세요.'
          : e instanceof Error
            ? e.message
            : 'AI 분석에 실패했습니다.'
        await this.store(j)
      })
    } finally {
      clearTimeout(timer)
      this.batchSources.delete(id)
      await bridge?.close()
    }
  }
}
