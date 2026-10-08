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
import { Repository } from '../../electron/services/repository'
import { DEFAULT_STYLE } from '../../shared/model'
const now = '2026-10-06T00:00:00.000Z'
const song = (id: string) => ({
  id,
  title: `합성 ${id}`,
  createdAt: now,
  updatedAt: now,
  revision: 1,
  globalSlideStyle: { ...DEFAULT_STYLE, fontSize: 73 },
  slides: [
    {
      id: `${id}-slide`,
      type: 'text' as const,
      content: '원곡 가사',
      label: 'A',
      labelColor: '#EC4899',
      borderColor: '#EC4899',
    },
  ],
})
let app: ElectronApplication, page: Page, dir: string, firstId: string
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
async function state() {
  return page.evaluate(() => window.ipcRenderer.bootstrap())
}
async function manager() {
  await page.getByRole('button', { name: '콘티 보관함', exact: true }).click()
  return page.getByRole('dialog', { name: '콘티 보관함', exact: true })
}
async function edit(content: string) {
  await page.getByTestId('slide-card').first().dblclick()
  await page.locator('textarea').first().fill(content)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(async () => (await state()).draft?.slides[0].content).toBe(content)
}
async function answer(response: number) {
  await app.evaluate(({ dialog }, response) => {
    dialog.showMessageBox = async (_window, options) => {
      ;(globalThis as any).__publishPrompt = options
      return { response, checkboxChecked: false }
    }
  }, response)
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-setlists-native-'))
  const repo = new Repository(dir)
  await repo.open()
  await repo.saveDraft(song('a'))
  await repo.saveDraft(song('operator'))
  await repo.setPlaylist([
    { id: 'one', presentationId: 'a' },
    { id: 'repeat', presentationId: 'a' },
  ])
  firstId = repo.state.activeSetlistId!
  await repo.manageSetlist({
    operation: 'rename',
    id: firstId,
    expectedRevision: repo.state.setlists[0].revision,
    title: '지난 주 예배',
    date: '2026-10-04',
  })
  await repo.setSettings({
    globalStylePresets: [
      { id: 'default-song', name: 'Default', style: { ...DEFAULT_STYLE, fontSize: 110 } },
    ],
    defaultSongPresetId: 'default-song',
  })
  await launch()
})
test.afterEach(async () => {
  await stop()
  await fs.rm(dir, { recursive: true, force: true })
})
test('setlist duplication and editing keep historical songs and originals; explicit publish, switching and restart preserve current output', async () => {
  await page.getByTestId('playlist-item').first().click()
  await edit('지난 주 예배 구성')
  const past = (await state()).setlistSongs[0].presentation
  expect((await state()).library.find((p) => p.id === 'a')?.slides[0].content).toBe('원곡 가사')
  expect(past.globalSlideStyle?.fontSize).toBe(73)
  let modal = await manager()
  await modal.getByRole('button', { name: '콘티 복제: 지난 주 예배', exact: true }).click()
  await modal.getByLabel('콘티 이름', { exact: true }).fill('이번 주 예배')
  await modal.getByLabel('예배 날짜', { exact: true }).fill('2026-10-11')
  await modal.getByRole('button', { name: '복제해서 열기', exact: true }).click()
  await expect(modal).toHaveCount(0)
  const thisId = (await state()).activeSetlistId!
  expect(thisId).not.toBe(firstId)
  expect((await state()).setlists.find((x) => x.id === thisId)?.date).toBe('2026-10-11')
  // Opening a setlist alone keeps the previously selected document.
  expect((await state()).draft?.id).toBe(past.id)
  await page.getByTestId('playlist-item').first().click()
  await edit('이번 주 예배 구성')
  const current = (await state()).draft!
  expect(current.id).not.toBe(past.id)
  expect(
    (await state()).setlistSongs.find((x) => x.presentation.id === past.id)?.presentation,
  ).toEqual(past)
  expect(current.globalSlideStyle?.fontSize).toBe(73)
  await page.getByTestId('slide-card').first().click()
  await page.evaluate(async () => {
    await window.ipcRenderer.toggleOutput()
    await window.ipcRenderer.toggleStage()
  })
  await expect.poll(() => app.windows().length).toBe(3)
  const output = app.windows().find((w) => w.url().includes('output-display'))!
  const stage = app.windows().find((w) => w.url().includes('stage-display'))!
  await expect(output.getByText('이번 주 예배 구성', { exact: true })).toBeVisible()
  const live = (await state()).live
  modal = await manager()
  await modal.getByLabel('콘티 검색').fill('2026-10-04')
  await expect(
    modal.getByRole('button', { name: '콘티 열기: 이번 주 예배', exact: true }),
  ).toHaveCount(0)
  await modal.getByRole('button', { name: '콘티 열기: 지난 주 예배', exact: true }).click()
  await expect(modal).toHaveCount(0)
  expect((await state()).playlist[0].presentation.slides[0].content).toBe('지난 주 예배 구성')
  expect((await state()).draft?.id).toBe(current.id)
  expect((await state()).live).toEqual(live)
  await expect(output.getByText('이번 주 예배 구성', { exact: true })).toBeVisible()
  await expect(
    stage.locator('[data-stage-section="current"]').getByText('이번 주 예배 구성', { exact: true }),
  ).toBeVisible()
  await answer(0)
  await page.getByRole('button', { name: '찬양 목록 원곡에 반영', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '찬양 목록 원곡에 반영', exact: true }),
  ).toBeEnabled()
  expect((await state()).library.find((p) => p.id === 'a')?.slides[0].content).toBe('원곡 가사')
  await answer(1)
  await page.getByRole('button', { name: '찬양 목록 원곡에 반영', exact: true }).click()
  await expect(
    page.getByText('찬양 목록에 반영했습니다. 다른 콘티는 유지됩니다.', { exact: true }),
  ).toBeVisible()
  expect((await state()).library.find((p) => p.id === 'a')?.slides[0].content).toBe(
    '이번 주 예배 구성',
  )
  expect(
    (await state()).setlistSongs.find((x) => x.presentation.id === past.id)?.presentation,
  ).toEqual(past)
  expect((await state()).live).toEqual(live)
  const prompt = await app.evaluate(() => (globalThis as any).__publishPrompt)
  expect(prompt.detail).toContain('원곡 가사')
  expect(prompt.detail).toContain('이번 주 예배 구성')
  expect(prompt.defaultId).toBe(0)
  expect(await output.evaluate(() => typeof window.ipcRenderer.manageSetlist)).toBe('undefined')
  modal = await manager()
  await modal.screenshot({ path: test.info().outputPath('setlist-library.png') })
  await modal.getByRole('button', { name: '콘티 보관함 닫기', exact: true }).click()
  await stop()
  await launch()
  expect((await state()).activeSetlistId).toBe(firstId)
  expect((await state()).draft?.id).toBe(current.id)
  expect((await state()).draft?.slides[0].content).toBe('이번 주 예배 구성')
  expect((await state()).library.find((p) => p.id === 'a')?.slides[0].content).toBe(
    '이번 주 예배 구성',
  )
})
test('create/rename/date, trash and restore preserve song snapshots and allow retry after a failed save', async () => {
  let modal = await manager()
  await modal.getByLabel('콘티 이름', { exact: true }).fill('빈 수요예배')
  await modal.getByLabel('현재 순서로 만들기').uncheck()
  await modal.getByRole('button', { name: '콘티 만들기', exact: true }).click()
  await expect(modal).toHaveCount(0)
  expect((await state()).playlist).toHaveLength(0)
  await expect(page.getByRole('button', { name: '파일 저장', exact: true })).toBeDisabled()
  modal = await manager()
  await modal.getByRole('button', { name: '콘티 이름 변경: 빈 수요예배', exact: true }).click()
  await modal.getByLabel('콘티 이름', { exact: true }).fill('수요예배')
  await modal.getByLabel('예배 날짜', { exact: true }).fill('2026-10-14')
  const filename = path.join(dir, 'workspace-v2.json'),
    protectedFile = filename + '.held'
  await fs.rename(filename, protectedFile)
  await fs.mkdir(filename)
  await modal.getByRole('button', { name: '변경 저장', exact: true }).click()
  await expect(modal.getByRole('alert')).toBeVisible()
  expect((await state()).setlists.some((x) => x.title === '빈 수요예배')).toBe(true)
  await fs.rm(filename, { recursive: true })
  await fs.rename(protectedFile, filename)
  await modal.getByRole('button', { name: '변경 저장', exact: true }).click()
  await expect(modal).toHaveCount(0)
  const emptyId = (await state()).activeSetlistId!
  modal = await manager()
  await modal
    .getByRole('button', { name: '콘티 휴지통으로 이동: 지난 주 예배', exact: true })
    .click()
  await expect(
    modal.getByRole('button', { name: '콘티 열기: 지난 주 예배', exact: true }),
  ).toHaveCount(0)
  expect((await state()).activeSetlistId).toBe(emptyId)
  await modal.getByRole('button', { name: '휴지통', exact: true }).click()
  await modal.getByRole('button', { name: '콘티 복원: 지난 주 예배', exact: true }).click()
  await modal.getByRole('button', { name: '보관한 콘티', exact: true }).click()
  await modal.getByRole('button', { name: '콘티 열기: 지난 주 예배', exact: true }).click()
  await expect(modal).toHaveCount(0)
  expect((await state()).playlist).toHaveLength(2)
  expect((await state()).playlist[0].presentation.slides[0].content).toBe('원곡 가사')
})
test('an original modified while publish confirmation is pending rejects the write and keeps both versions', async () => {
  await page.getByTestId('playlist-item').first().click()
  await edit('콘티 수정본')
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () =>
      new Promise((resolve) => {
        ;(globalThis as any).__acceptPublish = () =>
          resolve({ response: 1, checkboxChecked: false })
      })
  })
  await page.getByRole('button', { name: '찬양 목록 원곡에 반영', exact: true }).click()
  await expect
    .poll(() => app.evaluate(() => typeof (globalThis as any).__acceptPublish))
    .toBe('function')
  await page.evaluate(async () => {
    const s = await window.ipcRenderer.bootstrap(),
      p = s.library.find((x) => x.id === 'a')!
    await window.ipcRenderer.saveDraft({
      ...p,
      revision: 999,
      slides: [{ ...p.slides[0], content: '동시에 수정한 원곡' }],
    })
  })
  await app.evaluate(() => (globalThis as any).__acceptPublish())
  await expect(
    page.getByText('찬양 목록의 원곡이 변경되었습니다. 다시 확인해주세요.', { exact: true }),
  ).toBeVisible()
  const s = await state()
  expect(s.library.find((x) => x.id === 'a')?.slides[0].content).toBe('동시에 수정한 원곡')
  expect(s.playlist[0].presentation.slides[0].content).toBe('콘티 수정본')
})
test('a private song edit waiting for autosave survives renderer crash without entering the original library', async () => {
  await page.getByTestId('playlist-item').first().click()
  await page.getByTestId('slide-card').first().dblclick()
  await page.locator('textarea').first().fill('중단 직전 콘티 가사')
  await page.keyboard.press('Escape')
  const reopened = app.waitForEvent('window')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('control-panel'))!
      .webContents.forcefullyCrashRenderer()
  })
  page = await reopened
  await expect(page.getByText('중단 직전 콘티 가사', { exact: true })).toBeVisible()
  await expect
    .poll(async () => (await state()).draft?.slides[0].content)
    .toBe('중단 직전 콘티 가사')
  expect((await state()).library.find((p) => p.id === 'a')?.slides[0].content).toBe('원곡 가사')
  expect((await state()).library).toHaveLength(2)
})
