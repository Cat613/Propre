import { beforeEach, afterEach, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Repository } from '../electron/services/repository'
import { cuesheetDTO, cuesheetPreset, CuesheetRequest } from '../shared/cuesheet'
import { cuesheetHTML } from '../electron/services/cuesheet-html'
let repo: Repository, dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-cuesheet-unit-'))
  repo = new Repository(dir)
  await repo.open()
  await repo.saveDraft({
    id: 'song',
    title: '합성 찬양',
    revision: 1,
    createdAt: '2026-10-16T00:00:00Z',
    updatedAt: '2026-10-16T00:00:00Z',
    slides: [
      { id: 'verse', type: 'text', label: '1절', content: '출력하지 않는 전체 가사' },
      { id: 'chorus', type: 'text', label: '후렴', content: '비공개 가사' },
    ],
  })
  await repo.setPlaylist([{ id: 'row', presentationId: 'song' }])
  const list = repo.state.setlists[0],
    plan = structuredClone(list.servicePlan!)
  plan.plannedStartAt = '2026-10-16T23:59:00+09:00'
  Object.assign(plan.items[0], {
    leader: '비공개 담당자',
    operatorNote: '비공개 운영 메모',
    stageNote: '비공개 무대 초안',
    durationSeconds: 120,
  })
  plan.items.push({
    id: 'prayer',
    kind: 'prayer',
    title: '기도 <script>hacked=true</script> & "평안"',
    enter: { visual: 'keep', audio: 'keep' },
  })
  plan.items.push({
    id: 'end',
    kind: 'custom',
    title: '마침',
    enter: { visual: 'black', audio: 'stop' },
    materialPending: true,
  })
  await repo.saveServicePlan({
    requestId: randomUUID(),
    setlistId: list.id,
    expectedSetlistRevision: list.revision,
    plan,
  })
})
afterEach(async () => fs.rm(dir, { recursive: true, force: true }))
const dto = (preset: 'public' | 'team' | 'operator' = 'public') =>
  cuesheetDTO(
    repo.workspace(),
    repo.state.activeSetlistId!,
    cuesheetPreset(preset),
    '2026-10-16T00:00:00Z',
  )
it('public allowlist excludes private notes, leaders, full lyrics, filesystem paths and runtime, including pending slots', () => {
  const document = dto(),
    text = JSON.stringify(document)
  for (const value of [
    '비공개',
    '전체 가사',
    dir,
    'startedAt',
    'stageMessage',
    'requestId',
    'binding',
    'presentationId',
  ])
    expect(text).not.toContain(value)
  expect(document.rows[2].details).toEqual([{ label: '자료', text: '자료 미정' }])
  expect(document.included).toEqual([])
  expect(document.rows[1].duration).toBe('미정')
})
it('team section order and operator selected fields are explicit without exporting stage drafts by default', () => {
  expect(dto('team').rows[0].details).toEqual([{ label: '구간', text: '1절 → 후렴' }])
  const operator = dto('operator')
  expect(operator.rows[0].leader).toBe('비공개 담당자')
  expect(operator.rows[0].details).toContainEqual({ label: '운영 메모', text: '비공개 운영 메모' })
  expect(JSON.stringify(operator)).not.toContain('비공개 무대 초안')
  expect(operator.included).toEqual(['담당자', '운영 메모'])
})
it('planned times preserve unknown duration and mark midnight offsets rather than inventing zero durations', () => {
  const options = { ...cuesheetPreset('public'), times: true },
    document = cuesheetDTO(repo.workspace(), repo.state.activeSetlistId!, options)
  expect(document.rows.map((row) => row.time)).toEqual(['23:59', '00:01 +1일', '미정'])
})
it('only an explicitly selected hostname can leave a web binding; credentials, path, query and fragments never do', () => {
  const workspace = repo.workspace(),
    list = workspace.setlists[0]
  list.servicePlan!.items[1].binding = { kind: 'resource', resourceId: 'web' }
  workspace.cueResources.push({
    ownerSetlistId: list.id,
    resource: {
      id: 'web',
      kind: 'web',
      name: '합성 웹',
      url: 'https://example.org/private?secret=token#fragment',
      revision: 1,
      createdAt: '2026-10-16T00:00:00Z',
      updatedAt: '2026-10-16T00:00:00Z',
    },
  })
  const defaults = cuesheetDTO(workspace, list.id, cuesheetPreset('operator'))
  expect(JSON.stringify(defaults)).not.toContain('example.org')
  const selected = cuesheetDTO(workspace, list.id, {
    ...cuesheetPreset('public'),
    hosts: true,
    stageNote: true,
  })
  expect(selected.rows[1].details).toEqual([{ label: '웹', text: 'example.org' }])
  expect(selected.rows[0].details).toContainEqual({ label: '무대 초안', text: '비공개 무대 초안' })
  for (const secret of ['private', 'secret', 'token', 'fragment', 'https://'])
    expect(JSON.stringify(selected)).not.toContain(secret)
})
it('frozen DTO and escaped static HTML remain independent of later edits and reject undocumented output fields', () => {
  const document = dto(),
    revision = document.revision,
    html = cuesheetHTML(document, cuesheetPreset('public'))
  repo.state.setlists[0].servicePlan!.items[0].title = '이후 변경'
  repo.state.setlists[0].revision++
  expect(document.revision).toBe(revision)
  expect(document.rows[0].title).not.toBe('이후 변경')
  expect(html).toContain('&lt;script&gt;hacked=true&lt;/script&gt; &amp; &quot;평안&quot;')
  expect(html).not.toContain('<script>')
  expect(html).toContain("default-src 'none'")
  expect(
    CuesheetRequest.safeParse({
      requestId: randomUUID(),
      setlistId: 'x',
      revision: 0,
      options: { ...cuesheetPreset('public'), rawHTML: 'bad' },
    }).success,
  ).toBe(false)
})
