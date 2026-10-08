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
const now = '2026-10-05T00:00:00.000Z'
const song = (id: string, content = id) => ({
  id,
  title: `합성 ${id}`,
  createdAt: now,
  updatedAt: now,
  revision: 1,
  slides: [
    {
      id: `${id}-slide`,
      type: 'text' as const,
      content,
      label: 'A · 1/1',
      labelColor: '#EC4899',
      borderColor: '#EC4899',
    },
  ],
})
let app: ElectronApplication, page: Page, dir: string, file: string
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
  // Prove isolation before taking any feature action.
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(dir)
  expect(dir).not.toContain('Application Support')
  await app.firstWindow()
  await expect
    .poll(() => app.windows().some((window) => window.url().includes('control-panel')))
    .toBe(true)
  page = app.windows().find((window) => window.url().includes('control-panel'))!
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
}
async function state() {
  return page.evaluate(() => window.ipcRenderer.bootstrap())
}
async function choose(response: number, canceled = false) {
  await app.evaluate(
    ({ dialog }, options) => {
      dialog.showOpenDialog = async () => ({
        canceled: options.canceled,
        filePaths: options.canceled ? [] : [options.file],
      })
      dialog.showMessageBox = async (_window, message) => {
        ;(globalThis as any).__playlistConfirmation = message
        return { response: options.response, checkboxChecked: false }
      }
    },
    { file, response, canceled },
  )
}
async function stop() {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-playlist-native-'))
  const source = new Repository(path.join(dir, 'source'))
  await source.open()
  await source.saveDraft(song('a'))
  await source.saveDraft(song('b'))
  await source.setPlaylist([
    { id: 'one', presentationId: 'b' },
    { id: 'two', presentationId: 'a' },
    { id: 'three', presentationId: 'b' },
  ])
  file = path.join(dir, 'import.ppros')
  await fs.writeFile(file, await source.exportPlaylist(source.state.playlist))
  const target = new Repository(dir)
  await target.open()
  await target.saveDraft(song('a', '기존 가사'))
  await target.saveDraft(song('operator', '현재 송출 합성 본문'))
  await target.setPlaylist([{ id: 'old-order', presentationId: 'a' }])
  await launch()
})
test.afterEach(async () => {
  await stop()
  await fs.rm(dir, { recursive: true, force: true })
})
test('playlist buttons save a portable snapshot and import songs/order while retaining selection and both live screens', async () => {
  const savePath = path.join(dir, 'saved.ppros')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, savePath)
  await page.getByRole('button', { name: '파일 저장', exact: true }).click()
  await expect(page.getByText('플레이리스트 파일을 저장했습니다.', { exact: true })).toBeVisible()
  const saved = JSON.parse(await fs.readFile(savePath, 'utf8'))
  expect(saved.kind).toBe('playlist')
  expect(saved.presentations).toHaveLength(1)
  expect(saved.presentations[0].slides[0].content).toBe('기존 가사')
  expect(saved).not.toHaveProperty('draft')
  await page.getByTestId('slide-card').first().click()
  await page.evaluate(async () => {
    await window.ipcRenderer.toggleOutput()
    await window.ipcRenderer.toggleStage()
  })
  await expect.poll(() => app.windows().length).toBe(3)
  const output = app.windows().find((window) => window.url().includes('output-display'))!
  const stage = app.windows().find((window) => window.url().includes('stage-display'))!
  await expect(output.getByText('현재 송출 합성 본문', { exact: true })).toBeVisible()
  const before = await state()
  await choose(1)
  await page.getByRole('button', { name: '파일 불러오기', exact: true }).click()
  await expect(
    page.getByText('3개 순서를 불러왔습니다. 새 곡 2개 · 기존 곡 0개', { exact: true }),
  ).toBeVisible()
  const confirmation = await app.evaluate(() => (globalThis as any).__playlistConfirmation)
  expect(confirmation.detail).toContain('1. 합성 b\n2. 합성 a\n3. 합성 b')
  expect(confirmation.defaultId).toBe(0)
  const after = await state()
  expect(after.playlist.map((p) => p.presentation.title)).toEqual(['합성 b', '합성 a', '합성 b'])
  expect(after.library).toHaveLength(4)
  expect(after.library.find((p) => p.id === 'a')?.slides[0].content).toBe('기존 가사')
  expect(after.draft).toEqual(before.draft)
  expect(after.outputEnabled).toBe(before.outputEnabled)
  expect(after.stageEnabled).toBe(before.stageEnabled)
  expect(after.live).toEqual(before.live)
  await expect(page.locator('h1')).toHaveText('합성 operator')
  await expect(output.getByText('현재 송출 합성 본문', { exact: true })).toBeVisible()
  await expect(
    stage
      .locator('[data-stage-section="current"]')
      .getByText('현재 송출 합성 본문', { exact: true }),
  ).toBeVisible()
  expect(
    await output.evaluate(() => ({
      save: typeof window.ipcRenderer.savePlaylistFile,
      load: typeof window.ipcRenderer.loadPlaylistFile,
    })),
  ).toEqual({ save: 'undefined', load: 'undefined' })
  await page.getByRole('button', { name: '파일 불러오기', exact: true }).click()
  await expect(
    page.getByText('3개 순서를 불러왔습니다. 새 곡 0개 · 기존 곡 2개', { exact: true }),
  ).toBeVisible()
  expect((await state()).library).toHaveLength(4)
  await page.screenshot({ path: test.info().outputPath('playlist-files.png') })
  await stop()
  await launch()
  expect((await state()).playlist.map((p) => p.presentation.title)).toEqual([
    '합성 b',
    '합성 a',
    '합성 b',
  ])
  expect((await state()).library).toHaveLength(4)
  await expect(page.locator('h1')).toHaveText('합성 operator')
})
test('canceling either dialog leaves the workspace intact and invalid files show a recoverable error', async () => {
  const before = await state()
  await choose(0, true)
  await page.getByRole('button', { name: '파일 불러오기', exact: true }).click()
  await expect(page.getByRole('button', { name: '파일 불러오기', exact: true })).toBeEnabled()
  expect((await state()).playlist).toEqual(before.playlist)
  await choose(0)
  await page.getByRole('button', { name: '파일 불러오기', exact: true }).click()
  await expect(page.getByRole('button', { name: '파일 불러오기', exact: true })).toBeEnabled()
  expect((await state()).library).toEqual(before.library)
  expect((await state()).playlist).toEqual(before.playlist)
  await fs.writeFile(file, '{broken')
  await choose(1)
  await page.getByRole('button', { name: '파일 불러오기', exact: true }).click()
  await expect(page.getByRole('button', { name: '파일 불러오기', exact: true })).toBeEnabled()
  await expect(page.getByText(/파일 형식·포함 미디어·저장 공간/)).toBeVisible()
  expect((await state()).library).toEqual(before.library)
  expect((await state()).playlist).toEqual(before.playlist)
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined })
  })
  await page.getByRole('button', { name: '파일 저장', exact: true }).click()
  await expect(page.getByRole('button', { name: '파일 저장', exact: true })).toBeEnabled()
  expect((await state()).playlist).toEqual(before.playlist)
})
test('native confirmation blocks slide hotkeys and duplicate actions until the operator cancels', async () => {
  await choose(0)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () =>
      new Promise((resolve) => {
        ;(globalThis as any).__finishPlaylistDialog = () =>
          resolve({ response: 0, checkboxChecked: false })
      })
  })
  await page.getByTestId('slide-card').first().click()
  const before = await state()
  await page.getByRole('button', { name: '파일 불러오기', exact: true }).click()
  await expect(page.getByRole('button', { name: '파일 저장', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '파일 불러오기', exact: true })).toBeDisabled()
  await expect
    .poll(() => app.evaluate(() => typeof (globalThis as any).__finishPlaylistDialog))
    .toBe('function')
  await page.keyboard.press('F2')
  expect((await state()).live).toEqual(before.live)
  await app.evaluate(() => (globalThis as any).__finishPlaylistDialog())
  await expect(page.getByRole('button', { name: '파일 불러오기', exact: true })).toBeEnabled()
  expect((await state()).playlist).toEqual(before.playlist)
})
