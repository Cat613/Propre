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
  expect(past.globalSlideStyle?.fontSize).toBe(110)
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
  expect(current.globalSlideStyle?.fontSize).toBe(110)
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
  await page.getByRole('button', { name: '콘티 더 보기', exact: true }).click()
  await page.getByRole('button', { name: '찬양 목록 원곡에 반영', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '찬양 목록 원곡에 반영', exact: true, includeHidden: true }),
  ).toBeEnabled()
  expect((await state()).library.find((p) => p.id === 'a')?.slides[0].content).toBe('원곡 가사')
  await answer(1)
  await page.getByRole('button', { name: '콘티 더 보기', exact: true }).click()
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
  const before = await state()
  await page.getByRole('button', { name: '새 콘티', exact: true }).click()
  let modal = page.getByRole('dialog', { name: '새 콘티', exact: true })
  await expect(modal.getByLabel('콘티 이름', { exact: true })).toBeFocused()
  await modal.getByRole('button', { name: '취소', exact: true }).click()
  await expect(modal).toHaveCount(0)
  expect((await state()).playlist).toEqual(before.playlist)
  await page.getByRole('button', { name: '새 콘티', exact: true }).click()
  modal = page.getByRole('dialog', { name: '새 콘티', exact: true })
  await modal.getByLabel('콘티 이름', { exact: true }).fill('빈 수요예배')
  await expect(modal.getByRole('radio', { name: '빈 콘티', exact: true })).toBeChecked()
  await modal.getByRole('button', { name: '콘티 만들기', exact: true }).click()
  await expect(modal).toHaveCount(0)
  expect((await state()).playlist).toHaveLength(0)
  await expect(
    page.getByRole('button', { name: '파일 저장', exact: true, includeHidden: true }),
  ).toBeDisabled()
  modal = await manager()
  await modal.getByLabel('콘티 검색').fill('빈 수요예배')
  await modal.getByRole('button', { name: '콘티 이름 변경: 빈 수요예배', exact: true }).click()
  await modal.getByLabel('콘티 이름', { exact: true }).fill('수요예배')
  await modal.getByLabel('예배 날짜', { exact: true }).fill('2026-10-14')
  const filename = path.join(dir, 'workspace-v4.json'),
    protectedFile = filename + '.held'
  await fs.rename(filename, protectedFile)
  await fs.mkdir(filename)
  await modal.getByRole('button', { name: '변경 저장', exact: true }).click()
  await expect(modal.getByRole('alert')).toBeVisible()
  expect((await state()).setlists.some((x) => x.title === '빈 수요예배')).toBe(true)
  await fs.rm(filename, { recursive: true })
  await fs.rename(protectedFile, filename)
  await modal.getByRole('button', { name: '변경 저장', exact: true }).click()
  await expect(modal.getByRole('heading', { name: '수요예배', exact: true })).toBeVisible()
  const emptyId = (await state()).activeSetlistId!
  await modal.getByRole('button', { name: '보관 콘티: 지난 주 예배', exact: true }).click()
  await modal
    .getByRole('button', { name: '콘티 휴지통으로 이동: 지난 주 예배', exact: true })
    .click()
  expect((await state()).setlists.find((x) => x.id === firstId)?.deletedAt).toBeUndefined()
  await modal.getByRole('button', { name: '휴지통으로 이동', exact: true }).click()
  await expect(
    modal.getByRole('button', { name: '콘티 열기: 지난 주 예배', exact: true }),
  ).toHaveCount(0)
  expect((await state()).activeSetlistId).toBe(emptyId)
  await modal.getByRole('button', { name: /^휴지통 \d/ }).click()
  await modal.getByRole('button', { name: '콘티 복원: 지난 주 예배', exact: true }).click()
  await modal.getByRole('button', { name: /^보관한 콘티 \d/ }).click()
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
  await page.getByRole('button', { name: '콘티 더 보기', exact: true }).click()
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

test('archive discovery previews ordered songs, searches song titles, sorts and supports keyboard recovery at compact sizes', async () => {
  const created = await page.evaluate(async () => {
    const before = await window.ipcRenderer.bootstrap()
    const source = before.setlists.find((x) => x.id === before.activeSetlistId)!
    const workspace = await window.ipcRenderer.manageSetlist({
      operation: 'duplicate',
      id: source.id,
      expectedRevision: source.revision,
      title: '주일 오후예배',
      date: '2026-10-11',
    })
    const current = workspace.setlists.find((x) => x.id === workspace.activeSetlistId)!
    await window.ipcRenderer.manageSetlist({
      operation: 'create',
      title: '청년 기도회',
      date: '2026-10-16',
      fromCurrent: false,
      expectedActiveId: current.id,
      expectedRevision: current.revision,
    })
    return current.id
  })
  await page.reload()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  const before = await state()
  const modal = await manager()
  await expect(modal.getByRole('heading', { name: '청년 기도회', exact: true })).toBeVisible()
  await modal.getByLabel('콘티 검색').fill('합성 a')
  await expect(modal.getByRole('button', { name: /^보관 콘티:/ })).toHaveCount(2)
  await modal.getByRole('button', { name: '보관 콘티: 주일 오후예배', exact: true }).click()
  await expect(modal.getByRole('list').getByRole('listitem')).toHaveCount(2)
  await expect(modal.getByText('2곡 · 2슬라이드', { exact: true })).toBeVisible()
  expect((await state()).activeSetlistId).toBe(before.activeSetlistId)
  expect((await state()).draft).toEqual(before.draft)
  expect((await state()).live).toEqual(before.live)
  await modal.getByRole('button', { name: '검색 지우기', exact: true }).click()
  await modal.getByLabel('콘티 정렬').selectOption('date')
  await expect(modal.getByRole('button', { name: /^보관 콘티:/ }).first()).toHaveAccessibleName(
    '보관 콘티: 청년 기도회',
  )
  await modal.getByLabel('콘티 정렬').selectOption('title')
  await expect(modal.getByRole('button', { name: /^보관 콘티:/ }).first()).toHaveAccessibleName(
    '보관 콘티: 주일 오후예배',
  )
  await modal.getByLabel('콘티 검색').fill('없는 콘티')
  await expect(modal.getByText('검색 결과가 없습니다.', { exact: true })).toBeVisible()
  await modal.getByRole('button', { name: '검색 지우기', exact: true }).click()
  await modal.getByRole('button', { name: '새 콘티', exact: true }).click()
  await expect(modal.getByLabel('콘티 이름', { exact: true })).toBeFocused()
  await modal.getByLabel('콘티 이름', { exact: true }).fill('입력 중 취소')
  await page.keyboard.press('Escape')
  await expect(modal).toBeVisible()
  await expect(modal.getByLabel('콘티 이름', { exact: true })).toHaveCount(0)
  await modal.getByRole('button', { name: '보관 콘티: 청년 기도회', exact: true }).click()
  await modal
    .getByRole('button', { name: '콘티 휴지통으로 이동: 청년 기도회', exact: true })
    .click()
  await expect(modal.getByText('현재 콘티의 순서가 비워집니다.', { exact: false })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(modal.getByRole('button', { name: '휴지통으로 이동', exact: true })).toHaveCount(0)
  expect(
    (await state()).setlists.find((x) => x.id === before.activeSetlistId)?.deletedAt,
  ).toBeUndefined()
  await modal.getByRole('button', { name: '보관 콘티: 주일 오후예배', exact: true }).click()
  await modal.screenshot({ path: test.info().outputPath('setlist-library-modern.png') })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('control-panel'))!
      .setSize(820, 720)
  })
  await modal.screenshot({ path: test.info().outputPath('setlist-library-compact.png') })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('control-panel'))!
      .setSize(700, 720)
  })
  await modal.screenshot({ path: test.info().outputPath('setlist-library-narrow.png') })
  expect(await modal.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  await modal.getByRole('button', { name: '새 콘티', exact: true }).click()
  await expect(modal.getByRole('button', { name: '콘티 만들기', exact: true })).toBeInViewport()
  await modal.getByLabel('콘티 이름', { exact: true }).fill('작은 창에서 새 콘티')
  await modal.screenshot({ path: test.info().outputPath('setlist-library-editor.png') })
  await page.keyboard.press('Escape')
  await expect(modal.getByRole('button', { name: '새 콘티', exact: true })).toBeFocused()
  const open = modal.getByRole('button', { name: '콘티 열기: 주일 오후예배', exact: true })
  await expect(open).toBeInViewport()
  await open.click()
  await expect(modal).toHaveCount(0)
  expect((await state()).activeSetlistId).toBe(created)
})

test('current title edits metadata directly and explicit start choices preserve songs and live output', async () => {
  await page.getByTestId('playlist-item').first().click()
  await page.getByTestId('slide-card').first().click()
  await page.evaluate(() => window.ipcRenderer.toggleOutput())
  const before = await state()
  await expect(page.getByText('편집: 지난 주 예배', { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '찬양 목록 원곡에 반영', exact: true }),
  ).toBeHidden()
  await page.getByRole('button', { name: '콘티 이름·날짜 수정', exact: true }).click()
  let modal = page.getByRole('dialog', { name: '콘티 정보 수정', exact: true })
  await expect(modal.getByLabel('콘티 이름', { exact: true })).toHaveValue('지난 주 예배')
  await modal.getByLabel('콘티 이름', { exact: true }).fill('취소할 이름')
  await modal.getByRole('button', { name: '취소', exact: true }).click()
  await expect(modal).toHaveCount(0)
  expect((await state()).setlists.find((x) => x.id === firstId)?.title).toBe('지난 주 예배')
  await page.getByRole('button', { name: '콘티 이름·날짜 수정', exact: true }).click()
  modal = page.getByRole('dialog', { name: '콘티 정보 수정', exact: true })
  await modal.getByLabel('콘티 이름', { exact: true }).fill('이번 주 예배')
  await modal.getByLabel('예배 날짜', { exact: true }).fill('2026-10-18')
  await modal.getByRole('button', { name: '변경 저장', exact: true }).click()
  await expect(modal).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '콘티 이름·날짜 수정', exact: true }),
  ).toContainText('이번 주 예배')
  const renamed = await state()
  expect(renamed.activeSetlistId).toBe(firstId)
  expect(renamed.playlist).toEqual(before.playlist)
  expect(renamed.library).toEqual(before.library)
  expect(renamed.live).toEqual(before.live)
  await page.getByRole('button', { name: '새 콘티', exact: true }).click()
  modal = page.getByRole('dialog', { name: '새 콘티', exact: true })
  await expect(modal.getByRole('radio', { name: '빈 콘티', exact: true })).toBeChecked()
  await modal.getByRole('radio', { name: '현재 순서 복사', exact: true }).check()
  await modal.getByLabel('콘티 이름', { exact: true }).fill('명시적으로 복사한 콘티')
  await modal.getByRole('button', { name: '콘티 만들기', exact: true }).click()
  await expect(modal).toHaveCount(0)
  const copied = await state()
  expect(copied.playlist).toHaveLength(before.playlist.length)
  expect(copied.playlist[0].presentationId).not.toBe(before.playlist[0].presentationId)
  expect(copied.playlist[0].presentation.slides).toEqual(before.playlist[0].presentation.slides)
  expect(copied.library).toEqual(before.library)
  expect(copied.live).toEqual(before.live)
  await expect(page.getByText('편집: 이번 주 예배', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '전체 순서', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '곡', exact: true }).click()
  const item = page.getByTestId('playlist-item').first()
  const title = await item.locator('p').boundingBox()
  const count = await item.getByText('1장', { exact: true }).boundingBox()
  expect(Math.abs(title!.y + title!.height / 2 - (count!.y + count!.height / 2))).toBeLessThan(2)
  await page.getByRole('button', { name: '콘티 보관함', exact: true }).click()
  const archive = page.getByRole('dialog', { name: '콘티 보관함', exact: true })
  await archive.getByRole('button', { name: '새 콘티', exact: true }).click()
  await expect(archive.getByRole('radio', { name: '빈 콘티', exact: true })).toBeChecked()
})

test('playlist remove buttons hide after pointer reordering and remain available with keyboard focus', async () => {
  const items = page.getByTestId('playlist-item')
  const moved = items.first()
  const movedId = await moved.getAttribute('data-presentation-id')
  const before = (await state()).playlist.map((item) => item.id)
  const from = await moved.boundingBox()
  const to = await items.nth(1).boundingBox()
  expect(from).not.toBeNull()
  expect(to).not.toBeNull()
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
  await page.mouse.down()
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect
    .poll(async () => (await state()).playlist.map((item) => item.id))
    .toEqual([before[1], before[0]])
  await page.mouse.move(0, 0)
  const removeButtons = items.getByRole('button', { name: /^순서에서 제거:/ })
  for (const button of await removeButtons.all()) {
    await expect(button).toHaveCSS('opacity', '0')
  }
  const reordered = items.nth(1)
  await expect(reordered).toHaveAttribute('data-presentation-id', movedId!)
  const remove = reordered.getByRole('button', { name: /^순서에서 제거:/ })
  await reordered.hover()
  await expect(remove).toHaveCSS('opacity', '1')
  await page.mouse.move(0, 0)
  await expect(remove).toHaveCSS('opacity', '0')
  // Switch to keyboard input before focusing the row and its remove button.
  await page.keyboard.press('Tab')
  await reordered.focus()
  await expect(remove).toHaveCSS('opacity', '1')
  await page.keyboard.press('Tab')
  await expect(remove).toBeFocused()
  await expect(remove).toHaveCSS('opacity', '1')
})
