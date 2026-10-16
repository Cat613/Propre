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
import { randomUUID } from 'node:crypto'
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
  page = await app.firstWindow()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-timer-native-'))
  const repo = new Repository(dir)
  await repo.open()
  await repo.saveDraft({
    id: 'song',
    title: '타이머 합성 찬양',
    slides: [{ id: 'slide', type: 'text', content: '타이머와 함께 유지할 가사' }],
    revision: 1,
    createdAt: '2026-10-16T00:00:00Z',
    updatedAt: '2026-10-16T00:00:00Z',
  })
  await repo.setPlaylist([{ id: 'row', presentationId: 'song' }])
  const list = repo.state.setlists[0],
    plan = structuredClone(list.servicePlan!)
  plan.items[0].durationSeconds = 2
  plan.items[0].timer = {
    mode: 'countdown',
    targetSeconds: 2,
    warningSeconds: 1,
    autoStart: false,
    showOnStage: false,
  }
  plan.items.push({
    id: 'prayer',
    kind: 'prayer',
    title: '합성 기도',
    durationSeconds: 60,
    enter: { visual: 'keep', audio: 'keep' },
    timer: { mode: 'countup', warningSeconds: 0, autoStart: true, showOnStage: false },
  })
  await repo.saveServicePlan({
    requestId: randomUUID(),
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
async function state() {
  return page.evaluate(() => window.ipcRenderer.bootstrap())
}
async function prepare(cueId?: string) {
  return page.evaluate(async (cueId) => {
    const state = await window.ipcRenderer.bootstrap(),
      list = state.setlists[0]
    return window.ipcRenderer.prepareServiceCue({
      setlistId: list.id,
      cueId: cueId || list.servicePlan!.items[0].id,
      expectedSetlistRevision: list.revision,
    })
  }, cueId)
}
async function run() {
  await page.evaluate(() => window.ipcRenderer.toggleStage())
  const prepared = await prepare()
  await page.evaluate((token) => window.ipcRenderer.commitServiceCue(token), prepared.token)
  await page.getByRole('button', { name: '전체 순서', exact: true }).click()
  const panel = page.locator('details[aria-label="예배 진행 타이머"]')
  await panel.locator('summary').click()
  return panel
}
test('timers start explicitly, count beyond zero without advancing, and Stage message/timer/lyrics do not overlap', async () => {
  await prepare()
  expect((await state()).serviceTimer).toBeNull()
  const panel = await run(),
    before = await state(),
    cueId = before.serviceSession?.currentCueId
  expect(before.serviceTimer).toMatchObject({ state: 'idle', elapsedMs: 0 })
  const began = performance.now()
  await panel.getByRole('button', { name: '타이머 시작', exact: true }).click()
  await panel.getByRole('checkbox', { name: '타이머 무대 표시', exact: true }).check()
  const stage = app.windows().find((win) => win.url().includes('stage-display'))!
  await expect(stage.locator('[data-stage-timer]')).toBeVisible()
  await page.evaluate(async () => {
    const state = await window.ipcRenderer.bootstrap()
    await window.ipcRenderer.stageMessage({
      action: 'send',
      requestId: crypto.randomUUID(),
      expectedRevision: state.stageMessage.revision,
      text: '현재 타이머는 무대에만 표시됩니다\n가사와 안내 영역을 함께 확인해주세요',
      ttl: 0,
    })
  })
  await expect(stage.locator('[data-stage-message]')).toBeVisible()
  await expect(panel.getByLabel('현재 타이머', { exact: true })).toContainText('초과', {
    timeout: 6000,
  })
  expect((await state()).serviceSession?.currentCueId).toBe(cueId)
  expect((await state()).live).toEqual(before.live)
  const bounds = await stage.evaluate(() => {
    const message = document.querySelector('[data-stage-message]')!.getBoundingClientRect(),
      timer = document.querySelector('[data-stage-timer]')!.getBoundingClientRect(),
      current = document.querySelector('[data-stage-section="current"]')!.getBoundingClientRect()
    return {
      messageBottom: message.bottom,
      timerTop: timer.top,
      timerBottom: timer.bottom,
      currentTop: current.top,
    }
  })
  expect(bounds.messageBottom).toBeLessThanOrEqual(bounds.timerTop)
  expect(bounds.timerBottom).toBeLessThanOrEqual(bounds.currentTop)
  const output = app.windows().find((win) => win.url().includes('output-display'))!
  expect(await output.locator('[data-stage-timer]').count()).toBe(0)
  expect(await output.locator('body').innerText()).not.toContain('무대에만')
  await stage.screenshot({ path: '/tmp/propre-worship-timer-stage.png', animations: 'disabled' })
  await panel.getByRole('button', { name: '타이머 일시정지', exact: true }).click()
  await expect(panel.getByRole('button', { name: '타이머 재개', exact: true })).toBeEnabled()
  const measured = (await state()).serviceTimer!.elapsedMs,
    observed = performance.now() - began
  expect(Math.abs(measured - observed)).toBeLessThan(1000)
  await fs.writeFile(
    '/tmp/propre-worship-timer-native-timing.json',
    JSON.stringify({
      observedMs: observed,
      timerMs: measured,
      differenceMs: Math.abs(measured - observed),
      claim: 'short local run; not a 60 minute drift test',
    }),
  )
  await panel.getByRole('button', { name: '타이머 +1분', exact: true }).click()
  expect((await state()).serviceTimer?.targetSeconds).toBe(62)
  expect((await state()).setlists[0].servicePlan!.items[0].durationSeconds).toBe(2)
  await panel.getByRole('button', { name: '타이머 초기화', exact: true }).click()
  expect((await state()).serviceTimer?.state).toBe('idle')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL().includes('control-panel'))!
      .setBounds({ width: 1024, height: 768 }),
  )
  await page.screenshot({
    path: '/tmp/propre-worship-timer-control-compact.png',
    animations: 'disabled',
  })
})
test('selection keeps the timer, successful cue commit makes a new runtime and F2/sleep/restart pause it with Stage hidden', async () => {
  const panel = await run()
  await panel.getByRole('button', { name: '타이머 시작', exact: true }).click()
  const first = (await state()).serviceTimer!
  await page.getByRole('button', { name: '2. 합성 기도', exact: true }).click()
  expect((await state()).serviceTimer?.runId).toBe(first.runId)
  const prepared = await prepare('prayer')
  await page.evaluate((token) => window.ipcRenderer.commitServiceCue(token), prepared.token)
  const next = (await state()).serviceTimer!
  expect(next.runId).not.toBe(first.runId)
  expect(next).toMatchObject({ mode: 'countup', state: 'running' })
  await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'))
  await expect.poll(async () => (await state()).serviceTimer?.reason).toBe('sleep')
  await panel.getByRole('button', { name: '타이머 재개', exact: true }).click()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL().includes('control-panel'))!
      .webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F2' }),
  )
  await expect.poll(async () => (await state()).serviceTimer?.reason).toBe('emergency')
  expect((await state()).serviceTimer?.showOnStage).toBe(false)
  await expect(panel.getByRole('button', { name: '타이머 재개', exact: true })).toBeEnabled()
  // Force a normal timer command checkpoint after the emergency transition before restarting Main.
  await page.evaluate(async () => {
    const timer = (await window.ipcRenderer.bootstrap()).serviceTimer!
    await window.ipcRenderer.serviceTimer({
      action: 'resume',
      requestId: crypto.randomUUID(),
      expectedRevision: timer.revision,
    })
  })
  await app.evaluate(({ app }) => app.exit(0))
  await app.close()
  await launch()
  expect((await state()).serviceTimer).toMatchObject({
    state: 'paused',
    showOnStage: false,
    reason: 'restart',
    runId: next.runId,
  })
  const history = JSON.parse(
    await fs.readFile(path.join(dir, 'service-timer-v1.json'), 'utf8'),
  ).history
  expect(history.some((entry: { runId: string }) => entry.runId === first.runId)).toBe(true)
})

test('cue timer presets are saved explicitly without starting a runtime or sending Stage output', async () => {
  await page.getByRole('button', { name: '전체 순서', exact: true }).click()
  await page.getByRole('button', { name: '2. 합성 기도', exact: true }).click()
  await page.getByRole('button', { name: '선택한 순서 편집', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '예배 순서 편집' })
  await dialog.getByLabel('타이머 방식', { exact: true }).selectOption('countdown')
  await dialog.getByLabel('타이머 목표 분', { exact: true }).fill('30')
  await dialog.getByLabel('타이머 경고 분', { exact: true }).fill('2')
  await dialog
    .getByRole('checkbox', { name: '이 순서 진행 성공 시 타이머 자동 시작', exact: true })
    .uncheck()
  await dialog
    .getByRole('checkbox', { name: '진행 시 타이머 무대 표시 · 무대 창 필요', exact: true })
    .check()
  await dialog.getByRole('button', { name: '변경 저장', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const saved = await state()
  expect(saved.setlists[0].servicePlan!.items[1].timer).toMatchObject({
    mode: 'countdown',
    targetSeconds: 1800,
    warningSeconds: 120,
    autoStart: false,
    showOnStage: true,
  })
  expect(saved.serviceTimer).toBeNull()
  expect(saved.live).toBeNull()
})
