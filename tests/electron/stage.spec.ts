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

let app: ElectronApplication, page: Page, dir: string
const globalStyle = {
  fontSize: 60,
  fontColor: '#60a5fa',
  fontFamily: 'sans-serif',
  align: 'center',
  verticalAlign: 'center',
  lineHeight: 1.2,
  backgroundDim: 0,
}
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
  await app.firstWindow()
  await expect.poll(() => app.windows().some((p) => p.url().includes('control-panel'))).toBe(true)
  page = app.windows().find((p) => p.url().includes('control-panel'))!
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-stage-style-'))
  await launch()
})
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
})
async function importDocument(document: { title: string; [key: string]: unknown }) {
  const file = path.join(dir, 'synthetic-stage.ppros')
  await fs.writeFile(file, JSON.stringify(document))
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  await page.getByRole('button', { name: '파일', exact: true }).click()
  await page.getByRole('button', { name: '프로젝트 불러오기', exact: true }).click()
  await expect(page.locator('h1')).toHaveText(document.title)
}
async function openDisplays() {
  await page.evaluate(async () => {
    await window.ipcRenderer.toggleOutput()
    await window.ipcRenderer.toggleStage()
  })
  await expect.poll(() => app.windows().length).toBe(3)
  return {
    output: app.windows().find((p) => p.url().includes('output-display'))!,
    stage: app.windows().find((p) => p.url().includes('stage-display'))!,
  }
}

test('monitor follows song and scripture styles, updates live, and replays on reopen', async () => {
  await importDocument({
    title: '합성 찬양 스타일',
    globalSlideStyle: globalStyle,
    slides: [
      { id: 'song1', type: 'text', content: '스타일 테스트 찬양 1' },
      {
        id: 'song2',
        type: 'text',
        content: '스타일 테스트 찬양 2',
        styles: { useCustomStyle: true, color: '#f472b6', fontFamily: 'serif', textAlign: 'right' },
      },
    ],
  })
  await expect(page.getByTestId('slide-card')).toHaveCount(2)
  await page.getByTestId('slide-card').first().click()
  const { output, stage } = await openDisplays()
  const current = stage.locator('[data-stage-section="current"]')
  const next = stage.locator('[data-stage-section="next"]')
  await expect(current.getByText('스타일 테스트 찬양 1', { exact: true })).toHaveCSS(
    'color',
    'rgb(96, 165, 250)',
  )
  await expect(current.getByText('스타일 테스트 찬양 1', { exact: true })).toHaveCSS(
    'text-align',
    'center',
  )
  await expect(next.getByText('스타일 테스트 찬양 2', { exact: true })).toHaveCSS(
    'color',
    'rgb(244, 114, 182)',
  )
  await expect(next.getByText('스타일 테스트 찬양 2', { exact: true })).toHaveCSS(
    'font-family',
    'serif',
  )
  await expect(next.locator('[data-stage-reference]')).toHaveCount(0)
  await stage.screenshot({ path: test.info().outputPath('stage-song.png') })
  await importDocument({
    title: '합성 성경 스타일',
    globalSlideStyle: {
      ...globalStyle,
      fontColor: '#ffffff',
      fontFamily: 'serif',
      align: 'left',
      lineHeight: 1.6,
      bibleRefFontColor: '#facc15',
      bibleRefPosition: 'top-right',
    },
    slides: [
      {
        id: 'verse1',
        type: 'bible',
        content: '스타일 테스트 성경 본문 1',
        bibleReference: '합성 1:1',
      },
      {
        id: 'verse2',
        type: 'bible',
        content: '스타일 테스트 성경 본문 2',
        bibleReference: '합성 1:2',
      },
    ],
  })
  await page.getByTestId('slide-card').first().click()
  await expect(current.getByText('스타일 테스트 성경 본문 1', { exact: true })).toHaveCSS(
    'text-align',
    'left',
  )
  await expect(current.getByText('스타일 테스트 성경 본문 1', { exact: true })).toHaveCSS(
    'font-family',
    'serif',
  )
  await expect(current.getByText('스타일 테스트 성경 본문 1', { exact: true })).toHaveCSS(
    'font-weight',
    '400',
  )
  await expect(current.locator('[data-stage-reference]')).toHaveText('합성 1:1')
  await expect(current.locator('[data-stage-reference]')).toHaveCSS('text-align', 'right')
  await expect(next.locator('[data-stage-reference]')).toHaveText('합성 1:2')
  await expect(output.getByText('합성 1:1', { exact: true })).toBeVisible()
  await expect(stage.locator('[data-stage-clock]')).toBeVisible()
  await expect(stage.locator('[data-stage-clock]')).toHaveText(/\d\d:\d\d:\d\d/)
  await stage.screenshot({ path: test.info().outputPath('stage-bible.png') })
  await page.getByRole('button', { name: '스타일', exact: true }).click()
  await page.getByRole('button', { name: '가로 오른쪽 정렬', exact: true }).click()
  await expect(current.getByText('스타일 테스트 성경 본문 1', { exact: true })).toHaveCSS(
    'text-align',
    'right',
  )
  const stylePanel = page.getByRole('heading', { name: '일반 텍스트 전역 스타일' }).locator('..')
  await stylePanel.locator('input[type="number"]').first().fill('100')
  await stylePanel.locator('input[type="text"]').first().fill('#22c55e')
  await stylePanel
    .getByText('글꼴 (Font Family)', { exact: true })
    .first()
    .locator('..')
    .locator('select')
    .selectOption('monospace')
  await expect(current.getByText('스타일 테스트 성경 본문 1', { exact: true })).toHaveCSS(
    'color',
    'rgb(34, 197, 94)',
  )
  await expect(current.getByText('스타일 테스트 성경 본문 1', { exact: true })).toHaveCSS(
    'font-family',
    'monospace',
  )
  await expect(output.getByText('합성 1:1', { exact: true })).toHaveCSS('font-size', '48px')
  await expect(output.getByText('합성 1:1', { exact: true })).toHaveCSS(
    'color',
    'rgb(250, 204, 21)',
  )
  await expect(output.getByText('합성 1:1', { exact: true })).toHaveCSS('font-family', 'serif')
  await expect(current.locator('[data-stage-reference]')).toHaveCSS('color', 'rgb(250, 204, 21)')
  await expect(current.locator('[data-stage-reference]')).toHaveCSS('font-family', 'serif')
  await stage.reload()
  await expect(current.locator('[data-stage-reference]')).toHaveText('합성 1:1')
  await expect(current.getByText('스타일 테스트 성경 본문 1', { exact: true })).toHaveCSS(
    'text-align',
    'right',
  )
  await page.evaluate(async () => {
    await window.ipcRenderer.toggleStage()
    await window.ipcRenderer.toggleStage()
  })
  await expect.poll(() => app.windows().some((p) => p.url().includes('stage-display'))).toBe(true)
  const reopened = app.windows().find((p) => p.url().includes('stage-display'))!
  await expect(
    reopened.locator('[data-stage-section="current"] [data-stage-reference]'),
  ).toHaveText('합성 1:1')
  await expect(reopened.locator('img,video,audio')).toHaveCount(0)
})

test('long scripture and element text fit both monitor regions without covering reference or clock', async () => {
  await importDocument({
    title: '합성 긴 본문',
    globalSlideStyle: {
      ...globalStyle,
      fontFamily: 'serif',
      align: 'left',
      lineHeight: 1.6,
      bibleRefPosition: 'bottom-left',
    },
    slides: [
      {
        id: 'long1',
        type: 'bible',
        content: '긴 본문을 영역 안에 표시하는 합성 문장입니다. '.repeat(20),
        bibleReference: '합성 2:1',
      },
      {
        id: 'long2',
        type: 'bible',
        elements: [
          {
            id: 'body',
            type: 'text',
            text: '다음 본문도 잘리지 않게 표시합니다. '.repeat(12),
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            zIndex: 1,
            coordinateUnit: 'percent',
            styles: { useCustomStyle: true, color: '#f472b6', textAlign: 'right' },
          },
        ],
        bibleReference: '합성 2:2',
      },
    ],
  })
  await page.getByTestId('slide-card').first().click()
  const { stage } = await openDisplays()
  await expect(stage.locator('[data-stage-reference]')).toHaveCount(2)
  await expect(stage.locator('[data-stage-clock]')).toBeVisible()
  await expect
    .poll(() =>
      stage.locator('[data-fitted-content]').evaluateAll((nodes) =>
        nodes.every((node) => {
          const outer = node.parentElement!
          return (
            node.scrollHeight <= outer.clientHeight + 1 && node.scrollWidth <= outer.clientWidth + 1
          )
        }),
      ),
    )
    .toBe(true)
  await expect(stage.locator('[data-stage-section="next"] [data-stage-text]')).toHaveCSS(
    'color',
    'rgb(244, 114, 182)',
  )
  const clock = await stage.locator('[data-stage-clock]').boundingBox()
  const reference = await stage
    .locator('[data-stage-section="current"] [data-stage-reference]')
    .boundingBox()
  expect(reference!.y).toBeGreaterThan(clock!.y + clock!.height)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.getTitle().includes('모니터'))!
      .setBounds({ width: 640, height: 480 }),
  )
  await expect
    .poll(() =>
      stage
        .locator('[data-fitted-content]')
        .evaluateAll((nodes) =>
          nodes.every((node) => node.scrollHeight <= node.parentElement!.clientHeight + 1),
        ),
    )
    .toBe(true)
  await stage.screenshot({ path: test.info().outputPath('stage-bible-small.png') })
  await page.keyboard.press('F1')
  await expect(stage.getByText('송출 대기', { exact: true })).toBeVisible()
  await expect(stage.locator('[data-stage-reference]')).toHaveCount(0)
})

test('configured song and scripture presets apply to existing documents and both live screens', async () => {
  const song = {
    id: 'song-preset',
    name: '합성 찬양 프리셋',
    style: { ...globalStyle, fontSize: 90 },
  }
  const bible = {
    id: 'bible-preset',
    name: '합성 성경 프리셋',
    style: {
      ...globalStyle,
      fontColor: '#ffffff',
      fontFamily: 'serif',
      align: 'left',
      lineHeight: 1.6,
    },
  }
  const createdAt = '2026-10-05T00:00:00.000Z'
  await page.evaluate(
    async ({ song, bible, createdAt, globalStyle }) => {
      await window.ipcRenderer.saveSettings({ globalStylePresets: [song, bible] })
      await window.ipcRenderer.mergeToLibrary([
        {
          id: 'saved-song',
          title: '합성 기존 찬양',
          createdAt,
          updatedAt: createdAt,
          globalSlideStyle: { ...globalStyle, fontColor: '#ef4444' },
          slides: [
            { id: 'song1', type: 'text', content: '기존 찬양 본문 1' },
            { id: 'song2', type: 'text', content: '기존 찬양 본문 2' },
          ],
        },
        {
          id: 'saved-bible',
          title: '합성 기존 성경',
          createdAt,
          updatedAt: createdAt,
          globalSlideStyle: { ...globalStyle, fontColor: '#22c55e' },
          slides: [
            { id: 'verse1', type: 'bible', content: '기존 성경 본문', bibleReference: '합성 3:1' },
          ],
        },
      ])
    },
    { song, bible, createdAt, globalStyle },
  )
  await page.reload()
  await page.getByText('합성 기존 찬양', { exact: true }).click()
  await page.getByTestId('slide-card').first().click()
  const { output, stage } = await openDisplays()
  const current = stage.locator('[data-stage-section="current"] [data-stage-text]')
  await expect(current).toHaveCSS('color', 'rgb(239, 68, 68)')
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await page.getByLabel('성경 기본 프리셋', { exact: true }).selectOption(bible.id)
  await expect(current).toHaveCSS('color', 'rgb(239, 68, 68)')
  await page.getByLabel('일반/찬양 기본 프리셋', { exact: true }).selectOption(song.id)
  await expect(current).toHaveCSS('color', 'rgb(96, 165, 250)')
  await expect(output.getByText('기존 찬양 본문 1', { exact: true })).toHaveCSS(
    'color',
    'rgb(96, 165, 250)',
  )
  await page.getByRole('button', { name: '스타일', exact: true }).click()
  const stylePanel = page.getByRole('heading', { name: '일반 텍스트 전역 스타일' }).locator('..')
  await stylePanel.locator('input[type="text"]').first().fill('#a855f7')
  await page.getByTestId('slide-card').nth(1).click()
  await expect(current).toHaveText('기존 찬양 본문 2')
  await expect(current).toHaveCSS('color', 'rgb(168, 85, 247)')
  await page.getByText('합성 기존 성경', { exact: true }).click()
  await page.getByTestId('slide-card').first().click()
  await expect(current).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(current).toHaveCSS('font-family', 'serif')
  await expect(output.getByText('기존 성경 본문', { exact: true })).toHaveCSS('text-align', 'left')
  await page.getByText('합성 기존 찬양', { exact: true }).click()
  await page.getByTestId('slide-card').first().click()
  await expect(current).toHaveCSS('color', 'rgb(96, 165, 250)')
  await expect(stylePanel.locator('select').first()).toHaveValue(song.id)
  await expect
    .poll(async () => {
      const stored = JSON.parse(await fs.readFile(path.join(dir, 'workspace-v4.json'), 'utf8'))
      return [
        stored.settings.defaultSongPresetId,
        stored.settings.defaultBiblePresetId,
        stored.draft.globalSlideStyle.fontColor,
      ]
    })
    .toEqual([song.id, bible.id, song.style.fontColor])
  await app.close()
  await launch()
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await expect(page.getByLabel('일반/찬양 기본 프리셋', { exact: true })).toHaveValue(song.id)
  await expect(page.getByLabel('성경 기본 프리셋', { exact: true })).toHaveValue(bible.id)
  await page.getByTestId('slide-card').first().click()
  if (!app.windows().some((p) => p.url().includes('stage-display')))
    await page.evaluate(async () => {
      await window.ipcRenderer.toggleStage()
    })
  await expect.poll(() => app.windows().some((p) => p.url().includes('stage-display'))).toBe(true)
  const reopened = app.windows().find((p) => p.url().includes('stage-display'))!
  await expect(reopened.locator('[data-stage-section="current"] [data-stage-text]')).toHaveCSS(
    'color',
    'rgb(96, 165, 250)',
  )
  await page.getByLabel('일반/찬양 기본 프리셋', { exact: true }).selectOption('')
  await page.getByRole('button', { name: '스타일', exact: true }).click()
  await page
    .getByRole('heading', { name: '일반 텍스트 전역 스타일' })
    .locator('..')
    .locator('input[type="text"]')
    .first()
    .fill('#a855f7')
  await page.getByText('합성 기존 성경', { exact: true }).click()
  await page.getByText('합성 기존 찬양', { exact: true }).click()
  await page.getByTestId('slide-card').first().click()
  await expect(reopened.locator('[data-stage-section="current"] [data-stage-text]')).toHaveCSS(
    'color',
    'rgb(168, 85, 247)',
  )
})
