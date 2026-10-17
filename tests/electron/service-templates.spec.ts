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
import { randomUUID } from 'node:crypto'
let app: ElectronApplication, page: Page, dir: string
const name = '합성 주일예배 템플릿'
async function state() {
  return page.evaluate(() => window.ipcRenderer.bootstrap())
}
async function menu(action: string) {
  await page.getByRole('button', { name: '콘티 더 보기', exact: true }).click()
  await page.getByRole('button', { name: action, exact: true }).click()
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-template-native-'))
  const repo = new Repository(dir)
  await repo.open()
  await repo.saveDraft({
    id: 'song',
    title: '합성 찬양',
    slides: [{ id: 'slide', type: 'text', content: '템플릿에서 독립 보존할 가사' }],
    revision: 1,
    createdAt: '2026-10-16T00:00:00Z',
    updatedAt: '2026-10-16T00:00:00Z',
  })
  await repo.setPlaylist([{ id: 'row', presentationId: 'song' }])
  const list = repo.state.setlists[0],
    plan = structuredClone(list.servicePlan!)
  plan.items[0].operatorNote = '템플릿 기본 제외할 비공개 메모'
  plan.items[0].leader = '합성 담당자'
  plan.items.push({
    id: 'prayer',
    kind: 'prayer',
    title: '합성 대표기도',
    enter: { visual: 'keep', audio: 'keep' },
  })
  await repo.saveServicePlan({
    requestId: randomUUID(),
    setlistId: list.id,
    expectedSetlistRevision: list.revision,
    plan,
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
  page = await app.firstWindow()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
})
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
})
async function save(fixed = false) {
  await menu('템플릿으로 저장')
  const dialog = page.getByRole('dialog', { name: '예배 템플릿' })
  await dialog.getByLabel('템플릿 이름', { exact: true }).fill(name)
  if (fixed)
    await dialog.getByRole('checkbox', { name: '합성 찬양 고정 자료 포함', exact: true }).check()
  await dialog.getByRole('button', { name: '템플릿 저장', exact: true }).click()
  await expect(dialog.getByLabel('템플릿 검색', { exact: true })).toBeVisible()
  await dialog
    .getByRole('button', { name: new RegExp(name), exact: false })
    .first()
    .click()
  return dialog
}
test('default privacy, fixed snapshot generation and compact template UI preserve current editing and live output', async () => {
  const before = await state(),
    dialog = await save(true)
  const saved = (await state()).serviceTemplates[0]
  expect(saved.items[0].operatorNote).toBeUndefined()
  expect(saved.items[0].leader).toBeUndefined()
  await dialog.getByRole('button', { name: '이 템플릿으로 만들기', exact: true }).click()
  await dialog.getByLabel('템플릿 새 예배 이름', { exact: true }).fill('템플릿으로 만든 합성 예배')
  await dialog.getByLabel('템플릿 새 예배 날짜', { exact: true }).fill('2026-10-18')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL().includes('control-panel'))!
      .setBounds({ width: 1024, height: 768 }),
  )
  await expect(dialog.getByRole('button', { name: '새 예배 생성', exact: true })).toBeInViewport({
    ratio: 1,
  })
  await page.screenshot({
    path: '/tmp/propre-worship-template-create-compact.png',
    animations: 'disabled',
  })
  await dialog.getByRole('button', { name: '새 예배 생성', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const after = await state()
  expect(after.activeSetlistId).not.toBe(before.activeSetlistId)
  expect(after.draft).toEqual(before.draft)
  expect(after.live).toEqual(before.live)
  expect(after.playlist[0].presentation.slides[0].content).toBe('템플릿에서 독립 보존할 가사')
  expect(after.playlist[0].presentationId).not.toBe(before.playlist[0].presentationId)
  await expect(page.getByRole('button', { name: '전체 순서', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
test('unfinished required song slots block progress and the normal cue editor fills them with a private snapshot', async () => {
  const dialog = await save()
  await dialog.getByRole('button', { name: '이 템플릿으로 만들기', exact: true }).click()
  await dialog.getByRole('button', { name: '새 예배 생성', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: '1. 합성 찬양', exact: true }).click()
  await page.getByRole('button', { name: '준비 확인', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('자료 선택')
  await page.getByRole('button', { name: '선택한 순서 편집', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '예배 순서 편집' })
  await editor.getByLabel('순서 송출 자료', { exact: true }).selectOption('p:song')
  await editor.getByRole('button', { name: '변경 저장', exact: true }).click()
  await expect(editor).toHaveCount(0)
  const loaded = await state()
  expect(
    loaded.setlists.find((entry) => entry.id === loaded.activeSetlistId)?.servicePlan?.items[0]
      .materialPending,
  ).toBeUndefined()
  await page.getByRole('button', { name: '순서 편집 되돌리기', exact: true }).click()
  await expect.poll(async () => (await state()).playlist[0].presentation.slides.length).toBe(0)
  const undone = await state()
  expect(undone.playlist[0].presentation.slides).toEqual([])
  expect(
    undone.setlists.find((entry) => entry.id === undone.activeSetlistId)?.servicePlan?.items[0]
      .materialPending,
  ).toBe(true)
  await page.getByRole('button', { name: '선택한 순서 편집', exact: true }).click()
  await editor.getByLabel('순서 송출 자료', { exact: true }).selectOption('p:song')
  await editor.getByRole('button', { name: '변경 저장', exact: true }).click()
  await expect(editor).toHaveCount(0)
  await page.getByRole('button', { name: '준비 확인', exact: true }).click()
  await expect(page.getByRole('button', { name: '이 순서 진행', exact: true })).toBeEnabled()
})
test('template editing/duplicate/trash/restore/file import round trip is independent and cancel is safe', async () => {
  const dialog = await save(true)
  await dialog.getByRole('button', { name: '템플릿 편집', exact: true }).click()
  await dialog.getByLabel('템플릿 이름', { exact: true }).fill(name + ' 수정')
  await dialog.getByRole('button', { name: '템플릿 변경 저장', exact: true }).click()
  await dialog.getByRole('button', { name: '템플릿 복제', exact: true }).click()
  await expect.poll(async () => (await state()).serviceTemplates.length).toBe(2)
  await dialog.getByRole('button', { name: '템플릿 휴지통으로', exact: true }).click()
  await expect
    .poll(async () => (await state()).serviceTemplates.filter((entry) => entry.deletedAt).length)
    .toBe(1)
  await dialog.getByRole('checkbox', { name: '템플릿 휴지통', exact: true }).check()
  await dialog
    .getByRole('button', { name: new RegExp(name + ' 수정'), exact: false })
    .first()
    .click()
  await dialog.getByRole('button', { name: '템플릿 복원', exact: true }).click()
  await dialog.getByRole('checkbox', { name: '템플릿 휴지통', exact: true }).uncheck()
  await dialog
    .getByRole('button', { name: new RegExp(name + ' 수정'), exact: false })
    .first()
    .click()
  const file = path.join(dir, 'template.ppros')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  }, file)
  await dialog.getByRole('button', { name: '템플릿 파일 저장', exact: true }).click()
  await expect
    .poll(async () =>
      fs
        .readFile(file, 'utf8')
        .then((data) => JSON.parse(data).kind)
        .catch(() => ''),
    )
    .toBe('service-template')
  const before = await state()
  await dialog.getByRole('button', { name: '템플릿 파일 불러오기', exact: true }).click()
  expect((await state()).serviceTemplates).toEqual(before.serviceTemplates)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })
  await dialog.getByRole('button', { name: '템플릿 파일 불러오기', exact: true }).click()
  await expect.poll(async () => (await state()).serviceTemplates.length).toBe(3)
  expect((await state()).setlists).toEqual(before.setlists)
  expect((await state()).live).toEqual(before.live)
})
test('new-service entry offers templates and preserves an entered title and date through the template flow', async () => {
  const dialog = await save(true)
  await dialog.getByRole('button', { name: '닫기', exact: true }).click()
  await page.getByRole('button', { name: '새 콘티', exact: true }).click()
  const create = page.getByRole('dialog', { name: '새 콘티', exact: true })
  await create.getByRole('textbox', { name: '콘티 이름', exact: true }).fill('새 예배 입력 보존')
  await create.getByRole('button', { name: '템플릿으로 만들기', exact: true }).click()
  await expect(create).toHaveCount(0)
  await dialog
    .getByRole('button', { name: new RegExp(name), exact: false })
    .first()
    .click()
  await dialog.getByRole('button', { name: '이 템플릿으로 만들기', exact: true }).click()
  await expect(dialog.getByLabel('템플릿 새 예배 이름', { exact: true })).toHaveValue(
    '새 예배 입력 보존',
  )
})
