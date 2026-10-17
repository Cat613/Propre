import { createServer } from 'node:http'
import { PDFDocument, rgb } from 'pdf-lib'
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

async function addPDF() {
  const pdf = await PDFDocument.create()
  const first = pdf.addPage([300, 500])
  first.drawRectangle({ x: 0, y: 0, width: 300, height: 500, color: rgb(1, 0, 0) })
  const second = pdf.addPage([500, 300])
  second.drawRectangle({ x: 0, y: 0, width: 500, height: 300, color: rgb(0, 0, 1) })
  const file = path.join(dir, 'fixture.pdf')
  await fs.writeFile(file, await pdf.save())
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  return (await page.evaluate(() => window.ipcRenderer.selectOutputPDFs())).resources.find(
    (r) => r.kind === 'pdf',
  )!
}

test('button Space stays local; keyboard song selection and reordering preserve live output', async () => {
  await page.getByTestId('playlist-item').first().click()
  const menu = page.getByRole('button', { name: '콘티 더 보기', exact: true })
  await menu.focus()
  await menu.press('Space')
  await expect(page.getByTestId('slide-card').first()).not.toHaveAttribute('data-live', 'true')
  await expect(page.getByRole('button', { name: '파일 저장', exact: true })).toBeVisible()
  await menu.press('Escape')
  const second = page.getByTestId('playlist-item').nth(1)
  const id = await second.getAttribute('data-presentation-id')
  await second.focus()
  await second.press('Enter')
  await expect(page.getByTestId('slide-card')).toHaveCount(4)
  await second.press('Alt+ArrowUp')
  await expect(page.getByTestId('playlist-item').first()).toHaveAttribute(
    'data-presentation-id',
    id!,
  )
  await expect(page.getByTestId('slide-card').first()).not.toHaveAttribute('data-live', 'true')
})

test('late PDF preparation cannot send a page that differs from the current input', async () => {
  const r = await addPDF()
  await page.reload()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '미디어', exact: true }).click()
  await page.getByRole('button', { name: `PDF · ${r.name}`, exact: true }).click()
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('prepare-output-resource')
    ipcMain.removeHandler('prepare-output-resource')
    ipcMain.handle('prepare-output-resource', async (...args) => {
      const result = await original(...args)
      await new Promise((resolve) => setTimeout(resolve, 600))
      return result
    })
  })
  await page.getByRole('button', { name: '화면 준비', exact: true }).click()
  const input = page.getByLabel('준비 PDF 페이지', { exact: true })
  await input.fill('2')
  const send = page.getByRole('button', { name: '준비 화면 송출', exact: true })
  await expect(page.getByRole('button', { name: '화면 준비', exact: true })).toBeEnabled()
  await expect(send).toBeDisabled()
  await expect(page.getByAltText('준비 PDF 1페이지', { exact: true })).toHaveCount(0)
  for (const value of ['', '0', '1.5', '3']) {
    await input.fill(value)
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByRole('button', { name: '화면 준비', exact: true })).toBeDisabled()
  }
  await input.fill('2')
  await page.getByRole('button', { name: '화면 준비', exact: true }).click()
  await expect(send).toBeEnabled()
  await expect(page.getByAltText('준비 PDF 2페이지', { exact: true })).toBeVisible()
  await send.click()
  await expect
    .poll(async () => {
      const status = await page.evaluate(() => window.ipcRenderer.getExternalOutput())
      return status.source.kind === 'pdf' ? status.source.page : null
    })
    .toBe(2)
})

test('changing the selected resource closes the previous address editor', async () => {
  await page.evaluate(async () => {
    await window.ipcRenderer.manageOutputResource({
      action: 'create-web',
      name: '자료 A',
      url: 'https://example.com/a',
    })
    await window.ipcRenderer.manageOutputResource({
      action: 'create-web',
      name: '자료 B',
      url: 'https://example.com/b',
    })
  })
  await page.reload()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '미디어', exact: true }).click()
  await page.getByRole('button', { name: '웹 · 자료 A', exact: true }).click()
  await page.getByRole('button', { name: '주소 수정', exact: true }).click()
  await page.getByRole('button', { name: '웹 · 자료 B', exact: true }).click()
  await expect(page.getByLabel('웹 자료 이름', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '주소 수정', exact: true }).click()
  await expect(page.getByLabel('웹 자료 이름', { exact: true })).toHaveValue('자료 B')
})

test('compact creation fits without scrolling and date clicks request a theme-aware calendar', async () => {
  await page.setViewportSize({ width: 1100, height: 700 })
  await page.getByRole('button', { name: '새 콘티', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '새 콘티', exact: true })
  for (const theme of ['light', 'dark']) {
    await page
      .locator('.workbench')
      .evaluate((el, theme) => el.setAttribute('data-theme', theme), theme)
    const date = dialog.getByLabel('예배 날짜', { exact: true })
    expect(await date.evaluate((el) => getComputedStyle(el).colorScheme)).toBe(theme)
    await date.evaluate((el) => {
      ;(el as HTMLInputElement).showPicker = () => {
        el.setAttribute(
          'data-picker-count',
          String(Number(el.getAttribute('data-picker-count') || 0) + 1),
        )
      }
    })
    const box = await date.boundingBox()
    const count = Number((await date.getAttribute('data-picker-count')) || 0)
    for (const fraction of [0.1, 0.3, 0.5, 0.95])
      await date.click({ position: { x: box!.width * fraction, y: box!.height / 2 } })
    await expect(date).toHaveAttribute('data-picker-count', String(count + 4))
    const bounds = await dialog.boundingBox()
    expect(bounds!.height).toBeLessThan(480)
    await expect(dialog.getByRole('button', { name: '콘티 만들기', exact: true })).toBeInViewport()
    await page.screenshot({
      path: `test-results/compact-setlist-${theme}.png`,
      animations: 'disabled',
    })
  }
})

test('deleted songs can be restored through their trash without changing the setlist', async () => {
  const before = (await state()).playlist
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: '찬양 삭제: 예배의 시작', exact: true }).click()
  await expect.poll(async () => (await state()).deletedLibrary.length).toBe(1)
  await page.getByRole('button', { name: '찬양 휴지통', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '찬양 휴지통', exact: true })
  await dialog.getByRole('button', { name: '복원: 예배의 시작', exact: true }).click()
  await expect(dialog.getByText('삭제한 찬양이 없습니다.', { exact: true })).toBeVisible()
  expect((await state()).playlist).toEqual(before)
  expect((await state()).library.some((p) => p.title === '예배의 시작')).toBe(true)
})

async function importAudio() {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, path.resolve('tests/fixtures/silence.wav'))
  await page.evaluate(() => window.ipcRenderer.selectMediaFiles())
}

test('media trash restores deleted audio after autosave without restarting playback', async () => {
  await importAudio()
  await page.reload()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '미디어', exact: true }).click()
  await page.getByRole('button', { name: '미디어 삭제: silence.wav', exact: true }).click()
  await page.getByRole('button', { name: '미디어 휴지통', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '미디어 휴지통', exact: true })
  await dialog.getByRole('button', { name: '복원: silence.wav', exact: true }).click()
  await expect(dialog.getByText('삭제한 미디어가 없습니다.', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '휴지통 닫기', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'silence.wav 음악 준비', exact: true }),
  ).toBeVisible()
  expect(await page.locator('audio').evaluate((el: HTMLAudioElement) => el.paused)).toBe(true)
})

test('web and local audio hand off in both directions without changing the web picture', async () => {
  const server = createServer((_req, res) => res.end('<body>audio handoff fixture</body>'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
    await importAudio()
    await page.evaluate(async (url) => {
      await window.ipcRenderer.saveSettings({ showAudioPlayer: true })
      await window.ipcRenderer.manageOutputResource({
        action: 'create-web',
        name: '오디오 전환 웹',
        url,
      })
    }, url)
    await page.reload()
    await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
    await page.locator('audio').evaluate((el: HTMLAudioElement) => {
      el.muted = true
    })
    await page.getByRole('button', { name: '미디어', exact: true }).click()
    await page.getByRole('button', { name: 'silence.wav 음악 준비', exact: true }).click()
    await page.getByRole('button', { name: 'silence.wav 재생', exact: true }).click()
    await expect
      .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.paused))
      .toBe(false)
    await page
      .locator('.media-filters')
      .getByRole('button', { name: '웹·PDF', exact: true })
      .click()
    await page.getByRole('button', { name: '웹 · 오디오 전환 웹', exact: true }).click()
    await page.getByRole('button', { name: '화면 준비', exact: true }).click()
    await page.getByRole('button', { name: '준비 화면 송출', exact: true }).click()
    await page.getByRole('button', { name: '웹 소리 켜기', exact: true }).click()
    await expect
      .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.paused))
      .toBe(true)
    await page
      .getByLabel('음악 상태')
      .getByRole('button', { name: '이어 재생', exact: true })
      .click()
    await expect
      .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.paused))
      .toBe(false)
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.ipcRenderer.getExternalOutput())).browser?.muted,
      )
      .toBe(true)
    await page.getByRole('button', { name: '웹 소리 켜기', exact: true }).click()
    await page.locator('.media-filters').getByRole('button', { name: '음악', exact: true }).click()
    await page.getByRole('button', { name: 'silence.wav 음악 준비', exact: true }).click()
    await page.getByRole('button', { name: 'silence.wav 재생', exact: true }).click()
    await expect
      .poll(() => page.locator('audio').evaluate((el: HTMLAudioElement) => el.paused))
      .toBe(false)
    const status = await page.evaluate(() => window.ipcRenderer.getExternalOutput())
    expect(status.source.kind).toBe('web')
    expect(status.browser?.muted).toBe(true)
  } finally {
    await page.evaluate(() => window.ipcRenderer.stopExternalOutput()).catch(() => {})
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
