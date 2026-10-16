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
  await app.firstWindow()
  await expect
    .poll(() => app.windows().some((window) => window.url().includes('control-panel')))
    .toBe(true)
  page = app.windows().find((window) => window.url().includes('control-panel'))!
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
}
async function workspace() {
  return JSON.parse(await fs.readFile(path.join(dir, 'workspace-v4.json'), 'utf8'))
}
async function draft() {
  return (await workspace()).draft
}
async function openDialog() {
  await page.getByRole('button', { name: '성경 구절 추가', exact: true }).click()
  return page.getByRole('dialog', { name: '성경 구절 추가', exact: true })
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-bible-insert-'))
  await launch()
  const file = path.join(dir, 'synthetic-song.ppros')
  await fs.writeFile(
    file,
    JSON.stringify({
      title: '성경 삽입 테스트 찬양',
      slides: [
        { id: 'song-first', type: 'text', content: '합성 찬양 첫 부분' },
        { id: 'song-last', type: 'text', content: '합성 찬양 마지막 부분' },
      ],
    }),
  )
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  await page.getByRole('button', { name: '파일', exact: true }).click()
  await page.getByRole('button', { name: '프로젝트 불러오기', exact: true }).click()
  await expect(page.locator('h1')).toHaveText('성경 삽입 테스트 찬양')
  await expect.poll(async () => (await draft())?.title).toBe('성경 삽입 테스트 찬양')
})
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
})

test('adds selected verses inside a song, keeps live output, supports undo/redo and persists across restart', async () => {
  const original = await draft()
  await page.getByTestId('slide-card').first().click()
  await page.evaluate(async () => {
    await window.ipcRenderer.toggleOutput()
    await window.ipcRenderer.toggleStage()
  })
  await expect.poll(() => app.windows().length).toBe(3)
  const output = app.windows().find((window) => window.url().includes('output-display'))!
  const stage = app.windows().find((window) => window.url().includes('stage-display'))!
  const current = stage.locator('[data-stage-section="current"]')
  const next = stage.locator('[data-stage-section="next"]')
  await expect(output.getByText('합성 찬양 첫 부분', { exact: true })).toBeVisible()
  const dialog = await openDialog()
  await dialog.getByLabel('성경 위치').fill('요한복음 3:16-18')
  await dialog.getByRole('button', { name: '검색', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: '요 3:18', exact: true })).toBeChecked()
  await dialog.getByRole('checkbox', { name: '요 3:17', exact: true }).uncheck()
  await dialog.getByLabel('추가 위치').selectOption('after:song-first')
  await page.keyboard.press('F2')
  await expect(output.getByText('합성 찬양 첫 부분', { exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('bible-insert-dialog.png') })
  await dialog.getByRole('button', { name: '2개 구절 추가', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('slide-card')).toHaveCount(4)
  await expect(output.getByText('합성 찬양 첫 부분', { exact: true })).toBeVisible()
  await expect(current.getByText('합성 찬양 첫 부분', { exact: true })).toBeVisible()
  await expect(next.getByText('요 3:16', { exact: true })).toBeVisible()
  await expect.poll(async () => (await draft()).slides.length).toBe(4)
  const inserted = await draft()
  expect(inserted.id).toBe(original.id)
  expect(inserted.title).toBe(original.title)
  expect(
    inserted.slides.map((slide: { type: string; bibleReference?: string }) => [
      slide.type,
      slide.bibleReference,
    ]),
  ).toEqual([
    ['text', undefined],
    ['bible', '요 3:16'],
    ['bible', '요 3:18'],
    ['text', undefined],
  ])
  expect(inserted.slides[0]).toEqual(original.slides[0])
  expect(inserted.slides[3]).toEqual(original.slides[1])
  expect(new Set(inserted.slides.map((slide: { id: string }) => slide.id)).size).toBe(4)
  const saved = await workspace()
  expect(saved.library.find((item: { id: string }) => item.id === original.id).slides).toEqual(
    inserted.slides,
  )
  await page.keyboard.press('Meta+z')
  await expect(page.getByTestId('slide-card')).toHaveCount(2)
  await expect(next.getByText('합성 찬양 마지막 부분', { exact: true })).toBeVisible()
  await page.keyboard.press('Meta+Shift+z')
  await expect(page.getByTestId('slide-card')).toHaveCount(4)
  await page.getByTestId('slide-card').nth(1).click()
  await expect(output.getByText('요 3:16', { exact: true })).toBeVisible()
  await expect(current.getByText('요 3:16', { exact: true })).toBeVisible()
  await expect(next.getByText('요 3:18', { exact: true })).toBeVisible()
  await expect(output.getByText(inserted.slides[1].content, { exact: true })).toBeVisible()
  await expect(current.getByText(inserted.slides[1].content, { exact: true })).toBeVisible()
  await page.getByTestId('slide-card').nth(1).dblclick()
  await page.locator('textarea').first().fill('편집한 합성 말씀 본문')
  await page.locator('textarea').first().press('Tab')
  await expect(output.getByText('편집한 합성 말씀 본문', { exact: true })).toBeVisible()
  await expect.poll(async () => (await draft()).slides[1].content).toBe('편집한 합성 말씀 본문')
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  await app.close()
  await launch()
  await expect(page.getByTestId('slide-card')).toHaveCount(4)
  await expect(page.getByTestId('slide-card').nth(1)).toContainText('편집한 합성 말씀 본문')
  expect((await draft()).id).toBe(original.id)
  expect((await draft()).slides[1].bibleReference).toBe('요 3:16')
})

test('errors, changed queries, empty selection and cancel keep the song intact; selected position defaults in document order', async () => {
  const original = await draft()
  await page
    .getByTestId('slide-card')
    .nth(1)
    .click({ modifiers: ['Meta'] })
  await page
    .getByTestId('slide-card')
    .first()
    .click({ modifiers: ['Meta'] })
  let dialog = await openDialog()
  await expect(dialog.getByLabel('추가 위치')).toHaveValue('after:song-last')
  await dialog.getByLabel('성경 위치').fill('요 3:35-40')
  await dialog.getByRole('button', { name: '검색', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('찾지 못했습니다')
  await expect(dialog.getByRole('button', { name: '구절 추가', exact: true })).toBeDisabled()
  await dialog.getByLabel('성경 위치').fill('대상 16:12')
  await dialog.getByRole('button', { name: '검색', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('전체 범위')
  await dialog.getByLabel('성경 위치').fill('시편 23')
  await dialog.getByRole('button', { name: '검색', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: '시 23:6', exact: true })).toBeChecked()
  await dialog.getByRole('checkbox', { name: '전체 선택', exact: true }).uncheck()
  await expect(dialog.getByRole('button', { name: '구절 추가', exact: true })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: '전체 선택', exact: true }).check()
  await dialog.getByLabel('성경 위치').fill('요 3:16')
  await expect(dialog.getByRole('checkbox')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: '구절 추가', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect((await draft()).slides).toEqual(original.slides)
  dialog = await openDialog()
  await dialog.getByLabel('성경 위치').fill('대상 16:12-13')
  await dialog.getByRole('button', { name: '검색', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: '대상 16:12-13', exact: true })).toBeChecked()
  await dialog.getByLabel('추가 위치').selectOption('start')
  await dialog.getByRole('button', { name: '1개 구절 추가', exact: true }).click()
  await expect.poll(async () => (await draft()).slides[0].bibleReference).toBe('대상 16:12-13')
  dialog = await openDialog()
  await dialog.getByLabel('성경 위치').fill('요 3:16')
  await dialog.getByRole('button', { name: '검색', exact: true }).click()
  await dialog.getByLabel('추가 위치').selectOption('end')
  await dialog.getByRole('button', { name: '1개 구절 추가', exact: true }).click()
  await expect.poll(async () => (await draft()).slides.at(-1).bibleReference).toBe('요 3:16')
  await expect(page.getByTestId('slide-card')).toHaveCount(4)
})

test('late search results do not replace a newer query and a long chapter remains usable in a small window', async () => {
  const original = await draft()
  await page.evaluate(() => {
    const fetch = window.fetch.bind(window)
    let delayed = false
    window.fetch = async (input, init) => {
      if (!delayed && String(input).endsWith('.json')) {
        delayed = true
        await new Promise<void>((resolve) => {
          ;(window as unknown as { releaseBibleSearch: () => void }).releaseBibleSearch = resolve
        })
      }
      return fetch(input, init)
    }
  })
  let dialog = await openDialog()
  await dialog.getByLabel('성경 위치').fill('시편 23')
  await dialog.getByRole('button', { name: '검색', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '검색 중…', exact: true })).toBeDisabled()
  await dialog.getByLabel('성경 위치').fill('요 3:16')
  await dialog.getByRole('button', { name: '검색', exact: true }).click()
  await page.evaluate(() =>
    (window as unknown as { releaseBibleSearch: () => void }).releaseBibleSearch(),
  )
  await expect(dialog.getByRole('checkbox', { name: '요 3:16', exact: true })).toBeChecked()
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  await dialog.getByRole('button', { name: '취소', exact: true }).click()
  await page.setViewportSize({ width: 1100, height: 700 })
  dialog = await openDialog()
  await dialog.getByLabel('성경 위치').fill('시편 119')
  await dialog.getByRole('button', { name: '검색', exact: true }).click()
  await expect(dialog.getByRole('checkbox')).toHaveCount(177)
  await dialog.getByRole('checkbox', { name: '시 119:176', exact: true }).scrollIntoViewIfNeeded()
  await expect(dialog.getByLabel('성경 위치')).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: '176개 구절 추가', exact: true }),
  ).toBeInViewport()
  await dialog.getByRole('button', { name: '176개 구절 추가', exact: true }).click({ trial: true })
  await page.screenshot({ path: test.info().outputPath('bible-insert-small-window.png') })
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect((await draft()).slides).toEqual(original.slides)
})
