import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { Repository } from '../../electron/services/repository'
import { DEFAULT_STYLE } from '../../shared/model'
const now = '2026-10-06T00:00:00.000Z'
let app: ElectronApplication, page: Page, dir: string, pdf: string
async function launch() {
  app = await electron.launch({
    args: [path.resolve('dist-electron/main.js')],
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: '',
      PROPRE_TEST: '1',
      PROPRE_TEST_HEADLESS: '1',
      PROPRE_TEST_USER_DATA: dir,
    },
  })
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(dir)
  expect(dir).not.toContain('Application Support')
  await app.firstWindow()
  await expect.poll(() => app.windows().some((w) => w.url().includes('control-panel'))).toBe(true)
  page = app.windows().find((w) => w.url().includes('control-panel'))!
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
}
async function stop() {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
}
const state = () => page.evaluate(() => window.ipcRenderer.bootstrap())
async function mock(provider: 'gemini' | 'openai' | 'claude', uncertain = false) {
  await app.evaluate(
    ({ dialog }, options) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [options.pdf] })
      const originalFetch = globalThis.fetch
      let n = 0
      globalThis.fetch = async (input, init) => {
        if (
          !String(input).includes('generativelanguage.googleapis.com') &&
          !String(input).includes('api.openai.com') &&
          !String(input).includes('api.anthropic.com')
        )
          return originalFetch(input, init)
        const body = JSON.parse(init!.body as string)
        const text =
          body.contents?.[0]?.parts?.[0]?.text ||
          body.input?.[0]?.content?.[0]?.text ||
          body.messages?.[0]?.content?.[0]?.text
        const source = JSON.parse(text.match(/현재 첨부 파일\(첨부 순서\): ([^\n]+)/)![1])[0]
          .sourceId
        const draft = {
          songs: [
            {
              id: 'song',
              title: 'AI 합성 찬양',
              formEvidence: options.uncertain ? 'inferred' : 'explicit',
              issues: options.uncertain ? ['순서를 확인해주세요.'] : [],
              confirmed: false,
              originalId: null,
              originalRevision: null,
              updateOriginal: false,
              form: {
                parts: [
                  {
                    id: 'A',
                    label: 'A',
                    pages: ['AI 합성 찬양 가사'],
                    sourceId: source,
                    sourcePage: 1,
                  },
                  {
                    id: 'B',
                    label: 'B',
                    pages: ['AI 합성 후렴 가사'],
                    sourceId: source,
                    sourcePage: 1,
                  },
                ],
                sequence: [
                  { partId: 'A', repeat: 1 },
                  { partId: 'B', repeat: 2 },
                ],
              },
            },
          ],
          order: ['song'],
        }
        const call = ++n === 1
        return new Response(
          JSON.stringify(
            options.provider === 'gemini'
              ? {
                  candidates: [
                    {
                      content: {
                        role: 'model',
                        parts: [
                          call
                            ? {
                                functionCall: {
                                  name: 'stage_song_drafts',
                                  args: { expectedDraftRevision: 0, draft },
                                },
                              }
                            : { text: 'complete' },
                        ],
                      },
                    },
                  ],
                }
              : options.provider === 'openai'
                ? {
                    status: 'completed',
                    output: call
                      ? [
                          {
                            type: 'function_call',
                            call_id: 'synthetic-call',
                            name: 'stage_song_drafts',
                            arguments: JSON.stringify({ expectedDraftRevision: 0, draft }),
                          },
                        ]
                      : [
                          {
                            type: 'message',
                            role: 'assistant',
                            content: [{ type: 'output_text', text: 'complete' }],
                          },
                        ],
                  }
                : {
                    content: call
                      ? [
                          {
                            type: 'tool_use',
                            id: 'synthetic-call',
                            name: 'stage_song_drafts',
                            input: { expectedDraftRevision: 0, draft },
                          },
                        ]
                      : [{ type: 'text', text: 'complete' }],
                  },
          ),
        )
      }
    },
    { pdf, provider, uncertain },
  )
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-ai-native-'))
  pdf = path.join(dir, 'synthetic.pdf')
  const document = await PDFDocument.create()
  document.addPage([300, 400]).drawText('Synthetic song source')
  await fs.writeFile(pdf, await document.save())
  const repo = new Repository(dir)
  await repo.open()
  await repo.saveDraft({
    id: 'operator',
    title: '운영자 합성 찬양',
    createdAt: now,
    updatedAt: now,
    revision: 1,
    slides: [{ id: 'operator-slide', type: 'text', content: '운영자 합성 원문' }],
    globalSlideStyle: DEFAULT_STYLE,
  })
  await repo.setPlaylist([{ id: 'before', presentationId: 'operator' }])
  await launch()
})
test.afterEach(async () => {
  await stop()
  await fs.rm(dir, { recursive: true, force: true })
})
test('AI connection form closes locally with cancel, its close button and Escape at compact height', async () => {
  await page.setViewportSize({ width: 1024, height: 768 })
  const before = await page.evaluate(() => window.ipcRenderer.listAIProfiles())
  await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'AI로 찬양 준비' })
  await panel.getByLabel('송폼과 추가 지시').fill('기존 준비 지시 유지')
  const toggle = panel.locator('button[aria-controls="song-ai-connections"]')
  const form = panel.locator('#song-ai-connections')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await form.getByLabel('AI 제공자').selectOption('openai')
  await form.getByLabel('AI API 키').fill('synthetic-unsaved-key')
  await form.getByRole('button', { name: '취소', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(toggle).toBeFocused()
  await expect(panel.getByLabel('송폼과 추가 지시')).toHaveValue('기존 준비 지시 유지')
  expect(await page.evaluate(() => window.ipcRenderer.listAIProfiles())).toEqual(before)

  await toggle.click()
  await expect(form.getByLabel('AI API 키')).toHaveValue('')
  await form.getByRole('button', { name: 'AI 연결 추가 닫기', exact: true }).click()
  await expect(form).toHaveCount(0)
  await toggle.click()
  await form.getByLabel('AI API 키').focus()
  await page.keyboard.press('Escape')
  await expect(form).toHaveCount(0)
  await expect(panel).toBeVisible()
  await expect(toggle).toBeFocused()

  await toggle.click()
  await form.getByRole('button', { name: '취소', exact: true }).scrollIntoViewIfNeeded()
  await expect(panel.getByRole('button', { name: 'AI 준비 창 닫기' })).toBeInViewport()
  await panel.getByRole('button', { name: 'AI 준비 창 닫기' }).click()
  await expect(panel).toHaveCount(0)
})
test('Gemini quota failure explains project limits and preserves the current setlist and draft', async () => {
  const before = await state()
  await page.evaluate(() =>
    window.ipcRenderer.saveAIProfile(
      { id: 'synthetic-quota', name: '합성 Gemini', provider: 'gemini', model: 'synthetic' },
      'synthetic-private-key',
      true,
    ),
  )
  await app.evaluate(({ dialog }, sourcePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] })
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) =>
      String(input).includes('generativelanguage.googleapis.com')
        ? new Response(
            JSON.stringify({
              error: {
                message: 'synthetic-private-key private source content',
                details: [{ violations: [{ quotaValue: '0' }] }],
              },
            }),
            { status: 429 },
          )
        : originalFetch(input, init)
  }, pdf)
  await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'AI로 찬양 준비' })
  await panel.getByRole('button', { name: 'PDF·이미지 파일 선택' }).click()
  await panel.getByRole('button', { name: '분석 시작', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('할당량이 0')
  await expect(panel.getByRole('alert')).toContainText('Google AI Studio')
  await expect(panel.getByRole('alert')).not.toContainText('synthetic-private-key')
  await expect(panel.getByRole('alert')).not.toContainText('private source content')
  const after = await state()
  expect(after.playlist).toEqual(before.playlist)
  expect(after.draft).toEqual(before.draft)
  expect(after.library).toEqual(before.library)
})
test('switching the selected AI routes an existing failed OpenAI job to Gemini only', async () => {
  await page.evaluate(async () => {
    await window.ipcRenderer.saveAIProfile(
      { id: 'selection-openai', name: '테스트 OpenAI', provider: 'openai', model: 'synthetic' },
      'synthetic-test-key',
      true,
    )
    await window.ipcRenderer.saveAIProfile(
      { id: 'selection-gemini', name: '테스트 Gemini', provider: 'gemini', model: 'synthetic' },
      'synthetic-test-key',
      true,
    )
  })
  await app.evaluate(({ dialog }, sourcePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] })
    const originalFetch = globalThis.fetch
    ;(globalThis as any).selectionRequests = []
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      if (!url.includes('api.openai.com') && !url.includes('generativelanguage.googleapis.com'))
        return originalFetch(input, init)
      ;(globalThis as any).selectionRequests.push(
        url.includes('api.openai.com') ? 'openai' : 'gemini',
      )
      return new Response(JSON.stringify({ error: { type: 'insufficient_quota' } }), {
        status: 429,
      })
    }
  }, pdf)
  await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'AI로 찬양 준비' })
  await panel.getByLabel('사용할 AI').selectOption('selection-openai')
  await panel.getByRole('button', { name: 'PDF·이미지 파일 선택' }).click()
  await panel.getByRole('button', { name: '분석 시작', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('OpenAI API (429)')
  await panel.getByLabel('사용할 AI').selectOption('selection-gemini')
  await expect(panel.getByRole('alert')).toContainText('이전 분석 오류 · 테스트 OpenAI')
  await expect(panel.getByRole('note')).toContainText('테스트 Gemini')
  await expect(panel.getByRole('button', { name: '분석 시작', exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: '선택한 AI로 파일을 다시 전송해 분석' }).click()
  await expect(panel.getByRole('alert')).toContainText('Gemini API (429)')
  expect(await app.evaluate(() => (globalThis as any).selectionRequests)).toEqual([
    'openai',
    'gemini',
  ])
  const jobs = await page.evaluate(() => window.ipcRenderer.listSongJobs())
  expect(jobs[0].profile.provider).toBe('gemini')
})
test('PDF review, form correction, new-song registration, append, undo and restart keep operator draft and live output', async () => {
  await page.getByTestId('slide-card').first().click()
  await page.evaluate(async () => {
    await window.ipcRenderer.toggleOutput()
    await window.ipcRenderer.toggleStage()
  })
  await expect.poll(() => app.windows().length).toBe(3)
  const before = await state(),
    output = app.windows().find((w) => w.url().includes('output-display'))!
  await expect(output.getByText('운영자 합성 원문', { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    await window.ipcRenderer.saveAIProfile(
      { id: 'synthetic-gemini', name: '합성 Gemini', provider: 'gemini', model: 'synthetic' },
      'synthetic-test-key',
      true,
    )
  })
  await mock('gemini')
  await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'AI로 찬양 준비' })
  await panel.getByRole('button', { name: 'PDF·이미지 파일 선택' }).click()
  await panel.getByRole('button', { name: '분석 시작', exact: true }).click()
  await expect(panel.getByRole('status')).toHaveText('가사와 송폼 확인 필요')
  expect((await state()).library).toHaveLength(1)
  await panel.getByText('원본 확인', { exact: true }).click()
  await expect
    .poll(() =>
      panel
        .locator('canvas[aria-label="PDF 원문 1페이지"]')
        .evaluate((node: HTMLCanvasElement) => node.width),
    )
    .toBeGreaterThan(300)
  await panel.getByLabel('파트 1 가사').fill('사용자가 수정한 합성 가사')
  await panel.getByLabel('순서 2 반복').fill('3')
  await panel.getByLabel('이 곡의 가사와 송폼 확인 완료').check()
  await expect(panel.getByText('슬라이드 미리보기 · 4장', { exact: true })).toBeVisible()
  await panel.screenshot({ path: test.info().outputPath('ai-song-review.png') })
  await panel.getByRole('button', { name: '플레이리스트에 적용', exact: true }).click()
  await expect(panel.getByRole('status')).toHaveText('콘티 준비 완료')
  const after = await state()
  expect(after.playlist).toHaveLength(2)
  expect(after.playlist[0].id).toBe(before.playlist[0].id)
  expect(after.library).toHaveLength(2)
  expect(after.draft).toEqual(before.draft)
  expect(after.live).toEqual(before.live)
  expect(after.playlist[1].presentation.slides[0].content).toBe('사용자가 수정한 합성 가사')
  expect(after.playlist[1].presentation.songForm).toBeTruthy()
  await expect(output.getByText('운영자 합성 원문', { exact: true })).toBeVisible()
  expect(await output.evaluate(() => typeof window.ipcRenderer.applySongJob)).toBe('undefined')
  await panel.getByRole('button', { name: '이번 순서 적용 되돌리기' }).click()
  await expect.poll(async () => (await state()).playlist.length).toBe(1)
  expect((await state()).library).toHaveLength(2)
  await stop()
  await launch()
  await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
  await expect(page.getByText('순서를 되돌렸습니다', { exact: true })).toBeVisible()
  expect((await state()).draft).toEqual(before.draft)
})
for (const provider of ['openai', 'claude'] as const)
  test(`${provider} API adapter supports selected connection and automatic replace through scoped MCP`, async () => {
    await page.evaluate(async (provider) => {
      await window.ipcRenderer.saveAIProfile(
        { id: 'synthetic-provider', name: '합성 AI', provider, model: 'synthetic' },
        'synthetic-test-key',
        true,
      )
    }, provider)
    const before = await state()
    await mock(provider)
    await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'AI로 찬양 준비' })
    await panel.getByLabel('플레이리스트 설정').selectOption('replace')
    await panel.getByLabel('AI 적용 방식').selectOption('automatic')
    await panel.getByRole('button', { name: 'PDF·이미지 파일 선택' }).click()
    await panel.getByRole('button', { name: '분석 시작', exact: true }).click()
    await expect(panel.getByRole('status')).toHaveText('콘티 준비 완료')
    const after = await state()
    expect(after.playlist).toHaveLength(1)
    expect(after.playlist[0].presentation.title).toBe('AI 합성 찬양')
    expect(after.library).toHaveLength(2)
    expect(after.draft).toEqual(before.draft)
    const jobs = await page.evaluate(() => window.ipcRenderer.listSongJobs())
    expect(jobs[0].profile.provider).toBe(provider)
    expect(
      (await page.evaluate((id) => window.ipcRenderer.songReceipt(id), jobs[0].id))?.added,
    ).toBe(1)
  })
test('uncertain form pauses automatic replace and invalid edits remain reviewable without modifying the setlist', async () => {
  await page.evaluate(async () => {
    await window.ipcRenderer.saveAIProfile(
      { id: 'synthetic', name: '합성 AI', provider: 'gemini', model: 'synthetic' },
      'synthetic-test-key',
      true,
    )
  })
  const before = await state()
  await mock('gemini', true)
  await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'AI로 찬양 준비' })
  await panel.getByLabel('AI 적용 방식').selectOption('automatic')
  await panel.getByRole('button', { name: 'PDF·이미지 파일 선택' }).click()
  await panel.getByRole('button', { name: '분석 시작', exact: true }).click()
  await expect(panel.getByRole('status')).toHaveText('가사와 송폼 확인 필요')
  expect((await state()).playlist).toEqual(before.playlist)
  await panel.getByLabel('순서 2 반복').fill('0')
  await panel.getByRole('button', { name: '검토 내용 저장', exact: true }).click()
  await expect(panel.getByRole('alert')).toBeVisible()
  expect((await state()).playlist).toEqual(before.playlist)
  await panel.getByLabel('순서 2 반복').fill('2')
  await panel.getByRole('button', { name: '검토 내용 저장', exact: true }).click()
  await expect(panel.getByRole('alert')).toHaveCount(0)
  await panel.getByRole('button', { name: 'AI 준비 창 닫기' }).click()
})

test('image import uses a real decoded source, review edits persist when closing, and retention preference persists', async () => {
  const image = path.join(dir, 'synthetic.png')
  const base64 = await app.evaluate(({ nativeImage }) => {
    const data = Buffer.alloc(400 * 200 * 4, 255)
    return nativeImage
      .createFromBitmap(data, { width: 400, height: 200 })
      .toPNG()
      .toString('base64')
  })
  await fs.writeFile(image, Buffer.from(base64, 'base64'))
  pdf = image
  await page.evaluate(async () => {
    await window.ipcRenderer.saveAIProfile(
      { id: 'image-ai', name: '합성 이미지 AI', provider: 'gemini', model: 'synthetic' },
      'synthetic-test-key',
      true,
    )
  })
  await mock('gemini')
  await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
  let panel = page.getByRole('dialog', { name: 'AI로 찬양 준비' })
  await panel.getByRole('button', { name: 'PDF·이미지 파일 선택' }).click()
  await panel.getByRole('button', { name: '분석 시작', exact: true }).click()
  await expect(panel.getByRole('status')).toHaveText('가사와 송폼 확인 필요')
  await panel.getByText('원본 확인', { exact: true }).click()
  await expect(panel.getByRole('img', { name: '분석 원본' })).toBeVisible()
  await panel.getByLabel('원본과 작업본 계속 보관').check()
  await panel.getByLabel('파트 1 가사').fill('닫기 전에 수정한 합성 가사')
  await panel.getByRole('button', { name: 'AI 준비 창 닫기' }).click()
  await expect(panel).toHaveCount(0)
  await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
  panel = page.getByRole('dialog', { name: 'AI로 찬양 준비' })
  await expect(panel.getByLabel('파트 1 가사')).toHaveValue('닫기 전에 수정한 합성 가사')
  await expect(panel.getByLabel('원본과 작업본 계속 보관')).toBeChecked()
  const jobs = await page.evaluate(() => window.ipcRenderer.listSongJobs())
  expect(jobs[0].sources[0].mime).toBe('image/png')
  expect((await state()).library).toHaveLength(1)
})
