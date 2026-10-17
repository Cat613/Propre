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
  expect(dir).not.toContain('Application Support')
  await expect.poll(() => app.windows().some((w) => w.url().includes('control-panel'))).toBe(true)
  page = app.windows().find((w) => w.url().includes('control-panel'))!
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-stage-message-'))
  const repo = new Repository(dir)
  await repo.open()
  await repo.saveDraft({
    id: 'song',
    title: '합성 찬양',
    slides: [{ id: 'slide', type: 'text', content: '동시에 유지할 합성 가사' }],
    createdAt: '2026-10-16T00:00:00.000Z',
    updatedAt: '2026-10-16T00:00:00.000Z',
  })
  await repo.setPlaylist([{ id: 'row', presentationId: 'song' }])
  const list = repo.state.setlists[0],
    plan = structuredClone(list.servicePlan!)
  plan.items[0].operatorNote = '운영자만 볼 합성 메모'
  plan.items[0].stageNote = '저장된 무대 초안'
  await repo.saveServicePlan({
    requestId: crypto.randomUUID(),
    setlistId: list.id,
    expectedSetlistRevision: list.revision,
    plan,
  })
  await launch()
})
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
})
async function openScreens() {
  await page.evaluate(async () => {
    await window.ipcRenderer.toggleOutput()
    await window.ipcRenderer.toggleStage()
    const state = await window.ipcRenderer.bootstrap(),
      list = state.setlists[0]
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
  await page.getByRole('button', { name: '전체 순서', exact: true }).click()
  await page.getByRole('button', { name: '1. 합성 찬양', exact: true }).click()
  return {
    output: app.windows().find((w) => w.url().includes('output-display'))!,
    stage: app.windows().find((w) => w.url().includes('stage-display'))!,
  }
}
test('saved notes stay private and explicit Stage send/replace/clear preserves audience and lyrics', async () => {
  const { output, stage } = await openScreens()
  await expect(stage.locator('[data-stage-message]')).toHaveCount(0)
  await page.getByText('무대 안내 · 청중 비공개', { exact: true }).click()
  const input = page.getByLabel('무대로 보낼 안내', { exact: true })
  await expect(input).toHaveValue('저장된 무대 초안')
  await input.fill('기도 후 봉독자가 앞으로 나와주세요')
  const before = await page.evaluate(() => window.ipcRenderer.bootstrap())
  await page.getByRole('button', { name: '무대에 보내기', exact: true }).click()
  await expect(stage.locator('[data-stage-message-text]')).toHaveText(
    '기도 후 봉독자가 앞으로 나와주세요',
  )
  await expect(page.getByText('무대 표시 중', { exact: true }).first()).toBeVisible()
  await expect(stage.getByText('동시에 유지할 합성 가사', { exact: true })).toBeVisible()
  expect(await output.locator('body').innerText()).not.toContain('기도 후 봉독자')
  expect(await output.locator('body').innerText()).not.toContain('운영자만')
  expect((await page.evaluate(() => window.ipcRenderer.bootstrap())).live).toEqual(before.live)
  await input.fill('바뀐 입력은 전송 전까지 표시되지 않음')
  await expect(stage.locator('[data-stage-message-text]')).toHaveText(
    '기도 후 봉독자가 앞으로 나와주세요',
  )
  await page.getByRole('button', { name: '이 안내로 교체해 무대에 보내기', exact: true }).click()
  await expect(stage.locator('[data-stage-message-text]')).toHaveText(
    '바뀐 입력은 전송 전까지 표시되지 않음',
  )
  await page.getByRole('button', { name: '무대 안내 지우기', exact: true }).click()
  await expect(stage.locator('[data-stage-message]')).toHaveCount(0)
  await expect(stage.getByText('동시에 유지할 합성 가사', { exact: true })).toBeVisible()
  const saved = await fs.readFile(path.join(dir, 'workspace-v5.json'), 'utf8')
  expect(saved).toContain('저장된 무대 초안')
  expect(saved).not.toContain('바뀐 입력은 전송')
})
test('TTL, reconnect, F2 and restart remove ephemeral messages while Main cannot access message commands', async () => {
  const { output, stage } = await openScreens()
  expect(await stage.evaluate(() => typeof window.ipcRenderer.stageMessage)).toBe('undefined')
  expect(await output.evaluate(() => typeof window.ipcRenderer.stageMessage)).toBe('undefined')
  await page.evaluate(async () => {
    const current = (await window.ipcRenderer.bootstrap()).stageMessage
    await window.ipcRenderer.stageMessage({
      action: 'send',
      requestId: crypto.randomUUID(),
      expectedRevision: current.revision,
      text: '5초 뒤 제거할 안내',
      ttl: 5,
    })
  })
  await expect(stage.locator('[data-stage-message]')).toBeVisible()
  await stage.reload()
  await expect(stage.locator('[data-stage-message-text]')).toHaveText('5초 뒤 제거할 안내')
  await expect(stage.locator('[data-stage-message]')).toHaveCount(0, { timeout: 8000 })
  await stage.reload()
  await expect(stage.locator('[data-stage-message]')).toHaveCount(0)
  await page.evaluate(async () => {
    const current = (await window.ipcRenderer.bootstrap()).stageMessage
    await window.ipcRenderer.stageMessage({
      action: 'send',
      requestId: crypto.randomUUID(),
      expectedRevision: current.revision,
      text: '직접 지우는 안내',
      ttl: 0,
    })
  })
  await expect(stage.locator('[data-stage-message]')).toBeVisible()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL().includes('stage-display'))!
      .webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F2' }),
  )
  await expect(stage.locator('[data-stage-message]')).toHaveCount(0)
  await page.evaluate(async () => {
    const current = (await window.ipcRenderer.bootstrap()).stageMessage
    await window.ipcRenderer.stageMessage({
      action: 'send',
      requestId: crypto.randomUUID(),
      expectedRevision: current.revision,
      text: '재시작 시 제거할 안내',
      ttl: 0,
    })
  })
  await app.evaluate(({ app }) => app.exit(0))
  await app.close()
  await launch()
  expect(
    (await page.evaluate(() => window.ipcRenderer.bootstrap())).stageMessage.message,
  ).toBeNull()
})
test('long Korean message, small windows and keyboard compose keep Stage layout separate from lyrics', async () => {
  const { stage } = await openScreens()
  await page.getByText('무대 안내 · 청중 비공개', { exact: true }).click()
  const input = page.getByLabel('무대로 보낼 안내', { exact: true })
  await input.fill('긴'.repeat(120))
  await expect(page.getByRole('button', { name: '무대에 보내기', exact: true })).toBeDisabled()
  await input.fill('합성 안내 문장이 길어져도 현재 가사와 겹치지 않도록 두 줄까지만 표시합니다')
  await input.press('Enter')
  await expect(stage.locator('[data-stage-message]')).toHaveCount(0)
  await input.fill('첫째 줄\n둘째 줄\n셋째 줄')
  await expect(page.getByRole('button', { name: '무대에 보내기', exact: true })).toBeDisabled()
  await input.fill('다음 찬양은 후렴부터 시작합니다\n화면을 확인해주세요')
  await page.getByRole('button', { name: '무대에 보내기', exact: true }).click()
  await expect(stage.locator('[data-stage-message]')).toBeVisible()
  const positions = await stage.evaluate(() => {
    const banner = document.querySelector('[data-stage-message]')!.getBoundingClientRect(),
      current = document.querySelector('[data-stage-section="current"]')!.getBoundingClientRect(),
      next = document.querySelector('[data-stage-section="next"]')!.getBoundingClientRect()
    return {
      bannerBottom: banner.bottom,
      currentTop: current.top,
      currentHeight: current.height,
      nextTop: next.top,
      currentBottom: current.bottom,
    }
  })
  expect(positions.bannerBottom).toBeLessThanOrEqual(positions.currentTop)
  expect(positions.currentHeight).toBeGreaterThan(100)
  expect(positions.currentBottom).toBeLessThanOrEqual(positions.nextTop)
  await stage.screenshot({ path: '/tmp/propre-worship-stage-message.png' })
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL().includes('control-panel'))!
      .setBounds({ width: 1024, height: 768 }),
  )
  await page.screenshot({ path: '/tmp/propre-worship-message-control-compact.png' })
  await expect(page.getByRole('button', { name: '준비 확인', exact: true })).toBeInViewport({
    ratio: 1,
  })
})
