import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let server: ViteDevServer, app: ElectronApplication | undefined, dir: string, url: string
let environment: NodeJS.ProcessEnv
const productionArtifacts = new Map<string, Buffer>()

test.beforeAll(async () => {
  environment = { ...process.env }
  for (const file of ['dist-electron/main.js', 'dist-electron/preload.mjs'])
    productionArtifacts.set(file, await fs.readFile(file))
  process.env.ELECTRON_STARTUP_PREVENT = '1'
  server = await createServer({ server: { port: 5183, strictPort: true }, logLevel: 'error' })
  await server.listen()
  url = server.resolvedUrls!.local[0]
  // Exercise the real project configuration, including the React startup script and Electron builds.
  await expect
    .poll(async () =>
      (await fs.readFile('dist-electron/main.js', 'utf8')).includes('isControlReady'),
    )
    .toBe(true)
})
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-development-'))
})
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  app = undefined
  await fs.rm(dir, { recursive: true, force: true })
})
test.afterAll(async () => {
  await server?.close()
  for (const [file, data] of productionArtifacts) await fs.writeFile(file, data)
  for (const key of ['ELECTRON_STARTUP_PREVENT', 'PROPRE_DEV_CSP_NONCE', 'VITE_DEV_SERVER_URL']) {
    if (environment[key] === undefined) delete process.env[key]
    else process.env[key] = environment[key]
  }
})
async function launch(nonce = process.env.PROPRE_DEV_CSP_NONCE) {
  app = await electron.launch({
    args: [path.resolve('dist-electron/main.js')],
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: url,
      PROPRE_DEV_CSP_NONCE: nonce,
      PROPRE_TEST: '1',
      PROPRE_TEST_HEADLESS: '1',
      PROPRE_TEST_USER_DATA: dir,
    },
  })
  expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(dir)
  expect(dir).not.toContain('Application Support')
  return app.firstWindow()
}

test('development startup renders the control, autosaves, and closes normally under CSP', async () => {
  const page = await launch()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  expect(page.url()).not.toContain('//#')
  expect(await page.evaluate(() => window.ipcRenderer.role)).toBe('control')
  const nonce = await page.evaluate(
    () => document.querySelector<HTMLElement>('meta[property="csp-nonce"]')?.nonce,
  )
  expect(nonce).toBe(process.env.PROPRE_DEV_CSP_NONCE)
  await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(dir, 'workspace-v4.json'), 'utf8')).draft?.slides
          .length,
    )
    .toBe(1)
  await page.evaluate(() => window.ipcRenderer.toggleStage())
  await expect.poll(() => app!.windows().length).toBe(2)
  const stage = app!.windows().find((window) => window.url().includes('stage-display'))!
  await expect(stage.locator('body')).not.toBeEmpty()
  expect(errors).toEqual([])
  // The startup exception is scoped to the authorized nonce; arbitrary inline scripts stay blocked.
  await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'globalThis.__untrustedInline = true'
    document.head.append(script)
  })
  expect(await page.evaluate(() => '__untrustedInline' in globalThis)).toBe(false)
  await app!.close()
  app = undefined
})

test('a control that never initialized can close without a false autosave failure dialog', async () => {
  const page = await launch('DifferentStartupNonce123')
  await page.waitForLoadState('networkidle')
  expect(await page.locator('body').innerText()).toBe('')
  const started = Date.now()
  await app!.close()
  app = undefined
  expect(Date.now() - started).toBeLessThan(5000)
})
