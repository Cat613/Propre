import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
let app: ElectronApplication, page: Page, dir: string, client: Client
const clients: Client[] = []
async function launch() {
  app = await electron.launch({
    args: [path.resolve('dist-electron/main.js')],
    env: {
      ...process.env,
      PROPRE_TEST: '1',
      PROPRE_TEST_HEADLESS: '1',
      PROPRE_TEST_USER_DATA: dir,
    },
  })
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(dir)
  expect(dir).not.toContain('Application Support')
  page = await app.firstWindow()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
}
async function connect(permission: 'read' | 'prepare' = 'prepare') {
  await page.evaluate(
    (permission) => window.ipcRenderer.setAIConnection(true, permission),
    permission,
  )
  const connection = JSON.parse(await fs.readFile(path.join(dir, 'ai-connection.json'), 'utf8'))
  client = new Client({ name: 'propre-electron-test', version: '1' })
  clients.push(client)
  await client.connect(
    new StreamableHTTPClientTransport(new URL(connection.endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${connection.token}` } },
    }),
  )
}
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  return { ...result, data: result.structuredContent as Record<string, any> }
}
async function create(title: string, content = '합성 준비 본문') {
  const result = await call('create_presentation', {
    requestId: randomUUID(),
    title,
    slides: [{ content }],
  })
  expect(result.isError).not.toBe(true)
  expect(result.data.saved).toBe(true)
  return result.data.id as string
}
async function operatorDocument() {
  await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
  await page.getByTestId('slide-card').first().dblclick()
  await page.locator('textarea').first().fill('운영자가 준비한 합성 본문')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('F1')
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  const state = (await call('get_app_state')).data
  return state.selectedPresentationId as string
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-ai-native-'))
  await launch()
})
test.afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => {})))
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
})
test('settings exposes a revocable session and safe stdio configuration with read permission', async () => {
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await page.getByRole('button', { name: '시스템 환경 설정 열기', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '시스템 환경 설정', exact: true })
  await modal.getByRole('button', { name: 'AI 연결', exact: true }).click()
  await expect(modal.getByText('AI 연결 꺼짐', { exact: true })).toBeVisible()
  await modal.getByRole('button', { name: 'AI 연결 허용', exact: true }).click()
  await expect(modal.getByText('AI 연결 대기 중', { exact: true })).toBeVisible()
  await modal.getByLabel('연결할 AI 클라이언트').selectOption('json')
  await modal.getByRole('button', { name: '연결 설정 복사', exact: true }).click()
  const config = await app.evaluate(
    async ({ clipboard }) => JSON.parse(await clipboard.readText()).mcpServers.propre,
  )
  const credential = JSON.parse(await fs.readFile(path.join(dir, 'ai-connection.json'), 'utf8'))
  expect(JSON.stringify(config).includes(credential.token)).toBe(false)
  expect(config.env.ELECTRON_RUN_AS_NODE).toBe('1')
  client = new Client({ name: 'native-stdio-test', version: '1' })
  clients.push(client)
  await client.connect(new StdioClientTransport({ ...config, stderr: 'pipe' }))
  expect((await client.listTools()).tools).toHaveLength(9)
  await expect(modal.getByText('AI 연결됨', { exact: true })).toBeVisible()
  await modal.screenshot({ path: 'test-results/ai-connection-settings.png' })
  await modal.getByRole('button', { name: '창 닫기', exact: true }).click()
  expect(
    (
      await call('create_presentation', {
        requestId: randomUUID(),
        title: '권한 없는 생성',
        slides: [{ content: '합성' }],
      })
    ).data.error.code,
  ).toBe('PERMISSION_DENIED')
  await page.evaluate(() => window.ipcRenderer.setAIConnection(false, 'read'))
  await expect(fs.stat(path.join(dir, 'ai-connection.json'))).rejects.toThrow()
  await expect(client.callTool({ name: 'get_app_state', arguments: {} })).rejects.toThrow(
    /connection unavailable/,
  )
})
test('AI preparation, Bible lookup, repeat playlist and PNG preview preserve current live output and survive restart', async () => {
  await connect()
  const operatorId = await operatorDocument()
  await page.getByTestId('slide-card').first().click()
  await page.evaluate(async () => {
    await window.ipcRenderer.toggleOutput()
    await window.ipcRenderer.toggleStage()
  })
  await expect.poll(() => app.windows().length).toBe(3)
  const output = app.windows().find((p) => p.url().includes('output-display'))!
  await expect(output.getByText('운영자가 준비한 합성 본문', { exact: true })).toBeVisible()
  const song = await create('AI 준비 찬양', '첫 번째 합성 가사\n두 번째 합성 가사')
  const verse = (await call('lookup_bible', { query: '요 3:16' })).data.verses[0]
  expect(typeof verse.content).toBe('string')
  const bibleResult = await call('create_presentation', {
    requestId: randomUUID(),
    title: 'AI 준비 성경',
    slides: [{ type: 'bible', content: verse.content, bibleReference: verse.reference }],
  })
  expect(bibleResult.isError).not.toBe(true)
  const bible = bibleResult.data.id as string
  const list = (await call('get_playlist')).data
  const ordered = await call('set_playlist', {
    requestId: randomUUID(),
    expectedRevision: list.revision,
    presentationIds: [song, bible, song],
  })
  expect(ordered.data.saved).toBe(true)
  expect((await call('get_app_state')).data.selectedPresentationId).toBe(operatorId)
  const doc = (await call('get_presentation', { presentationId: song })).data
  const preview = await call('get_preview', { presentationId: song, slideId: doc.slides[0].id })
  expect(preview.isError).not.toBe(true)
  const image = preview.content.find((item: any) => item.type === 'image') as {
    data: string
    mimeType: string
  }
  expect(image.mimeType).toBe('image/png')
  expect(Buffer.from(image.data, 'base64').subarray(1, 4).toString()).toBe('PNG')
  await fs.mkdir('test-results', { recursive: true })
  await fs.writeFile('test-results/ai-preparation-preview.png', Buffer.from(image.data, 'base64'))
  const dimensions = await app.evaluate(
    ({ nativeImage }, bytes) =>
      nativeImage.createFromBuffer(Buffer.from(bytes, 'base64')).getSize(),
    image.data,
  )
  expect(dimensions.width).toBeGreaterThanOrEqual(960)
  await expect(output.getByText('운영자가 준비한 합성 본문', { exact: true })).toBeVisible()
  const disk = JSON.parse(await fs.readFile(path.join(dir, 'workspace-v4.json'), 'utf8'))
  expect(disk.draft.id).toBe(operatorId)
  expect(
    disk.playlist.map(
      (p: any) =>
        disk.setlistSongs.find((x: any) => x.presentation.id === p.presentationId)
          .sourcePresentationId,
    ),
  ).toEqual([song, bible, song])
  await Promise.all(clients.splice(0).map((c) => c.close()))
  await app.close()
  await launch()
  expect((await page.evaluate(() => window.ipcRenderer.getAIConnection())).enabled).toBe(false)
  await expect(fs.stat(path.join(dir, 'ai-connection.json'))).rejects.toThrow()
  await connect()
  expect((await call('search_presentations', { query: 'AI 준비' })).data.total).toBe(2)
  expect((await call('get_playlist')).data.items.map((p: any) => p.sourcePresentationId)).toEqual([
    song,
    bible,
    song,
  ])
  expect((await call('get_app_state')).data.liveSlideId).toBe(null)
})
test('current-document edits enforce revisions, preserve one-step Undo and reject live changes', async () => {
  await connect()
  const id = await operatorDocument()
  const before = (await call('get_presentation', { presentationId: id })).data
  const args = {
    requestId: randomUUID(),
    presentationId: id,
    expectedRevision: before.revision,
    title: 'AI 수정된 합성 자료',
    patches: [{ slideId: before.slides[0].id, content: 'AI 일괄 수정 본문' }],
    appendSlides: [{ content: '추가한 본문' }],
  }
  const edited = await call('update_presentation', args)
  expect(edited.data).toMatchObject({ saved: true, undoAvailable: true })
  await expect(page.getByText('AI 일괄 수정 본문', { exact: true }).first()).toBeVisible()
  expect((await call('update_presentation', args)).data.revision).toBe(edited.data.revision)
  expect(
    (await call('update_presentation', { ...args, requestId: randomUUID() })).data.error.code,
  ).toBe('REVISION_CONFLICT')
  await page.keyboard.press('Meta+z')
  await expect(page.getByText('운영자가 준비한 합성 본문', { exact: true }).first()).toBeVisible()
  await expect(page.getByTestId('slide-card')).toHaveCount(1)
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  await page.getByTestId('slide-card').first().click()
  const live = (await call('get_presentation', { presentationId: id })).data
  const blocked = await call('update_presentation', {
    requestId: randomUUID(),
    presentationId: id,
    expectedRevision: live.revision,
    patches: [{ slideId: live.slides[0].id, content: '허용되지 않는 수정' }],
  })
  expect(blocked.data.error.code).toBe('LIVE_PROTECTED')
  expect((await call('get_presentation', { presentationId: id })).data.slides[0].content).toBe(
    '운영자가 준비한 합성 본문',
  )
})
test('background edits keep selection and operator history, and stale playlist edits do not overwrite user changes', async () => {
  await connect()
  const operatorId = await operatorDocument(),
    id = await create('다른 합성 자료')
  const before = (await call('get_presentation', { presentationId: id })).data
  const edited = await call('update_presentation', {
    requestId: randomUUID(),
    presentationId: id,
    expectedRevision: before.revision,
    patches: [{ slideId: before.slides[0].id, content: '다른 자료 수정 본문' }],
  })
  expect(edited.data.saved).toBe(true)
  expect(edited.data.undoAvailable).toBe(false)
  expect((await call('get_app_state')).data.selectedPresentationId).toBe(operatorId)
  const playlist = (await call('get_playlist')).data
  const confirmed = await call('set_playlist', {
    requestId: randomUUID(),
    expectedRevision: playlist.revision,
    presentationIds: [id],
  })
  expect(confirmed.data.saved).toBe(true)
  const stale = await call('set_playlist', {
    requestId: randomUUID(),
    expectedRevision: playlist.revision,
    presentationIds: [],
  })
  expect(stale.data.error.code).toBe('REVISION_CONFLICT')
  expect((await call('get_playlist')).data.items.map((p: any) => p.sourcePresentationId)).toEqual([
    id,
  ])
})
test('operator modals and failed background saves return actionable errors without changing confirmed materials', async () => {
  await connect()
  await operatorDocument()
  await page.getByTestId('slide-card').first().dblclick()
  const denied = await call('create_presentation', {
    requestId: randomUUID(),
    title: '편집 중 생성',
    slides: [{ content: '합성' }],
  })
  expect(denied.data.error.code).toBe('OPERATOR_BUSY')
  await page.keyboard.press('Escape')
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  const count = (await call('search_presentations')).data.total
  await fs.rename(path.join(dir, 'workspace-v4.json'), path.join(dir, 'safe-copy.json'))
  await fs.mkdir(path.join(dir, 'workspace-v4.json'))
  const args = { requestId: randomUUID(), title: '저장 실패 자료', slides: [{ content: '합성' }] }
  const failed = await call('create_presentation', args)
  expect(failed.data.error.code).toBe('SAVE_FAILED')
  expect((await call('search_presentations')).data.total).toBe(count)
  await fs.rm(path.join(dir, 'workspace-v4.json'), { recursive: true })
  await fs.rename(path.join(dir, 'safe-copy.json'), path.join(dir, 'workspace-v4.json'))
  expect((await call('create_presentation', args)).data.error.code).toBe('SAVE_FAILED')
  await create('복구 후 새 요청')
})

test('failed selected-document saves preserve the applied edit and journal for an operator retry', async () => {
  await connect()
  const id = await operatorDocument()
  const before = (await call('get_presentation', { presentationId: id })).data
  await fs.rename(path.join(dir, 'workspace-v4.json'), path.join(dir, 'safe-copy.json'))
  await fs.mkdir(path.join(dir, 'workspace-v4.json'))
  const args = {
    requestId: randomUUID(),
    presentationId: id,
    expectedRevision: before.revision,
    patches: [{ slideId: before.slides[0].id, content: '실패 후 복구할 합성 AI 편집' }],
  }
  const failed = await call('update_presentation', args)
  expect(failed.data.error).toMatchObject({ code: 'SAVE_FAILED', applied: true })
  await expect(page.getByText('자동 저장 실패', { exact: true })).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('propre-pending-drafts-v1') || '[]')[0]?.slides[0]?.content,
    ),
  ).toBe('실패 후 복구할 합성 AI 편집')
  expect((await call('update_presentation', args)).data.error).toMatchObject({
    code: 'SAVE_FAILED',
    applied: true,
  })
  await fs.rm(path.join(dir, 'workspace-v4.json'), { recursive: true })
  await fs.rename(path.join(dir, 'safe-copy.json'), path.join(dir, 'workspace-v4.json'))
  await page.getByRole('button', { name: '재시도', exact: true }).click()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  expect(
    JSON.parse(await fs.readFile(path.join(dir, 'workspace-v4.json'), 'utf8')).draft.slides[0]
      .content,
  ).toBe('실패 후 복구할 합성 AI 편집')
})

test('preparation preview follows the same default preset policy as opening and first transmission', async () => {
  await connect()
  const style = {
    fontSize: 80,
    fontColor: '#2563eb',
    fontFamily: 'sans-serif',
    align: 'center',
    verticalAlign: 'center',
  }
  const created = await call('create_presentation', {
    requestId: randomUUID(),
    title: '프리셋 비교 합성 자료',
    slides: [{ content: '프리셋 미리보기 본문' }],
    style,
  })
  await page.evaluate(
    (style) =>
      window.ipcRenderer.saveSettings({
        globalStylePresets: [
          {
            id: 'default-song',
            name: '합성 기본 프리셋',
            style: { ...style, fontColor: '#ef4444' },
          },
        ],
        defaultSongPresetId: 'default-song',
      }),
    style as any,
  )
  await page.reload()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  const doc = (await call('get_presentation', { presentationId: created.data.id })).data
  expect(doc.globalSlideStyle.fontColor).toBe('#2563eb')
  const preview = await call('get_preview', {
    presentationId: created.data.id,
    slideId: doc.slides[0].id,
  })
  expect(preview.isError).not.toBe(true)
  expect(preview.data.styleSource).toBe('default-preset')
  expect(preview.data.effectiveGlobalSlideStyle.fontColor).toBe('#ef4444')
  await page.getByText('프리셋 비교 합성 자료', { exact: true }).first().click()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  expect(
    (await call('get_presentation', { presentationId: created.data.id })).data.globalSlideStyle
      .fontColor,
  ).toBe('#ef4444')
})
