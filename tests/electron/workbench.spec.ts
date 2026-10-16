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
import { Repository } from '../../electron/services/repository'
import { DEFAULT_STYLE } from '../../shared/model'
let app: ElectronApplication, page: Page, dir: string
const now = '2026-10-12T00:00:00.000Z'
const titles = ['예배의 시작', '함께 드리는 찬양', '감사의 기도']
async function state() {
  return page.evaluate(() => window.ipcRenderer.bootstrap())
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-workbench-'))
  const repo = new Repository(dir)
  await repo.open()
  for (const [songIndex, title] of titles.entries())
    await repo.saveDraft({
      id: `song-${songIndex}`,
      title,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      globalSlideStyle: DEFAULT_STYLE,
      slides: Array.from({ length: songIndex === 0 ? 8 : 4 }, (_, i) => ({
        id: `song-${songIndex}-${i}`,
        type: 'text' as const,
        content: `${title}\n${i % 2 ? '모든 마음을 모아\n오늘의 예배를 준비합니다' : '주님 앞에 함께 모여\n감사의 마음으로 노래합니다'}`,
        label: i % 3 === 0 ? 'Verse 1' : i % 3 === 1 ? 'Chorus' : 'Bridge',
        labelColor: i % 3 === 0 ? '#6366f1' : i % 3 === 1 ? '#0ea5e9' : '#a855f7',
      })),
    })
  await repo.setPlaylist(titles.map((_, i) => ({ id: `item-${i}`, presentationId: `song-${i}` })))
  await repo.manageSetlist({
    operation: 'rename',
    id: repo.state.activeSetlistId!,
    expectedRevision: repo.state.setlists[0].revision,
    title: '주일 오전예배',
    date: '2026-10-18',
  })
  await repo.setSettings({
    showAudioPlayer: false,
    globalStylePresets: [
      { id: 'worship', name: '찬양', style: { ...DEFAULT_STYLE, fontSize: 90 } },
    ],
    defaultSongPresetId: 'worship',
  })
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
  await expect.poll(() => app.windows().some((w) => w.url().includes('control-panel'))).toBe(true)
  page = app.windows().find((w) => w.url().includes('control-panel'))!
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
})
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
})

test('editor tools and preview stop controls preserve saved slides and update actual output', async () => {
  await page.getByTestId('playlist-item').first().click()
  await expect(page.getByTestId('slide-card')).toHaveCount(8)
  await page.getByRole('button', { name: '제목 수정', exact: true }).click()
  const title = page.getByRole('textbox', { name: '프레젠테이션 제목', exact: true })
  await title.fill('')
  await expect(title).toHaveValue('')
  await title.fill('예배 시작 찬양')
  await title.press('Enter')
  await expect.poll(async () => (await state()).draft?.title).toBe('예배 시작 찬양')
  await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
  await expect(page.getByTestId('slide-card')).toHaveCount(9)
  await page.getByTestId('slide-card').first().click()
  await page.evaluate(() => window.ipcRenderer.toggleOutput())
  await expect.poll(() => app.windows().some((w) => w.url().includes('output-display'))).toBe(true)
  const output = app.windows().find((w) => w.url().includes('output-display'))!
  await expect(output.getByText('예배의 시작', { exact: false })).toBeVisible()
  await expect(page.getByTestId('slide-card').first()).toHaveAttribute('data-live', 'true')
  await page.getByRole('button', { name: '스타일', exact: true }).click()
  await page.getByRole('button', { name: '가로 오른쪽 정렬', exact: true }).click()
  await expect(output.getByText('예배의 시작', { exact: false })).toHaveCSS('text-align', 'right')
  await page.getByRole('button', { name: '모두 지우기', exact: true }).click()
  await expect(output.getByText('예배의 시작', { exact: false })).toHaveCount(0)
  await expect(page.getByTestId('slide-card')).toHaveCount(9)
  expect((await state()).library.find((song) => song.id === 'song-0')?.title).toBe('예배의 시작')
})

test('library search, tabs, resize handles and settings stay usable without changing the prepared document', async () => {
  await page.getByTestId('playlist-item').first().click()
  await expect
    .poll(async () => {
      const saved = await state()
      return saved.draft?.id === saved.playlist[0].presentationId
    })
    .toBe(true)
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  const before = await state()
  await page.getByRole('textbox', { name: '찬양 검색', exact: true }).fill('없는 제목')
  await expect(page.getByText('검색된 찬양이 없습니다.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '찬양 검색 지우기', exact: true }).click()
  await expect(page.getByTestId('library-item')).toHaveCount(3)
  await page.getByRole('button', { name: 'Bible', exact: true }).click()
  await expect(page.getByPlaceholder('예: 요 3:16, 창 1')).toBeVisible()
  await page.getByRole('button', { name: 'Songs', exact: true }).click()
  for (const label of ['레이어', '설정', '스타일', '미디어']) {
    const tab = page.getByRole('button', { name: label, exact: true })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '모두 지우기', exact: true })).toBeInViewport()
  }
  const handle = page.getByRole('separator', { name: '왼쪽 패널 너비 조절', exact: true })
  const bounds = (await handle.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 65, bounds.y + bounds.height / 2, { steps: 8 })
  await page.mouse.up()
  expect((await state()).draft).toEqual(before.draft)
  expect((await state()).playlist.map((item) => item.id)).toEqual(
    before.playlist.map((item) => item.id),
  )
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await page.getByRole('checkbox', { name: '오디오 플레이어 표시', exact: true }).check()
  await expect(page.getByRole('button', { name: '오디오 선택', exact: true })).toBeVisible()
})

test('all three panels render cleanly at desktop and compact widths and keep primary actions in view', async () => {
  await page.getByTestId('playlist-item').first().click()
  await page.getByTestId('slide-card').first().click()
  for (const [width, height] of [
    [1440, 960],
    [1100, 800],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('control-panel'))!
          .setSize(size[0], size[1])
      },
      [width, height],
    )
    await expect(
      page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }),
    ).toBeInViewport()
    await expect(page.getByRole('button', { name: '모두 지우기', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: '콘티 보관함', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'AI로 찬양 준비', exact: true })).toBeInViewport()
    expect(
      await page
        .locator('[data-control-root]')
        .evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`workbench-${width}.png`) })
  }
  const preview = page.locator(
    'section[aria-label="메인 송출 미리보기"] > div[data-output-surface]',
  )
  const before = await preview.innerText()
  const more = page.getByRole('button', { name: '콘티 더 보기', exact: true })
  await more.click()
  await expect(page.getByRole('button', { name: '파일 저장', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '파일 저장', exact: true })).toBeHidden()
  expect(await preview.innerText()).toBe(before)
  await more.click()
  await page.locator('h1').click()
  await expect(page.getByRole('button', { name: '파일 저장', exact: true })).toBeHidden()
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-control-root]')!.dataset.theme = 'light'
  })
  const header = await page.getByTestId('setlist-header').boundingBox()
  await page.screenshot({
    path: 'test-results/simple-setlist-header.png',
    animations: 'disabled',
    clip: header!,
  })
  const last = await page.getByTestId('playlist-item').last().boundingBox()
  await page.screenshot({
    path: 'test-results/refined-setlist-panel.png',
    animations: 'disabled',
    clip: {
      x: header!.x,
      y: header!.y,
      width: header!.width,
      height: last!.y + last!.height - header!.y,
    },
  })
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-control-root]')!.dataset.theme = 'dark'
  })
  await page.getByRole('button', { name: '스타일', exact: true }).click()
  await page.screenshot({ path: test.info().outputPath('workbench-style.png') })
})
