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
  await expect(panel.getByLabel('플레이리스트 설정')).toBeHidden()
  await expect(panel.getByRole('button', { name: 'PDF·이미지 파일 선택' })).toBeInViewport()
  await page.screenshot({ path: 'test-results/ai-preparation-empty.png' })
  await page
    .locator('.workbench')
    .evaluate((element) => element.setAttribute('data-theme', 'light'))
  await page.screenshot({ path: 'test-results/studio-prepare-light.png' })
  await page.locator('.workbench').evaluate((element) => element.setAttribute('data-theme', 'dark'))

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
  await expect(panel.getByLabel('플레이리스트 설정')).toBeHidden()
  await expect(panel.getByRole('button', { name: '원본·작업본 삭제', exact: true })).toBeHidden()
  await expect(panel.getByRole('button', { name: '분석 시작', exact: true })).toBeVisible()
  for (const theme of ['light', 'dark']) {
    await page
      .locator('.workbench')
      .evaluate((element, theme) => element.setAttribute('data-theme', theme), theme)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.screenshot({ path: `test-results/ai-preparation-${theme}.png` })
  }
  await page.setViewportSize({ width: 560, height: 800 })
  expect(
    await panel
      .locator('.song-preparation-shell')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  await page.screenshot({ path: 'test-results/ai-preparation-compact.png' })
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
  await panel.getByRole('tab', { name: 'B', exact: false }).click()
  await expect(panel.getByLabel('파트 2 가사')).toHaveValue('AI 합성 후렴 가사')
  await panel.getByLabel('파트 2 가사').fill('파트를 옮겨도 남는 합성 후렴')
  await panel.getByRole('tab', { name: 'B', exact: false }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(panel.getByRole('tab', { name: 'A', exact: false })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await panel.getByLabel('파트 1 가사').fill('사용자가 수정한 합성 가사')
  await panel.getByLabel('순서 2 반복').fill('3')
  await panel.getByLabel('이 곡의 가사와 송폼 확인 완료').check()
  await expect(panel.getByText('슬라이드 미리보기 · 4장', { exact: true })).toBeVisible()
  await panel.getByText('원본 확인', { exact: true }).click()
  await panel.locator('.studio-editor').evaluate((element) => {
    element.scrollTop = 0
  })
  await panel.locator('.studio-reference').evaluate((element) => {
    element.scrollTop = 0
  })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.screenshot({ path: 'test-results/studio-review-dark.png' })
  await page
    .locator('.workbench')
    .evaluate((element) => element.setAttribute('data-theme', 'light'))
  await page.screenshot({ path: 'test-results/studio-review-light.png' })
  await panel.screenshot({ path: test.info().outputPath('ai-song-review.png') })
  await panel.getByRole('button', { name: '플레이리스트에 적용', exact: true }).click()
  await expect(panel.getByRole('status')).toHaveText('콘티 준비 완료')
  await page.screenshot({ path: 'test-results/studio-complete-light.png' })
  await panel.getByRole('button', { name: '작업 기록', exact: true }).click()
  await expect(panel.getByRole('region', { name: '준비 작업 기록' })).toBeVisible()
  await page.screenshot({ path: 'test-results/studio-history-light.png' })
  await panel.locator('.studio-history-item').first().click()
  await expect(panel.getByRole('button', { name: '준비한 콘티 보기' })).toBeVisible()

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
    await panel.getByText('적용 설정', { exact: false }).click()
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
  await panel.getByText('적용 설정', { exact: false }).click()
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
  await panel.getByRole('button', { name: '분석 및 작업 관리' }).click()
  await panel.getByText('작업 정보 및 보관', { exact: true }).click()
  await panel.getByLabel('원본과 작업본 계속 보관').check()
  await panel.getByLabel('파트 1 가사').fill('닫기 전에 수정한 합성 가사')
  await panel.getByRole('button', { name: 'AI 준비 창 닫기' }).click()
  await expect(panel).toHaveCount(0)
  await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
  panel = page.getByRole('dialog', { name: 'AI로 찬양 준비' })
  await expect(panel.getByLabel('파트 1 가사')).toHaveValue('닫기 전에 수정한 합성 가사')
  await panel.getByRole('button', { name: '분석 및 작업 관리' }).click()
  await panel.getByText('작업 정보 및 보관', { exact: true }).click()
  await expect(panel.getByLabel('원본과 작업본 계속 보관')).toBeChecked()
  const jobs = await page.evaluate(() => window.ipcRenderer.listSongJobs())
  expect(jobs[0].sources[0].mime).toBe('image/png')
  expect((await state()).library).toHaveLength(1)
})

test('drafts survive new files, history changes and rebase; invalid changes block navigation and saves lock editing', async () => {
  await page.evaluate(() =>
    window.ipcRenderer.saveAIProfile(
      { id: 'review-flow', name: '검토용 AI', provider: 'gemini', model: 'synthetic' },
      'synthetic-test-key',
      true,
    ),
  )
  await mock('gemini')
  await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'AI로 찬양 준비' })
  await panel.getByRole('button', { name: 'PDF·이미지 파일 선택' }).click()
  await panel.getByRole('button', { name: '분석 시작', exact: true }).click()
  await expect(panel.getByLabel('파트 1 가사')).toBeEditable()
  const original = (await page.evaluate(() => window.ipcRenderer.listSongJobs()))[0]
  await panel.getByLabel('파트 1 가사').fill('새 파일을 열어도 보존할 수정 가사')
  await panel.getByText('다른 파일로 새로 준비', { exact: true }).click()
  await panel.getByRole('button', { name: 'PDF·이미지 파일 선택' }).click()
  await expect(panel.getByRole('status')).toHaveText('분석 대기')
  await expect(panel.getByLabel('파트 1 가사')).toHaveCount(0)
  const next = (await page.evaluate(() => window.ipcRenderer.listSongJobs()))[0]
  expect(next.id).not.toBe(original.id)
  let saved = (await page.evaluate(() => window.ipcRenderer.listSongJobs())).find(
    (job) => job.id === original.id,
  )!
  expect(saved.draft!.songs[0].form.parts[0].pages).toEqual(['새 파일을 열어도 보존할 수정 가사'])
  await panel.getByLabel('최근 준비 작업').selectOption(original.id)
  await expect(panel.getByLabel('파트 1 가사')).toHaveValue('새 파일을 열어도 보존할 수정 가사')
  await panel.getByLabel('순서 2 반복').fill('0')
  await expect(panel.locator('.song-preparation-validation')).toContainText('반복 횟수는 1~20회')
  await panel
    .getByLabel('곡 제목', { exact: true })
    .fill('은혜 가운데 함께 부르는 아주 긴 찬양 제목 '.repeat(8))
  await page.setViewportSize({ width: 560, height: 800 })
  await panel.locator('.song-preparation-validation').scrollIntoViewIfNeeded()
  const overflow = await panel.locator('.song-preparation-shell').evaluate((shell) => {
    const edge = shell.getBoundingClientRect().right
    return Array.from(shell.querySelectorAll('*'))
      .filter((element) => element.getBoundingClientRect().right > edge)
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        width: element.getBoundingClientRect().width,
      }))
  })
  await page.screenshot({ path: 'test-results/ai-preparation-review-compact.png' })
  expect(
    await panel
      .locator('.song-preparation-shell')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
    JSON.stringify(overflow),
  ).toBe(true)
  await page.setViewportSize({ width: 1280, height: 900 })
  await panel.getByLabel('최근 준비 작업').selectOption(next.id)
  await expect(panel.getByLabel('최근 준비 작업')).toHaveValue(original.id)
  await expect(panel.getByLabel('순서 2 반복')).toHaveValue('0')
  await panel.getByRole('button', { name: '수정 취소', exact: true }).click()
  await expect(panel.getByRole('group', { name: '초안 수정 취소 확인' })).toBeVisible()
  await panel.getByRole('button', { name: '계속 수정', exact: true }).click()
  await expect(panel.getByLabel('순서 2 반복')).toHaveValue('0')
  await panel.getByRole('button', { name: '수정 취소', exact: true }).click()
  await panel.getByRole('button', { name: '저장된 초안 복원', exact: true }).click()
  await expect(panel.getByLabel('순서 2 반복')).toHaveValue('2')
  await panel.getByLabel('순서 2 반복').fill('3')
  await panel.getByLabel('파트 1 가사').fill('콘티 재확인 전에도 보존할 가사')
  await panel.getByRole('button', { name: '최신 콘티에 맞춰 다시 확인' }).click()
  await expect(panel.getByLabel('파트 1 가사')).toBeEditable()
  await expect(panel.getByLabel('파트 1 가사')).toHaveValue('콘티 재확인 전에도 보존할 가사')
  saved = (await page.evaluate(() => window.ipcRenderer.listSongJobs())).find(
    (job) => job.id === original.id,
  )!
  expect(saved.draft!.songs[0].form.sequence[1].repeat).toBe(3)
  // Status-only events must not reset a locally edited draft.
  await panel.getByLabel('파트 1 가사').fill('상태 갱신 중에도 유지할 가사')
  await page.evaluate((id) => window.ipcRenderer.retainSongSources(id, true), original.id)
  await expect(panel.getByLabel('파트 1 가사')).toHaveValue('상태 갱신 중에도 유지할 가사')
  await app.evaluate(({ ipcMain }) => {
    const handler = (ipcMain as any)._invokeHandlers.get('edit-song-job')
    ipcMain.removeHandler('edit-song-job')
    ipcMain.handle('edit-song-job', async (...args) => {
      if (!(globalThis as any).saveWaiting) {
        ;(globalThis as any).saveWaiting = true
        await new Promise<void>((resolve) => {
          ;(globalThis as any).releaseDraftSave = resolve
        })
      }
      return handler(...args)
    })
  })
  await panel.getByRole('button', { name: '검토 내용 저장', exact: true }).click()
  await expect.poll(() => app.evaluate(() => (globalThis as any).saveWaiting)).toBe(true)
  await expect(panel.getByLabel('파트 1 가사')).toBeDisabled()
  await expect(panel.getByLabel('최근 준비 작업')).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'AI 준비 창 닫기' })).toBeDisabled()
  await app.evaluate(() => (globalThis as any).releaseDraftSave())
  await expect(panel.getByLabel('파트 1 가사')).toBeEditable()
  await panel.getByLabel('최근 준비 작업').selectOption(next.id)
  await expect(panel.getByLabel('최근 준비 작업')).toHaveValue(next.id)
  await panel.getByLabel('최근 준비 작업').selectOption(original.id)
  await expect(panel.getByLabel('파트 1 가사')).toHaveValue('상태 갱신 중에도 유지할 가사')
  await panel.getByLabel('파트 1 가사').fill('재분석 직전 저장할 가사')
  await panel.getByRole('button', { name: '분석 및 작업 관리' }).click()
  await panel.getByRole('button', { name: '같은 AI로 다시 분석', exact: true }).click()
  await expect(panel.getByRole('status')).toHaveText('분석 중 문제 발생')
  await expect(panel.getByLabel('파트 1 가사')).toHaveValue('재분석 직전 저장할 가사')
  expect(
    (await page.evaluate(() => window.ipcRenderer.listSongJobs())).find(
      (job) => job.id === original.id,
    )!.draft!.songs[0].form.parts[0].pages,
  ).toEqual(['재분석 직전 저장할 가사'])
  await page.evaluate((id) => window.ipcRenderer.cancelSongJob(id), original.id)
  await expect(panel.getByRole('status')).toHaveText('취소됨')
  await panel.getByLabel('파트 1 가사').fill('취소한 분석의 초안도 수정해서 적용')
  await panel.getByLabel('이 곡의 가사와 송폼 확인 완료').check()
  await panel.getByRole('button', { name: '플레이리스트에 적용', exact: true }).click()
  await expect(panel.getByRole('status')).toHaveText('콘티 준비 완료')
})

test('source evidence opens the original, errors can retry, and PDF page changes reuse the loaded document', async () => {
  const document = await PDFDocument.create()
  for (let index = 0; index < 3; index++)
    document.addPage([300, 400]).drawText(`Source page ${index + 1}`)
  await fs.writeFile(pdf, await document.save())
  const longSource = path.join(dir, '긴한글제목의찬양악보'.repeat(5) + '.pdf')
  await fs.rename(pdf, longSource)
  pdf = longSource
  await page.evaluate(() =>
    window.ipcRenderer.saveAIProfile(
      { id: 'source-review', name: '원본 검토용 AI', provider: 'gemini', model: 'synthetic' },
      'synthetic-test-key',
      true,
    ),
  )
  await mock('gemini')
  await app.evaluate(({ ipcMain }) => {
    const handler = (ipcMain as any)._invokeHandlers.get('song-source')
    ;(globalThis as any).sourceReads = 0
    ipcMain.removeHandler('song-source')
    ipcMain.handle('song-source', (...args) => {
      if (++(globalThis as any).sourceReads === 1) throw new Error('Synthetic source read failure')
      return handler(...args)
    })
  })
  await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'AI로 찬양 준비' })
  await panel.getByRole('button', { name: 'PDF·이미지 파일 선택' }).click()
  await panel.getByRole('button', { name: '분석 시작', exact: true }).click()
  await expect(panel.getByLabel('파트 1 가사')).toBeEditable()
  await panel.getByRole('button', { name: '근거:', exact: false }).first().click()
  await expect(panel.getByRole('alert')).toContainText('원본 미리보기를 읽지 못했습니다')
  await panel.getByRole('button', { name: '원본 다시 불러오기' }).click()
  await expect(panel.locator('canvas[aria-label="PDF 원문 1페이지"]')).toBeVisible()
  await panel.getByLabel('원본 페이지', { exact: true }).fill('2')
  await expect(panel.locator('.song-source-preview')).toHaveAttribute('aria-busy', 'false')
  await panel.getByLabel('원본 페이지', { exact: true }).fill('3')
  await expect(panel.locator('canvas[aria-label="PDF 원문 3페이지"]')).toBeVisible()
  expect(await app.evaluate(() => (globalThis as any).sourceReads)).toBe(2)
})

test('late apply receipts never appear in another job and source deletion requires an inline confirmation', async () => {
  await page.evaluate(() =>
    window.ipcRenderer.saveAIProfile(
      { id: 'receipt-review', name: '기록 검토용 AI', provider: 'gemini', model: 'synthetic' },
      'synthetic-test-key',
      true,
    ),
  )
  await mock('gemini')
  await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
  let panel = page.getByRole('dialog', { name: 'AI로 찬양 준비' })
  await panel.getByRole('button', { name: 'PDF·이미지 파일 선택' }).click()
  await panel.getByRole('button', { name: '분석 시작', exact: true }).click()
  await panel.getByLabel('이 곡의 가사와 송폼 확인 완료').check()
  await panel.getByRole('button', { name: '플레이리스트에 적용', exact: true }).click()
  await expect(panel.getByRole('button', { name: '이번 순서 적용 되돌리기' })).toBeVisible()
  const completed = (await page.evaluate(() => window.ipcRenderer.listSongJobs()))[0]
  await panel.getByText('다른 파일로 새로 준비', { exact: true }).click()
  await panel.getByRole('button', { name: 'PDF·이미지 파일 선택' }).click()
  await expect(panel.getByRole('button', { name: '이번 순서 적용 되돌리기' })).toHaveCount(0)
  await expect(panel.getByRole('status')).toHaveText('분석 대기')
  const queued = (await page.evaluate(() => window.ipcRenderer.listSongJobs()))[0]
  await panel.getByRole('button', { name: 'AI 준비 창 닫기' }).click()
  await app.evaluate(({ ipcMain }, completedId) => {
    const handler = (ipcMain as any)._invokeHandlers.get('song-receipt')
    ipcMain.removeHandler('song-receipt')
    ipcMain.handle('song-receipt', async (...args) => {
      if (args[1] === completedId) {
        ;(globalThis as any).receiptWaiting = true
        await new Promise<void>((resolve) => {
          ;(globalThis as any).releaseReceipt = resolve
        })
      }
      const result = await handler(...args)
      if (args[1] === completedId) (globalThis as any).receiptDelivered = true
      return result
    })
  }, completed.id)
  await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
  panel = page.getByRole('dialog', { name: 'AI로 찬양 준비' })
  await panel.getByLabel('최근 준비 작업').selectOption(completed.id)
  await expect.poll(() => app.evaluate(() => (globalThis as any).receiptWaiting)).toBe(true)
  await panel.getByLabel('최근 준비 작업').selectOption(queued.id)
  await expect(panel.getByLabel('최근 준비 작업')).toHaveValue(queued.id)
  await app.evaluate(() => (globalThis as any).releaseReceipt())
  await expect.poll(() => app.evaluate(() => (globalThis as any).receiptDelivered)).toBe(true)
  await expect(panel.getByRole('button', { name: '이번 순서 적용 되돌리기' })).toHaveCount(0)
  const before = await state()
  await panel.getByText('작업 정보 및 보관', { exact: true }).click()
  await panel.getByRole('button', { name: '원본·작업본 삭제', exact: true }).click()
  await expect(panel.getByRole('group', { name: '준비 작업 삭제 확인' })).toBeVisible()
  expect(
    (await page.evaluate(() => window.ipcRenderer.listSongJobs())).some(
      (job) => job.id === queued.id,
    ),
  ).toBe(true)
  await panel.getByRole('button', { name: '삭제 취소', exact: true }).click()
  await expect(panel.getByRole('group', { name: '준비 작업 삭제 확인' })).toHaveCount(0)
  await panel.getByRole('button', { name: '원본·작업본 삭제', exact: true }).click()
  await panel.getByRole('button', { name: '원본·작업본 삭제 확인', exact: true }).click()
  await expect(panel.getByLabel('최근 준비 작업')).toHaveValue('')
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.ipcRenderer.listSongJobs())).some(
        (job) => job.id === queued.id,
      ),
    )
    .toBe(false)
  expect((await state()).library).toEqual(before.library)
  expect((await state()).playlist).toEqual(before.playlist)
})

test('AI connection saving locks input and closing, then reports saved configuration without claiming a network check', async () => {
  await app.evaluate(({ ipcMain }) => {
    const handler = (ipcMain as any)._invokeHandlers.get('save-ai-profile')
    ipcMain.removeHandler('save-ai-profile')
    ipcMain.handle('save-ai-profile', async (...args) => {
      ;(globalThis as any).profileWaiting = true
      await new Promise<void>((resolve) => {
        ;(globalThis as any).releaseProfile = resolve
      })
      return handler(...args)
    })
  })
  await page.getByRole('button', { name: 'AI로 찬양 준비', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'AI로 찬양 준비' })
  await panel.getByRole('button', { name: 'AI 연결 추가', exact: true }).click()
  const form = panel.locator('#song-ai-connections')
  await form.getByLabel('AI 제공자', { exact: true }).selectOption('openai')
  await form.getByLabel('AI API 키').fill('synthetic-test-key')
  await form.getByRole('button', { name: '연결 저장 · 기본으로 사용', exact: true }).click()
  await expect.poll(() => app.evaluate(() => (globalThis as any).profileWaiting)).toBe(true)
  await expect(form.getByLabel('AI 제공자', { exact: true })).toBeDisabled()
  await expect(form.getByLabel('AI API 키')).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'AI 준비 창 닫기' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(form).toBeVisible()
  await app.evaluate(() => (globalThis as any).releaseProfile())
  await expect(form.getByRole('status')).toContainText('실제 모델 연결은 분석할 때 확인')
  await form.getByRole('button', { name: '취소', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'PDF·이미지 파일 선택' })).toBeEnabled()
})
