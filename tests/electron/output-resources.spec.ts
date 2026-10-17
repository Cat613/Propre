import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createServer, type Server } from 'node:http'
import { PDFDocument, rgb } from 'pdf-lib'
let app: ElectronApplication, page: Page, dir: string, server: Server, url: string
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
  page = await app.firstWindow()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-output-'))
  server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end(
      '<body style="background:#ccd;height:3000px"><input id="input"><button id="button" onclick="document.body.dataset.clicked=\'yes\'">click</button><script>document.cookie="fixture=one"</script></body>',
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  await launch()
})
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await fs.rm(dir, { recursive: true, force: true })
})
async function resourceTab() {
  await page.getByRole('button', { name: '미디어', exact: true }).click()
}
async function addPDF() {
  const pdf = await PDFDocument.create()
  const first = pdf.addPage([300, 500])
  first.drawRectangle({ x: 0, y: 0, width: 300, height: 500, color: rgb(1, 0, 0) })
  const second = pdf.addPage([500, 300])
  second.drawRectangle({ x: 0, y: 0, width: 500, height: 300, color: rgb(0, 0, 1) })
  const file = path.join(dir, 'fixture.pdf')
  await fs.writeFile(file, await pdf.save())
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  return (await page.evaluate(() => window.ipcRenderer.selectOutputPDFs())).resources.find(
    (r) => r.kind === 'pdf',
  )!
}
test('PDF preparation protects slides, renders pages, switches stage and stops without late redisplay', async () => {
  await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
  await page.getByTestId('slide-card').first().dblclick()
  await page.locator('textarea').first().fill('preserved slide')
  await page.locator('textarea').first().press('Tab')
  const r = await addPDF()
  const prepared = await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision, page: 1 }),
    r,
  )
  expect(prepared.frameURL).toMatch(/^output:/)
  expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind).toBe(
    'slides',
  )
  await page.evaluate(
    async (p) => window.ipcRenderer.commitOutputResource(p.token, p.generation),
    prepared,
  )
  await expect
    .poll(
      async () => (await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind,
    )
    .toBe('pdf')
  const output = app.windows().find((w) => w !== page && w.url().includes('output-display'))!
  await expect(output.locator('[data-output-source="pdf"]')).toBeVisible()
  const opened = app.waitForEvent('window')
  await page.evaluate(() => window.ipcRenderer.toggleStage())
  const stage = await opened
  await stage.waitForURL('**/*#stage-display')
  await expect(stage.getByAltText('현재 PDF 페이지')).toBeVisible()
  const second = await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({
        resourceId: r.id,
        revision: r.revision,
        page: 2,
        rotation: 90,
      }),
    r,
  )
  await page.evaluate(
    async (p) => window.ipcRenderer.commitOutputResource(p.token, p.generation),
    second,
  )
  await expect(stage.getByText('문서 끝', { exact: true })).toBeVisible()
  await expect(
    page.evaluate(
      async (r) =>
        window.ipcRenderer.manageOutputResource({
          action: 'delete',
          id: r.id,
          revision: r.revision,
        }),
      r,
    ),
  ).rejects.toThrow()
  await page.evaluate(() => window.ipcRenderer.returnToSlides())
  await expect(output.locator('[data-output-source="pdf"]')).toHaveCount(0)
  await expect(page.getByText('preserved slide', { exact: true }).first()).toBeVisible()
  const stale = await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision, page: 1 }),
    r,
  )
  await page.evaluate(() => window.ipcRenderer.stopExternalOutput())
  await expect(
    page.evaluate(
      async (p) => window.ipcRenderer.commitOutputResource(p.token, p.generation),
      stale,
    ),
  ).rejects.toThrow()
  expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind).toBe(
    'slides',
  )
})
test('URL uses one isolated browser and keeps its state across live output and native F2 stop', async () => {
  const resources = await page.evaluate(
    async (url) =>
      window.ipcRenderer.manageOutputResource({ action: 'create-web', name: 'fixture', url }),
    url,
  )
  const r = resources[0]
  const p = await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision }),
    r,
  )
  const before = await app.evaluate(async ({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find((w) => w.getURL() === url)!
    await contents.executeJavaScript(
      "document.querySelector('#input').value='retained';scrollTo(0,200)",
    )
    return contents.id
  }, url)
  await page.evaluate(
    async (p) => window.ipcRenderer.commitOutputResource(p.token, p.generation),
    p,
  )
  const state = await app.evaluate(async ({ webContents }, url) => {
    const views = webContents.getAllWebContents().filter((w) => w.getURL() === url)
    return {
      count: views.length,
      id: views[0].id,
      prefs: views[0].getLastWebPreferences(),
      state: await views[0].executeJavaScript(
        "({value:document.querySelector('#input').value,scroll:scrollY,bridge:typeof window.ipcRenderer,node:typeof require})",
      ),
    }
  }, url)
  expect(state.count).toBe(1)
  expect(state.id).toBe(before)
  expect(state.state).toEqual({
    value: 'retained',
    scroll: 200,
    bridge: 'undefined',
    node: 'undefined',
  })
  expect(state.prefs.nodeIntegration).toBe(false)
  const status = await page.evaluate(() => window.ipcRenderer.getExternalOutput())
  expect(status.browser?.muted).toBe(true)
  await expect(
    page.evaluate(
      async (generation) =>
        window.ipcRenderer.browserOutputCommand({ action: 'reload', generation }),
      status.generation,
    ),
  ).rejects.toThrow()
  await app.evaluate(
    ({ webContents }, url) =>
      webContents
        .getAllWebContents()
        .find((w) => w.getURL() === url)!
        .sendInputEvent({ type: 'keyDown', keyCode: 'F2' }),
    url,
  )
  await expect
    .poll(
      async () => (await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind,
    )
    .toBe('slides')
  expect(
    await app.evaluate(
      ({ webContents }, url) =>
        webContents.getAllWebContents().filter((w) => w.getURL() === url).length,
      url,
    ),
  ).toBe(0)
})
test('registered URL survives restart without reconnecting and its UI prepares before sending', async () => {
  await resourceTab()
  await page.getByRole('button', { name: 'URL 추가', exact: true }).click()
  await page.getByLabel('웹 자료 이름').fill('saved web')
  await page.getByLabel('웹 주소', { exact: true }).fill(url)
  await page.getByRole('button', { name: '주소 저장', exact: true }).click()
  await page.getByRole('button', { name: '웹 · saved web', exact: true }).click()
  await expect(page.getByRole('button', { name: '준비 화면 송출', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '화면 준비', exact: true }).click()
  await expect(page.getByRole('button', { name: '준비 화면 송출', exact: true })).toBeEnabled()
  expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind).toBe(
    'slides',
  )
  await page.getByRole('button', { name: '준비 화면 송출', exact: true }).click()
  await expect(page.getByText('현재 송출: saved web · 웹', { exact: true })).toBeVisible()
  await app.close()
  await launch()
  const loaded = await page.evaluate(() => window.ipcRenderer.bootstrap())
  expect(loaded.outputResources[0].name).toBe('saved web')
  expect(loaded.externalOutput.source.kind).toBe('slides')
  expect(loaded.externalOutput.browser).toBeUndefined()
  expect(
    await app.evaluate(
      ({ webContents }, url) =>
        webContents.getAllWebContents().filter((w) => w.getURL() === url).length,
      url,
    ),
  ).toBe(0)
})

test('PDF panel separates thumbnail preparation from live page controls and stays within its panel', async () => {
  await addPDF()
  await page.reload()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  await resourceTab()
  await page.getByRole('button', { name: 'PDF · fixture.pdf', exact: true }).click()
  await expect(page.getByRole('button', { name: 'PDF 2페이지 준비', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'PDF 2페이지 준비', exact: true }).click()
  await expect(page.getByRole('button', { name: '준비 화면 송출', exact: true })).toBeEnabled()
  expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind).toBe(
    'slides',
  )
  await page.getByRole('button', { name: '준비 화면 송출', exact: true }).click()
  await expect(page.getByText('현재 송출: fixture.pdf · 2/2', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '송출 다음', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '송출 이전', exact: true }).click()
  await expect(page.getByText('현재 송출: fixture.pdf · 1/2', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/output-resources-control.png' })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  expect(overflow).toBe(false)
  await page.getByRole('button', { name: '전체 중지', exact: true }).last().click()
  expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind).toBe(
    'slides',
  )
})

test('remote browser cannot read application files, open popups or grant local upload files', async () => {
  const r = (
    await page.evaluate(
      async (url) =>
        window.ipcRenderer.manageOutputResource({
          action: 'create-web',
          name: 'security fixture',
          url,
        }),
      url,
    )
  )[0]
  await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision }),
    r,
  )
  const result = await app.evaluate(async ({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find((w) => w.getURL() === url)!
    return contents.executeJavaScript(
      `(async()=>{ const local = await fetch('app://propre/index.html').then(()=>false,()=>true); const popup=window.open('${url}?popup=1');return {local,popup:popup===null,bridge:typeof window.ipcRenderer};})()`,
      true,
    )
  }, url)
  expect(result).toEqual({ local: true, popup: true, bridge: 'undefined' })
  await app.evaluate(async ({ webContents }, url) => {
    const contents = webContents.getAllWebContents().find((w) => w.getURL() === url)!
    await contents.executeJavaScript(
      "const input=document.createElement('input');input.type='file';document.body.append(input);input.click();",
      true,
    )
  }, url)
  await expect(
    page.getByText('파일 업로드는 송출 브라우저에서 지원하지 않습니다.', { exact: true }),
  ).toBeVisible()
  await page.evaluate(() => window.ipcRenderer.stopExternalOutput())
})

test('navigation invalidates a web preparation token and a fresh preparation uses the current page', async () => {
  const r = (
    await page.evaluate(
      async (url) =>
        window.ipcRenderer.manageOutputResource({ action: 'create-web', name: 'navigation', url }),
      url,
    )
  )[0]
  const prepared = await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision }),
    r,
  )
  await app.evaluate(async ({ webContents }, url) => {
    const w = webContents.getAllWebContents().find((w) => w.getURL() === url)!
    await w.loadURL(`${url}?second=1`)
  }, url)
  await expect(
    page.evaluate(
      async (p) => window.ipcRenderer.commitOutputResource(p.token, p.generation),
      prepared,
    ),
  ).rejects.toThrow()
  const fresh = await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision }),
    r,
  )
  const status = await page.evaluate(
    async (p) => window.ipcRenderer.commitOutputResource(p.token, p.generation),
    fresh,
  )
  expect(status.browser?.url).toBe(`${url}?second=1`)
})

test('PDF relinking changes revision, page count and rendered cache identity', async () => {
  const r = await addPDF()
  expect(r.kind).toBe('pdf')
  if (r.kind !== 'pdf') throw new Error('fixture')
  const old = await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision }),
    r,
  )
  const workspace = JSON.parse(await fs.readFile(path.join(dir, 'workspace-v5.json'), 'utf8'))
  const asset = workspace.assets.find((a: { id: string }) => a.id === r.assetId)
  await fs.rm(path.join(dir, 'media', asset.filename))
  const replacement = await PDFDocument.create()
  replacement
    .addPage([400, 300])
    .drawRectangle({ x: 0, y: 0, width: 400, height: 300, color: rgb(0, 1, 0) })
  const file = path.join(dir, 'replacement.pdf')
  await fs.writeFile(file, await replacement.save())
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  await page.evaluate(() => window.ipcRenderer.relinkMedia())
  const fresh = (await page.evaluate(() => window.ipcRenderer.listOutputResources()))[0]
  expect(fresh).toMatchObject({ revision: r.revision + 1, pageCount: 1 })
  await expect(
    page.evaluate(async (p) => window.ipcRenderer.commitOutputResource(p.token, p.generation), old),
  ).rejects.toThrow()
  const next = await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision }),
    fresh,
  )
  expect(next.frameURL).not.toBe(old.frameURL)
  await page.evaluate(
    async (p) => window.ipcRenderer.commitOutputResource(p.token, p.generation),
    next,
  )
})

test('browser renderer loss freezes the last capture and permits slide recovery', async () => {
  const r = (
    await page.evaluate(
      async (url) =>
        window.ipcRenderer.manageOutputResource({ action: 'create-web', name: 'crash', url }),
      url,
    )
  )[0]
  const prepared = await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision }),
    r,
  )
  await page.evaluate(
    async (p) => window.ipcRenderer.commitOutputResource(p.token, p.generation),
    prepared,
  )
  await expect
    .poll(async () =>
      app.evaluate(async ({ webContents }, url) => {
        const w = webContents.getAllWebContents().find((w) => w.getURL() === url)!
        return !w.isDestroyed()
      }, url),
    )
    .toBe(true)
  // Give the bounded capture stream one frame before deliberately crashing this disposable renderer.
  await expect
    .poll(async () =>
      page.evaluate(() =>
        Boolean(document.querySelector('img[alt="웹 송출 미리보기 (지연 가능)"]')),
      ),
    )
    .toBe(true)
  await app.evaluate(
    ({ webContents }, url) =>
      webContents
        .getAllWebContents()
        .find((w) => w.getURL() === url)!
        .forcefullyCrashRenderer(),
    url,
  )
  await expect
    .poll(async () => {
      const status = await page.evaluate(() => window.ipcRenderer.getExternalOutput())
      return status.source.kind === 'web' && !!status.source.frozenFrame
    })
    .toBe(true)
  await page.evaluate(() => window.ipcRenderer.returnToSlides())
  expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind).toBe(
    'slides',
  )
})

test('normal quit disposes the prepared browser even after the control window closes', async () => {
  const r = (
    await page.evaluate(
      async (url) =>
        window.ipcRenderer.manageOutputResource({ action: 'create-web', name: 'quit', url }),
      url,
    )
  )[0]
  await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision }),
    r,
  )
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('control-panel'))!
      .close(),
  )
  await expect.poll(() => app.windows().some((w) => w.url().includes('control-panel'))).toBe(false)
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app }) => {
    setTimeout(() => app.quit(), 0)
  })
  await closed
})

test('slide execution and automatic web detachment never reveal or focus the preparation window', async () => {
  await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
  await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
  await page.evaluate(() => window.ipcRenderer.toggleOutput())
  const r = (
    await page.evaluate(
      async (url) =>
        window.ipcRenderer.manageOutputResource({ action: 'create-web', name: 'focus', url }),
      url,
    )
  )[0]
  const prepared = await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision }),
    r,
  )
  const id = await app.evaluate(({ BrowserWindow, webContents }, url) => {
    const prep = BrowserWindow.getAllWindows().find((w) =>
      w.getTitle().includes('웹 준비'),
    )! as Electron.BrowserWindow & { showCalls: number }
    prep.showCalls = 0
    // Observe the native show path without putting a test window over the operator's desktop.
    prep.show = () => {
      prep.showCalls++
    }
    process.env.PROPRE_TEST_HEADLESS = '0'
    return webContents.getAllWebContents().find((w) => w.getURL() === url)!.id
  }, url)
  await page.getByTestId('slide-card').first().click()
  await page.getByTestId('slide-card').last().click()
  await page.getByTestId('slide-card').first().click()
  const fresh = await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision }),
    r,
  )
  await page.evaluate(
    async (p) => window.ipcRenderer.commitOutputResource(p.token, p.generation),
    fresh,
  )
  await page.getByTestId('slide-card').last().click()
  const state = await page.evaluate(() => window.ipcRenderer.getExternalOutput())
  expect(state.source.kind).toBe('slides')
  expect(state.browser?.live).toBe(false)
  expect(
    await app.evaluate(
      ({ BrowserWindow, webContents }, url) => ({
        calls: (
          BrowserWindow.getAllWindows().find((w) =>
            w.getTitle().includes('웹 준비'),
          )! as Electron.BrowserWindow & { showCalls: number }
        ).showCalls,
        id: webContents.getAllWebContents().find((w) => w.getURL() === url)!.id,
      }),
      url,
    ),
  ).toEqual({ calls: 0, id })
  await page.evaluate(
    async (generation) => window.ipcRenderer.browserOutputCommand({ action: 'show', generation }),
    state.generation,
  )
  expect(
    await app.evaluate(
      ({ BrowserWindow }) =>
        (
          BrowserWindow.getAllWindows().find((w) =>
            w.getTitle().includes('웹 준비'),
          )! as Electron.BrowserWindow & { showCalls: number }
        ).showCalls,
    ),
  ).toBe(1)
  expect(prepared.generation).toBeLessThan(state.generation)
})

test('live PDF paging keeps its committed rotation and the independent prepared-page selection', async () => {
  await addPDF()
  await page.reload()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  await resourceTab()
  await page.getByRole('button', { name: 'PDF · fixture.pdf', exact: true }).click()
  await page.getByRole('button', { name: '화면 준비', exact: true }).click()
  await page.getByRole('button', { name: '준비 화면 송출', exact: true }).click()
  await page.getByRole('button', { name: '회전 0°', exact: true }).click()
  await expect(page.getByRole('button', { name: '준비 화면 송출', exact: true })).toBeEnabled()
  const preparedFrame = await page.getByAltText('준비 PDF 1페이지').getAttribute('src')
  await page.getByRole('button', { name: '송출 다음', exact: true }).click()
  await expect
    .poll(async () => (await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source)
    .toMatchObject({ kind: 'pdf', page: 2, rotation: 0 })
  await expect(page.getByLabel('준비 PDF 페이지', { exact: true })).toHaveValue('1')
  await expect(page.getByAltText('준비 PDF 1페이지')).toHaveAttribute('src', preparedFrame!)
  await expect(page.getByRole('button', { name: '회전 90°', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '준비 화면 송출', exact: true })).toBeDisabled()
  const r = (await page.evaluate(() => window.ipcRenderer.listOutputResources()))[0]
  if (r.kind !== 'pdf') throw new Error('fixture')
  const [thumb] = await page.evaluate(
    async (r) =>
      window.ipcRenderer.pdfOutputThumbnails({
        id: r.id,
        revision: r.revision,
        start: 1,
        rotation: 90,
      }),
    r,
  )
  const size = await page.evaluate(async (url) => {
    const img = new Image()
    img.src = url
    await img.decode()
    return { w: img.naturalWidth, h: img.naturalHeight }
  }, thumb.url)
  expect(size.w).toBeGreaterThan(size.h)
})

test('full stop during native web attachment prevents a late source replacement or empty preparation window', async () => {
  const r = (
    await page.evaluate(
      async (url) =>
        window.ipcRenderer.manageOutputResource({ action: 'create-web', name: 'cancel', url }),
      url,
    )
  )[0]
  const p = await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision }),
    r,
  )
  await app.evaluate(({ webContents }, url) => {
    const w = webContents.getAllWebContents().find((w) => w.getURL() === url)!
    const capture = w.capturePage.bind(w)
    w.capturePage = async (...args) => {
      const image = await capture(...args)
      await new Promise((resolve) => setTimeout(resolve, 400))
      return image
    }
  }, url)
  const result = page.evaluate(
    async (p) =>
      window.ipcRenderer.commitOutputResource(p.token, p.generation).then(
        () => false,
        () => true,
      ),
    p,
  )
  await expect
    .poll(
      async () => (await page.evaluate(() => window.ipcRenderer.getExternalOutput())).browser?.live,
    )
    .toBe(true)
  await page.evaluate(() => window.ipcRenderer.stopExternalOutput())
  expect(await result).toBe(true)
  expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind).toBe(
    'slides',
  )
  expect(
    await app.evaluate(
      ({ BrowserWindow, webContents }, url) => ({
        prep: BrowserWindow.getAllWindows().some((w) => w.getTitle().includes('웹 준비')),
        browser: webContents.getAllWebContents().some((w) => w.getURL() === url),
      }),
      url,
    ),
  ).toEqual({ prep: false, browser: false })
  await expect.poll(() => app.windows().some((w) => w.url().includes('output-display'))).toBe(true)
  const output = app.windows().find((w) => w.url().includes('output-display'))!
  await expect(output.locator('[data-output-source="web"]')).toHaveCount(0)
})

test('the control preparation panel can close and toggle without changing the current browser output', async () => {
  const [r] = await page.evaluate(
    async (url) =>
      window.ipcRenderer.manageOutputResource({ action: 'create-web', name: 'panel', url }),
    url,
  )
  await page.reload()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  await resourceTab()
  const card = page.getByRole('button', { name: '웹 · panel', exact: true })
  await card.click()
  await expect(page.getByTestId('output-resource-preparation')).toBeVisible()
  await card.click()
  await expect(page.getByTestId('output-resource-preparation')).toHaveCount(0)
  await card.click()
  await page.getByRole('button', { name: '화면 준비', exact: true }).click()
  await expect(page.getByRole('button', { name: '준비 화면 송출', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '준비 화면 송출', exact: true }).click()
  await expect
    .poll(
      async () => (await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind,
    )
    .toBe('web')
  const before = await page.evaluate(() => window.ipcRenderer.getExternalOutput())
  await page.getByRole('button', { name: '준비 패널 닫기', exact: true }).click()
  await expect(page.getByTestId('output-resource-preparation')).toHaveCount(0)
  expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source).toEqual(
    before.source,
  )
  await expect(page.getByText('현재 송출: panel · 웹', { exact: true })).toBeVisible()
  const id = await app.evaluate(
    ({ webContents }, url) => webContents.getAllWebContents().find((w) => w.getURL() === url)!.id,
    url,
  )
  await page.getByRole('button', { name: '웹 · panel · 송출 중', exact: true }).click()
  expect(
    await app.evaluate(
      ({ webContents }, url) => webContents.getAllWebContents().find((w) => w.getURL() === url)!.id,
      url,
    ),
  ).toBe(id)
  expect(r.id).toBe(before.browser?.resourceId)
})

test('resizing the preparation window updates the web viewport, invalidates confirmation and keeps the chosen size', async () => {
  const [r] = await page.evaluate(
    async (url) =>
      window.ipcRenderer.manageOutputResource({ action: 'create-web', name: 'resize', url }),
    url,
  )
  const first = await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision }),
    r,
  )
  await app.evaluate(({ BrowserWindow }) => {
    const prep = BrowserWindow.getAllWindows().find((w) => w.getTitle().includes('웹 준비'))!
    if (!prep.isResizable()) throw new Error('not resizable')
    prep.setContentSize(700, 450)
  })
  await expect
    .poll(async () =>
      app.evaluate(
        async ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .find((w) => w.getURL() === url)!
            .executeJavaScript('({w:innerWidth,h:innerHeight})'),
        url,
      ),
    )
    .toEqual({ w: 700, h: 450 })
  await expect(
    page.evaluate(
      async (p) => window.ipcRenderer.commitOutputResource(p.token, p.generation),
      first,
    ),
  ).rejects.toThrow()
  await page.evaluate(
    async (r) =>
      window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision }),
    r,
  )
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle().includes('웹 준비'))!
        .getContentSize(),
    ),
  ).toEqual([700, 450])
})

test('URL and PDF deletion can be undone by the control button and scoped keyboard shortcut', async () => {
  await addPDF()
  await page.evaluate(
    async (url) =>
      window.ipcRenderer.manageOutputResource({ action: 'create-web', name: 'undo', url }),
    url,
  )
  await page.reload()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  await resourceTab()
  await page.getByRole('button', { name: '웹 · undo', exact: true }).click()
  await page.getByRole('button', { name: '자료 삭제', exact: true }).click()
  await expect(page.getByRole('button', { name: '웹 · undo', exact: true })).toHaveCount(0)
  const undo = page.getByRole('button', { name: '삭제 되돌리기', exact: true })
  await undo.click()
  await expect(page.getByRole('button', { name: '웹 · undo', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'PDF · fixture.pdf', exact: true }).click()
  await page.getByRole('button', { name: '자료 삭제', exact: true }).click()
  await expect(page.getByRole('button', { name: 'PDF · fixture.pdf', exact: true })).toHaveCount(0)
  await undo.focus()
  await undo.press('Control+z')
  await expect(page.getByRole('button', { name: 'PDF · fixture.pdf', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '화면 준비', exact: true }).click()
  await expect(page.getByRole('button', { name: '준비 화면 송출', exact: true })).toBeEnabled()
})

test('transient compositor capture failures recover before web preparation is confirmed', async () => {
  await app.evaluate(({ app }) => {
    app.once('web-contents-created', (_event, contents) => {
      const original = contents.capturePage.bind(contents)
      let failures = 2
      contents.capturePage = async (...args) => {
        if (failures-- > 0) throw new Error('UnknownVizError')
        return original(...args)
      }
    })
  })
  const resource = (
    await page.evaluate(
      (url) =>
        window.ipcRenderer.manageOutputResource({ action: 'create-web', name: 'retry', url }),
      url,
    )
  )[0]
  const prepared = await page.evaluate(
    (r) => window.ipcRenderer.prepareOutputResource({ resourceId: r.id, revision: r.revision }),
    resource,
  )
  expect(prepared.token).toBeTruthy()
  expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind).toBe(
    'slides',
  )
})
