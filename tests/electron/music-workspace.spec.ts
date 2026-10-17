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
import { LocalMusicSchema } from '../../shared/music'
import { DEFAULT_STYLE } from '../../shared/model'
let app: ElectronApplication, page: Page, dir: string
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
  page = await app.firstWindow()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-ui-'))
  const repo = new Repository(dir)
  await repo.open()
  await repo.manageSetlist({
    operation: 'create',
    title: '음악 통합 시험 예배',
    fromCurrent: false,
    expectedActiveId: null,
    expectedRevision: null,
  })
  const asset = repo.assetURL(await repo.register(path.resolve('tests/fixtures/silence.wav')))
  const list = repo.state.setlists[0]
  await repo.saveMusic({
    setlistId: list.id,
    expectedRevision: list.revision,
    items: [
      {
        id: 'first',
        revision: 0,
        title: '기도 반주',
        source: {
          kind: 'local',
          local: LocalMusicSchema.parse({
            url: asset,
            startSeconds: 1,
            endSeconds: 4,
            loop: true,
            fadeSeconds: 0.5,
          }),
        },
      },
      {
        id: 'second',
        revision: 0,
        title: '헌금 반주',
        source: { kind: 'local', local: LocalMusicSchema.parse({ url: asset, loop: true }) },
      },
      {
        id: 'youtube',
        revision: 0,
        title: '예배 후 재생목록',
        source: {
          kind: 'youtube-music',
          url: 'https://music.youtube.com/playlist?list=PLsample',
          fallback: LocalMusicSchema.parse({ url: asset }),
        },
      },
    ],
  })
  const now = new Date().toISOString()
  await repo.saveDraft({
    id: 'music-ui-song',
    title: '함께 드리는 예배 · 찬양 준비',
    createdAt: now,
    updatedAt: now,
    globalSlideStyle: DEFAULT_STYLE,
    slides: [
      { id: 'music-ui-1', type: 'text', content: '감사의 마음으로\n함께 예배합니다' },
      { id: 'music-ui-2', type: 'text', content: '우리의 마음을 모아\n주님을 찬양합니다' },
    ],
  })
  await repo.setPlaylist([{ id: 'music-ui-row', presentationId: 'music-ui-song' }])
  await launch()
  await page.locator('.media-filters').getByRole('button', { name: '음악', exact: true }).click()
  await expect(page.getByRole('button', { name: '기도 반주 음악 준비', exact: true })).toBeVisible()
})
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
})
async function start() {
  await page.getByRole('button', { name: '기도 반주 음악 준비', exact: true }).click()
  await page.getByRole('button', { name: '준비한 음악 재생', exact: true }).click()
  await expect
    .poll(() =>
      page
        .locator('[data-music-engine]')
        .evaluate((el: HTMLAudioElement) => !el.paused && el.currentTime >= 1),
    )
    .toBe(true)
}
test('preparation is silent, changing tabs preserves one engine, and F2 works inside expanded preview', async () => {
  await expect(page.locator('[data-music-engine]')).toHaveCount(0)
  await start()
  const source = await page.locator('[data-music-engine]').getAttribute('src')
  await page.getByRole('button', { name: '헌금 반주 음악 준비', exact: true }).click()
  await expect(page.getByText('다음 준비: 헌금 반주', { exact: true })).toBeVisible()
  expect(await page.locator('[data-music-engine]').getAttribute('src')).toBe(source)
  await page.getByRole('button', { name: '스타일', exact: true }).click()
  await expect
    .poll(() => page.locator('[data-music-engine]').evaluate((el: HTMLAudioElement) => el.paused))
    .toBe(false)
  await page.getByRole('button', { name: '송출 미리보기 확대', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '메인 송출 미리보기', exact: true })).toBeVisible()
  await page.keyboard.press('F2')
  await expect(page.locator('[data-music-engine]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
test('fades pause at current position and restart restores the configured segment', async () => {
  await start()
  await page.getByText('재생 설정', { exact: true }).click()
  await page.getByRole('button', { name: '0.5초간 줄여 멈춤', exact: true }).click()
  await expect
    .poll(() => page.locator('[data-music-engine]').evaluate((el: HTMLAudioElement) => el.paused))
    .toBe(true)
  await page.getByRole('button', { name: '처음부터', exact: true }).click()
  await expect
    .poll(() =>
      page
        .locator('[data-music-engine]')
        .evaluate((el: HTMLAudioElement) => Math.abs(el.currentTime - 1) < 0.1),
    )
    .toBe(true)
  await page.getByLabel('음악 상태').getByRole('button', { name: '이어 재생', exact: true }).click()
  await expect
    .poll(() => page.locator('[data-music-engine]').evaluate((el: HTMLAudioElement) => el.volume))
    .toBe(0.5)
})
test('unconnected YouTube offers automatic playback, prepared selection survives inspector tabs, and reload stays silent', async () => {
  await page.getByRole('button', { name: '예배 후 재생목록 음악 준비', exact: true }).click()
  await expect(page.getByRole('button', { name: '준비한 음악 재생', exact: true })).toBeEnabled()
  await expect(
    page.getByText('재생을 누르면 Chrome 연결과 곡 준비를 자동으로 처리합니다.', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(page.locator('[data-music-engine]')).toHaveCount(0)
  await page.getByRole('button', { name: '스타일', exact: true }).click()
  await page.getByRole('button', { name: '미디어', exact: true }).click()
  await expect(page.getByText('다음 준비: 예배 후 재생목록', { exact: true })).toBeVisible()
  await app.close()
  await launch()
  await expect(page.locator('[data-music-engine]')).toHaveCount(0)
  expect(
    (await page.evaluate(() => window.ipcRenderer.bootstrap())).setlists[0].music,
  ).toHaveLength(3)
})
test('preview belongs to central command area and media has the right column at supported widths', async () => {
  await page.getByTestId('playlist-item').first().click()
  await page.getByTestId('slide-card').first().click()
  await page.evaluate(() => window.ipcRenderer.toggleOutput())
  for (const [width, height] of [
    [1440, 960],
    [1280, 800],
    [1024, 768],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('control-panel'))!
          .setSize(size[0], size[1]),
      [width, height],
    )
    await expect(
      page.locator('.editor-command-area section[aria-label="메인 송출 미리보기"]'),
    ).toHaveCount(1)
    await expect(page.getByRole('button', { name: '모두 지우기', exact: true })).toBeInViewport()
    expect(
      await page.locator('[data-control-root]').evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`music-layout-${width}.png`) })
    if (width === 1440) {
      await page.locator('[data-control-root]').evaluate((el) => {
        ;(el as HTMLElement).dataset.theme = 'light'
      })
      await expect(page.getByRole('button', { name: '빈 슬라이드 추가', exact: true })).toHaveCSS(
        'color',
        'rgb(30, 41, 59)',
      )
      await page.screenshot({
        path: test.info().outputPath('music-layout-light.png'),
        animations: 'disabled',
      })
      await page.locator('[data-control-root]').evaluate((el) => {
        ;(el as HTMLElement).dataset.theme = 'dark'
      })
    }
  }
})

test('deleting active music preserves playback and undo restores only that item after other edits', async () => {
  await start()
  await page.getByLabel('기도 반주 더 보기', { exact: true }).click()
  await page.getByRole('button', { name: '기도 반주 음악 삭제', exact: true }).click()
  await expect(page.getByRole('button', { name: '기도 반주 음악 준비', exact: true })).toHaveCount(
    0,
  )
  await expect
    .poll(() => page.locator('[data-music-engine]').evaluate((el: HTMLAudioElement) => el.paused))
    .toBe(false)
  await page.getByLabel('헌금 반주 더 보기', { exact: true }).click()
  await page.getByRole('button', { name: '헌금 반주 음악 설정', exact: true }).click()
  await page.getByRole('textbox', { name: '음악 이름', exact: true }).fill('수정한 헌금 반주')
  await page.getByRole('button', { name: '음악 저장', exact: true }).click()
  await page.getByRole('button', { name: '음악 삭제 되돌리기', exact: true }).click()
  await expect(page.getByRole('button', { name: '기도 반주 음악 준비', exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: '수정한 헌금 반주 음악 준비', exact: true }),
  ).toBeVisible()
  await page.getByLabel('수정한 헌금 반주 더 보기', { exact: true }).click()
  await page.getByRole('button', { name: '수정한 헌금 반주 음악 설정', exact: true }).click()
  const input = page.getByRole('textbox', { name: '음악 이름', exact: true })
  await input.fill('입력 중인 음악 이름')
  await input.press('F2')
  await expect(page.locator('[data-music-engine]')).toHaveCount(0)
  await expect(input).toHaveValue('입력 중인 음악 이름')
})

test('a music card plays in one click and puts secondary actions behind more', async () => {
  await expect(page.locator('[data-music-engine]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '기도 반주 음악 설정', exact: true })).toBeHidden()
  await page.getByRole('button', { name: '기도 반주 재생', exact: true }).click()
  await expect
    .poll(() =>
      page
        .locator('[data-music-engine]')
        .evaluate((el: HTMLAudioElement) => !el.paused && el.currentTime >= 1),
    )
    .toBe(true)
  await expect(page.getByRole('button', { name: '준비한 음악 재생', exact: true })).toHaveCount(0)
  await page.getByLabel('기도 반주 더 보기', { exact: true }).click()
  await expect(page.getByRole('button', { name: '기도 반주 음악 설정', exact: true })).toBeVisible()
})

test('player and library separate current playback from a silent next selection', async () => {
  await page.getByRole('button', { name: '기도 반주 재생', exact: true }).click()
  const player = page.getByRole('region', { name: '현재 음악', exact: true })
  await expect(player.getByRole('heading', { name: '기도 반주', exact: true })).toBeVisible()
  await expect(player.getByRole('button', { name: '일시정지', exact: true })).toBeVisible()
  await player.getByRole('button', { name: '일시정지', exact: true }).click()
  await expect(player.getByRole('status')).toHaveText('일시정지')
  await page
    .locator('[data-music-engine]')
    .evaluate((el) => el.setAttribute('data-retained', 'yes'))
  await page.getByRole('button', { name: '기도 반주 재생', exact: true }).click()
  await expect(page.locator('[data-music-engine]')).toHaveAttribute('data-retained', 'yes')
  await expect(player.getByRole('button', { name: '일시정지', exact: true })).toBeVisible()
  await player.getByRole('button', { name: '일시정지', exact: true }).click()
  await page.getByRole('button', { name: '헌금 반주 음악 준비', exact: true }).click()
  await expect(player.getByRole('heading', { name: '기도 반주', exact: true })).toBeVisible()
  const next = page
    .locator('.music-list-item')
    .filter({ has: page.getByRole('button', { name: '헌금 반주 음악 준비', exact: true }) })
  await expect(next.locator('.music-item-state')).toHaveCount(0)
  await page.getByLabel('음악 추가', { exact: true }).click()
  await expect(page.getByRole('button', { name: '오디오 선택', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '유튜브 뮤직 링크', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '오디오 선택', exact: true })).toBeHidden()
  await expect(page.getByLabel('음악 추가', { exact: true })).toBeFocused()
})
test('long Korean titles remain compact in both themes and narrow side panels', async () => {
  await page.evaluate(async () => {
    const state = await window.ipcRenderer.bootstrap()
    const list = state.setlists.find((x) => x.id === state.activeSetlistId)!
    await window.ipcRenderer.saveMusic({
      setlistId: list.id,
      expectedRevision: list.revision,
      items: list.music!.map((item, index) =>
        index === 0
          ? {
              ...item,
              revision: item.revision + 1,
              title:
                '길고 긴 예배 찬양 제목과 함께하는 기도 반주 모음집 그리고 다음 예배를 위한 음악',
            }
          : item,
      ),
    })
  })
  await page.reload()
  await page.locator('.media-filters').getByRole('button', { name: '음악', exact: true }).click()
  await page.locator('.music-item-play').first().click()
  await expect(
    page
      .getByRole('region', { name: '현재 음악', exact: true })
      .getByRole('button', { name: '일시정지', exact: true }),
  ).toBeVisible()
  for (const width of [1280, 1920]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('control-panel'))!
          .setSize(width, 900),
      width,
    )
    for (const theme of ['light', 'dark']) {
      await page.locator('[data-control-root]').evaluate((el, theme) => {
        ;(el as HTMLElement).dataset.theme = theme
      }, theme)
      const layout = await page.locator('.music-panel').evaluate((el) => ({
        fits: el.scrollWidth <= el.clientWidth,
        rows: Array.from(el.querySelectorAll('.music-list-item')).map(
          (row) => row.getBoundingClientRect().height,
        ),
      }))
      expect(layout.fits).toBe(true)
      expect(layout.rows.every((height) => height <= 84)).toBe(true)
      await page.screenshot({
        path: test.info().outputPath(`music-redesign-${theme}-${width}.png`),
        animations: 'disabled',
      })
      await page.locator('.music-panel').screenshot({
        path: test.info().outputPath(`music-panel-${theme}-${width}.png`),
        animations: 'disabled',
      })
    }
  }
})
