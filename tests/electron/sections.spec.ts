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
import { compileSong, type SongDraft } from '../../shared/song-preparation'
let app: ElectronApplication, page: Page, dir: string
const draft: SongDraft = {
  id: 'draft',
  title: '반복 후렴 합성 찬양',
  confirmed: true,
  formEvidence: 'explicit',
  issues: [],
  originalId: null,
  originalRevision: null,
  updateOriginal: false,
  form: {
    parts: [
      { id: 'verse', label: '1절', pages: ['절 가사'], sourceId: 'fixture', sourcePage: 1 },
      {
        id: 'chorus',
        label: '후렴',
        pages: ['후렴 앞', '후렴 뒤'],
        sourceId: 'fixture',
        sourcePage: 1,
      },
      { id: 'bridge', label: '브릿지', pages: ['브릿지'], sourceId: 'fixture', sourcePage: 1 },
    ],
    sequence: [
      { partId: 'verse', repeat: 1 },
      { partId: 'chorus', repeat: 3 },
      { partId: 'bridge', repeat: 1 },
    ],
  },
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-sections-native-'))
  const repo = new Repository(dir)
  await repo.open()
  await repo.saveDraft(compileSong(draft, undefined, 'fixture-song'))
  await repo.setPlaylist([{ id: 'row', presentationId: 'fixture-song' }])
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
  page = await app.firstWindow()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
})
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
})
async function sections() {
  const group = page.locator('details[aria-label="구간 바로가기"]')
  await group.locator('summary').click()
  return group
}
test('section choice is read-only, repeated occurrences target the right next slide and manual output keeps the running cue', async () => {
  await page.evaluate(async () => {
    const state = await window.ipcRenderer.bootstrap(),
      list = state.setlists[0]
    await window.ipcRenderer.toggleStage()
    await window.ipcRenderer.commitServiceCue(
      (
        await window.ipcRenderer.prepareServiceCue({
          setlistId: list.id,
          cueId: list.servicePlan!.items[0].id,
          expectedSetlistRevision: list.revision,
        })
      ).token,
    )
  })
  const group = await sections(),
    before = await page.evaluate(() => window.ipcRenderer.bootstrap())
  await group.getByRole('button', { name: '후렴 구간 선택', exact: true }).click()
  expect((await page.evaluate(() => window.ipcRenderer.bootstrap())).live).toEqual(before.live)
  await expect(group.getByText('선택: 후렴 · 2번 슬라이드', { exact: true })).toBeVisible()
  await group.getByRole('button', { name: '이 구간 송출', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.ipcRenderer.bootstrap())).live?.layers.slide?.content,
    )
    .toBe('후렴 앞')
  const stage = app.windows().find((win) => win.url().includes('stage-display'))!
  await expect(stage.locator('[data-stage-section="next"]')).toContainText('후렴 뒤')
  expect(
    (await page.evaluate(() => window.ipcRenderer.bootstrap())).serviceSession?.currentCueId,
  ).toBe(before.serviceSession?.currentCueId)
  await group.getByRole('button', { name: '후렴 구간 선택', exact: true }).click()
  await expect(group.getByText('선택: 후렴 · 4번 슬라이드', { exact: true })).toBeVisible()
  const occurrence = group.getByLabel('후렴 발생 위치', { exact: true })
  await occurrence.selectOption({ index: 3 })
  await expect(group.getByText('선택: 후렴 · 6번 슬라이드', { exact: true })).toBeVisible()
  await group.getByRole('button', { name: '이 구간 송출', exact: true }).click()
  await expect(stage.locator('[data-stage-section="next"]')).toContainText('후렴 뒤')
  await page.getByRole('button', { name: '전체 순서', exact: true }).click()
  await expect(page.getByText(/수동 송출 중/)).toBeVisible()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL().includes('control-panel'))!
      .setBounds({ width: 1024, height: 768 }),
  )
  await page.screenshot({
    path: '/tmp/propre-worship-sections-compact.png',
    animations: 'disabled',
  })
})
test('explicit immediate mode supports keyboard navigation, resets on reload and stale choices do not transmit', async () => {
  const group = await sections()
  await group.getByRole('button', { name: '1절 구간 선택', exact: true }).focus()
  await group.getByRole('button', { name: '1절 구간 선택', exact: true }).press('ArrowRight')
  await expect(group.getByRole('button', { name: '후렴 구간 선택', exact: true })).toBeFocused()
  await group.getByRole('button', { name: '후렴 구간 선택', exact: true }).press('Enter')
  expect((await page.evaluate(() => window.ipcRenderer.bootstrap())).live).toBeNull()
  await page.getByTestId('slide-card').last().dblclick()
  await page.locator('textarea').first().fill('수정한 브릿지')
  await page.locator('textarea').first().press('Tab')
  await expect(group.getByRole('button', { name: '이 구간 송출', exact: true })).toBeDisabled()
  await group.getByRole('checkbox', { name: '구간 클릭 즉시 송출', exact: true }).check()
  await group.getByRole('button', { name: '후렴 구간 선택', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.ipcRenderer.bootstrap())).live?.layers.slide?.content,
    )
    .toBe('후렴 앞')
  await expect(group.locator('summary')).toContainText('즉시 송출')
  await page.reload()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  const reopened = await sections()
  await expect(
    reopened.getByRole('checkbox', { name: '구간 클릭 즉시 송출', exact: true }),
  ).not.toBeChecked()
})
test('external PDF remains live during selection and explicit section take returns safely to slides', async () => {
  const { PDFDocument } = await import('pdf-lib'),
    doc = await PDFDocument.create()
  doc.addPage([180, 240])
  const file = path.join(dir, 'fixture.pdf')
  await fs.writeFile(file, await doc.save())
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  await page.evaluate(async () => {
    const r = (await window.ipcRenderer.selectOutputPDFs()).resources[0],
      p = await window.ipcRenderer.prepareOutputResource({
        resourceId: r.id,
        revision: r.revision,
        page: 1,
      })
    await window.ipcRenderer.commitOutputResource(p.token, p.generation)
  })
  const group = await sections()
  await group.getByRole('button', { name: '브릿지 구간 선택', exact: true }).click()
  expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind).toBe(
    'pdf',
  )
  await group.getByRole('button', { name: '이 구간 송출', exact: true }).click()
  await expect
    .poll(
      async () => (await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind,
    )
    .toBe('slides')
  expect(
    (await page.evaluate(() => window.ipcRenderer.bootstrap())).live?.layers.slide?.content,
  ).toBe('브릿지')
})
