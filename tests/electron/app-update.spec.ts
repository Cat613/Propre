import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
let app: ElectronApplication, page: Page, dir: string
let revision = 100
async function state(status: string, extra: Record<string, unknown> = {}) {
  await app.evaluate(
    ({ BrowserWindow }, value) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === 'ProPre · 컨트롤')!
        .webContents.send('app-update-changed', value)
    },
    { revision: revision++, currentVersion: '0.1.0', status, ...extra },
  )
}
async function stubDownload(fail = false) {
  await app.evaluate(
    ({ ipcMain }, response) => {
      ipcMain.removeHandler('download-app-update')
      ipcMain.handle('download-app-update', () => {
        if (response.fail) throw new Error('Browser unavailable')
        return response.state
      })
    },
    {
      fail,
      state: {
        revision: revision++,
        currentVersion: '0.1.0',
        status: 'download-opened',
        version: '0.2.0',
        message: '브라우저에서 다운로드를 확인하세요.',
      },
    },
  )
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-free-update-'))
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
  page = await app.firstWindow()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
})
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
})
test('unconfigured development stays offline and exposes no install or restart API', async () => {
  await expect(page.getByRole('button', { name: '업데이트 주소 미설정' })).toBeDisabled()
  expect(
    await page.evaluate(async () => {
      await window.ipcRenderer.checkAppUpdate()
      return (await window.ipcRenderer.downloadAppUpdate()).status
    }),
  ).toBe('disabled')
  expect(await page.evaluate(() => typeof (window.ipcRenderer as any).installAppUpdate)).toBe(
    'undefined',
  )
  await expect(page.getByRole('button', { name: '재시작하여 업데이트' })).toHaveCount(0)
})
test('a new version opens an accessible replacement guide, then reports only a browser handoff', async () => {
  await state('available', { version: '0.2.0' })
  await page.getByRole('button', { name: 'v0.2.0 다운로드' }).click()
  const guide = page.getByRole('dialog', { name: '새 버전 다운로드와 앱 교체' })
  await expect(guide).toBeVisible()
  await expect(guide.getByText(/Applications/)).toBeVisible()
  await stubDownload()
  await guide.getByRole('button', { name: '설치 파일 받기' }).click()
  await expect(guide.getByRole('button', { name: '설치 파일 다시 받기' })).toBeEnabled()
  await expect(guide.getByRole('status')).toContainText('브라우저')
  await page.keyboard.press('Escape')
  await expect(guide).toHaveCount(0)
  await expect(page.getByRole('button', { name: '다운로드·교체 안내' })).toBeVisible()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
})
test('browser errors are recoverable and lower-revision snapshots never replace the notice', async () => {
  await state('available', { version: '0.2.0' })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.getTitle() === 'ProPre · 컨트롤')!
      .webContents.send('app-update-changed', {
        revision: 0,
        currentVersion: '0.1.0',
        status: 'idle',
      })
  })
  await page.getByRole('button', { name: 'v0.2.0 다운로드' }).click()
  await stubDownload(true)
  const guide = page.getByRole('dialog')
  await guide.getByRole('button', { name: '설치 파일 받기' }).click()
  await expect(guide.getByRole('status')).toContainText('다운로드를 열지 못했습니다.')
  await stubDownload()
  await guide.getByRole('button', { name: '설치 파일 받기' }).click()
  await expect(guide.getByRole('button', { name: '설치 파일 다시 받기' })).toBeEnabled()
})
test('opening the download guide preserves output and denies update APIs to output windows', async () => {
  await page.evaluate(() => window.ipcRenderer.toggleOutput())
  await state('available', { version: '0.2.0' })
  await page.getByRole('button', { name: 'v0.2.0 다운로드' }).click()
  await expect(page.getByRole('dialog').getByText(/예배와 송출을 모두 마친/)).toBeVisible()
  const output = app.windows().find((w) => w !== page)!
  await output.waitForLoadState('domcontentloaded')
  expect(await output.evaluate(() => typeof window.ipcRenderer.downloadAppUpdate)).toBe('undefined')
  await stubDownload()
  await page.getByRole('button', { name: '설치 파일 받기', exact: true }).click()
  expect(app.windows()).toContain(output)
  expect(await output.evaluate(() => window.ipcRenderer.role)).toBe('main')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
