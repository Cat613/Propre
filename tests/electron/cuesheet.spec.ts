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
import { PDFDocument } from 'pdf-lib'
import { Repository } from '../../electron/services/repository'
import { cuesheetPreset } from '../../shared/cuesheet'
let app: ElectronApplication, page: Page, dir: string
const marker = '합성 비공개 메모',
  now = '2026-10-16T00:00:00Z'
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-cuesheet-native-'))
  const repo = new Repository(dir)
  await repo.open()
  await repo.manageSetlist({
    operation: 'create',
    title: '합성 주일예배 · 평안과 소망',
    date: '2026-10-18',
    fromCurrent: false,
    expectedActiveId: null,
    expectedRevision: null,
  })
  const list = repo.state.setlists[0],
    plan = structuredClone(list.servicePlan!)
  plan.items = Array.from({ length: 5 }, (_, index) => ({
    id: 'cue' + index,
    kind: 'prayer' as const,
    title: `합성 기도 ${index + 1} · 한국어 긴 제목과 & 평안`,
    leader: '합성 담당자',
    operatorNote: marker + ' ' + index,
    stageNote: '무대 비공개 초안',
    durationSeconds: 120,
    enter: { visual: 'keep' as const, audio: 'keep' as const },
  }))
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
async function state() {
  return page.evaluate(() => window.ipcRenderer.bootstrap())
}
async function create(options = cuesheetPreset('public')) {
  const workspace = await state(),
    list = workspace.setlists.find((x) => x.id === workspace.activeSetlistId)!
  return page.evaluate((request) => window.ipcRenderer.previewCuesheet(request), {
    requestId: randomUUID(),
    setlistId: list.id,
    revision: list.revision,
    options,
  })
}
async function pdfBytes(url: string) {
  return Buffer.from(
    await page.evaluate(
      async (url) => Array.from(new Uint8Array(await (await fetch(url)).arrayBuffer())),
      url,
    ),
  )
}
test('actual PDF preview, compact UI, safe native save and OS print cancellation preserve live output', async () => {
  const before = await state()
  await page.getByRole('button', { name: '콘티 더 보기', exact: true }).click()
  await page.getByRole('button', { name: '큐시트 인쇄·PDF', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '큐시트 인쇄·PDF' })
  await expect(dialog.getByRole('button', { name: 'PDF 저장', exact: true })).toBeEnabled({
    timeout: 20000,
  })
  const renderer = (await app.windows()).find((win) => win.url().includes('preview.html'))!
  expect(renderer).toBeTruthy()
  const sandbox = await renderer.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    bridge: typeof (window as unknown as { ipcRenderer?: unknown }).ipcRenderer,
    text: document.body.innerText,
  }))
  expect(sandbox.require).toBe('undefined')
  expect(sandbox.bridge).toBe('undefined')
  expect(sandbox.text).not.toContain(marker)
  const file = path.join(dir, 'saved.pdf')
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('preview.html'),
    )!
    win.webContents.print = (options, callback) => {
      ;(globalThis as unknown as { printOptions: unknown }).printOptions = options
      callback?.(false, 'cancelled')
    }
  }, file)
  await dialog.getByRole('button', { name: 'PDF 저장', exact: true }).click()
  await expect(dialog.getByText('PDF 저장 완료', { exact: true })).toBeVisible()
  expect((await PDFDocument.load(await fs.readFile(file))).getPageCount()).toBe(1)
  await dialog.getByRole('button', { name: '인쇄', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((win) =>
      win.webContents.getURL().includes('preview.html'),
    )!.webContents.print = (_options, callback) => callback?.(true, '')
  })
  await dialog.getByRole('button', { name: '인쇄', exact: true }).click()
  await expect(
    dialog.getByText('OS에 인쇄 요청을 전달했습니다. 실제 용지 출력은 프린터에서 확인해주세요.', {
      exact: true,
    }),
  ).toBeVisible()
  expect(
    await app.evaluate(
      () => (globalThis as unknown as { printOptions: { silent: boolean } }).printOptions.silent,
    ),
  ).toBe(false)
  for (const bounds of [
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, bounds) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes('control-panel'))!
          .setBounds(bounds),
      bounds,
    )
    await expect(dialog.getByRole('button', { name: 'PDF 저장', exact: true })).toBeInViewport({
      ratio: 1,
    })
    await page.screenshot({
      path: `/tmp/propre-cuesheet-${bounds.width}.png`,
      animations: 'disabled',
    })
  }
  expect((await state()).live).toEqual(before.live)
  await dialog.getByRole('button', { name: '닫기', exact: true }).click()
  await expect
    .poll(
      async () => (await app.windows()).filter((win) => win.url().includes('preview.html')).length,
    )
    .toBe(0)
  await fs.mkdir('output/pdf', { recursive: true })
  await fs.copyFile(file, 'output/pdf/propre-cuesheet-public-sample.pdf')
})
async function replaceCues(count: number, noteLength = 0) {
  const workspace = await state(),
    list = workspace.setlists.find((x) => x.id === workspace.activeSetlistId)!,
    plan = structuredClone(list.servicePlan!)
  plan.plannedStartAt = '2026-10-16T23:59:00+09:00'
  plan.items = Array.from({ length: count }, (_, index) => ({
    id: 'large-' + index,
    kind: 'prayer' as const,
    title: `${index + 1}번째 합성 한국어 순서 · 평안과 감사`,
    durationSeconds: index === count - 1 ? undefined : 120,
    leader: '합성 담당자',
    operatorNote:
      '한글 긴 메모 · 기도와 감사의 내용을 빠짐없이 확인합니다. '.repeat(100).slice(0, noteLength) +
      (noteLength ? ' 끝표시' + index : ''),
    stageNote: '별도로 선택한 무대 안내 초안 · '.repeat(150).slice(0, noteLength || 24),
    enter: { visual: 'keep' as const, audio: 'keep' as const },
  }))
  // Keep max note within the stored contract, including its unique end marker.
  for (const cue of plan.items) cue.operatorNote = cue.operatorNote.slice(0, 2000)
  await page.evaluate((request) => window.ipcRenderer.saveServicePlan(request), {
    requestId: randomUUID(),
    setlistId: list.id,
    expectedSetlistRevision: list.revision,
    plan,
  })
}
test('long Korean notes paginate without clipping, frozen stale output requires confirmation and print submission is precise', async () => {
  await replaceCues(12, 1900)
  const job = await create({
    ...cuesheetPreset('operator'),
    stageNote: true,
    times: true,
    size: 'large',
  })
  expect(job.pages).toBeGreaterThan(4)
  const bytes = await pdfBytes(job.url),
    pdf = await PDFDocument.load(bytes)
  expect(pdf.getPageCount()).toBe(job.pages)
  const renderer = (await app.windows()).find((win) => win.url().includes('preview.html'))!
  const layout = await renderer.evaluate(() => ({
    pages: [...document.querySelectorAll('.page')].map((sheet) => ({
      header: sheet.querySelector('h1')!.textContent,
      overflow:
        sheet.querySelector('table')!.getBoundingClientRect().bottom >
        sheet.querySelector('.content')!.getBoundingClientRect().bottom,
    })),
    text: document.body.innerText,
  }))
  expect(
    layout.pages.every((sheet) => !sheet.overflow && sheet.header?.includes('합성 주일예배')),
  ).toBe(true)
  expect(layout.text).toContain('끝표시11')
  expect(layout.text).toContain('(계속)')
  expect(layout.text).toContain('+1일')
  await fs.writeFile('/tmp/propre-cuesheet-long-portrait.pdf', bytes)
  await replaceCues(3)
  expect(
    await page.evaluate((id) => window.ipcRenderer.getCuesheetStatus(id), job.id),
  ).toMatchObject({ stale: true })
  const file = path.join(dir, 'frozen.pdf')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    dialog.showMessageBox = async (_window, options) => {
      ;(globalThis as unknown as { confirmOptions: unknown }).confirmOptions = options
      return { response: 0, checkboxChecked: false }
    }
  }, file)
  expect(await page.evaluate((id) => window.ipcRenderer.saveCuesheet(id), job.id)).toMatchObject({
    canceled: true,
  })
  await expect(fs.stat(file)).rejects.toThrow()
  expect(
    await app.evaluate(
      () =>
        (globalThis as unknown as { confirmOptions: { defaultId: number } }).confirmOptions
          .defaultId,
    ),
  ).toBe(0)
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })
  expect(await page.evaluate((id) => window.ipcRenderer.saveCuesheet(id), job.id)).toMatchObject({
    success: true,
  })
  expect(await fs.readFile(file)).toEqual(bytes)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('preview.html'),
    )!.webContents.print = (options, callback) => {
      ;(globalThis as unknown as { printOptions: unknown }).printOptions = options
      callback?.(true, '')
    }
  })
  expect(await page.evaluate((id) => window.ipcRenderer.printCuesheet(id), job.id)).toMatchObject({
    success: true,
  })
  expect(
    await app.evaluate(
      () =>
        (globalThis as unknown as { printOptions: { silent: boolean; landscape: boolean } })
          .printOptions,
    ),
  ).toMatchObject({ silent: false, landscape: false })
  const landscape = await create({
    ...cuesheetPreset('operator'),
    orientation: 'landscape',
    size: 'large',
  })
  const landscapePDF = await PDFDocument.load(await pdfBytes(landscape.url))
  expect(landscapePDF.getPages()[0].getWidth()).toBeGreaterThan(
    landscapePDF.getPages()[0].getHeight(),
  )
  await fs.writeFile('/tmp/propre-cuesheet-landscape.pdf', await pdfBytes(landscape.url))
})
test('rapid replacement, early close, save cancellation/failure and hostile text do not leak jobs or mutate output', async () => {
  const before = await state()
  const workspace = await state(),
    list = workspace.setlists.find((x) => x.id === workspace.activeSetlistId)!,
    plan = structuredClone(list.servicePlan!)
  plan.items[0].title = '<img src="https://example.invalid/secret" onerror="window.hacked=true">'
  await page.evaluate((request) => window.ipcRenderer.saveServicePlan(request), {
    requestId: randomUUID(),
    setlistId: list.id,
    expectedSetlistRevision: list.revision,
    plan,
  })
  const job = await create(),
    renderer = (await app.windows()).find((win) => win.url().includes('preview.html'))!
  expect(
    await renderer.evaluate(() => ({
      images: document.images.length,
      hacked: (window as unknown as { hacked?: boolean }).hacked,
      text: document.body.innerText,
    })),
  ).toMatchObject({ images: 0, hacked: undefined })
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined })
  })
  expect(await page.evaluate((id) => window.ipcRenderer.saveCuesheet(id), job.id)).toMatchObject({
    canceled: true,
  })
  await app.evaluate(({ dialog }, dir) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: dir })
  }, dir)
  await expect(page.evaluate((id) => window.ipcRenderer.saveCuesheet(id), job.id)).rejects.toThrow()
  const newer = await create({ ...cuesheetPreset('public'), orientation: 'landscape' })
  await expect(
    page.evaluate((id) => window.ipcRenderer.getCuesheetStatus(id), job.id),
  ).rejects.toThrow('만료')
  await page.evaluate((id) => window.ipcRenderer.closeCuesheet(id), job.id)
  expect(
    await page.evaluate((id) => window.ipcRenderer.getCuesheetStatus(id), newer.id),
  ).toMatchObject({ id: newer.id })
  const current = await state(),
    latest = current.setlists.find((x) => x.id === current.activeSetlistId)!,
    id = randomUUID()
  const closed = await page.evaluate(
    async (request) => {
      const pending = window.ipcRenderer.previewCuesheet(request).then(
        () => false,
        () => true,
      )
      await window.ipcRenderer.closeCuesheet(request.requestId)
      return pending
    },
    {
      requestId: id,
      setlistId: latest.id,
      revision: latest.revision,
      options: cuesheetPreset('public'),
    },
  )
  expect(closed).toBe(true)
  await expect
    .poll(
      async () => (await app.windows()).filter((win) => win.url().includes('preview.html')).length,
    )
    .toBe(0)
  const root = path.join(
    os.tmpdir(),
    'propre-cuesheets-' +
      (await import('node:crypto')).createHash('sha256').update(dir).digest('hex').slice(0, 16),
  )
  await expect.poll(async () => await fs.readdir(root)).toEqual([])
  const nextState = await state(),
    nextList = nextState.setlists.find((x) => x.id === nextState.activeSetlistId)!
  const parallel = await page.evaluate(
    async (payload) =>
      Promise.allSettled(
        payload.map((request) => window.ipcRenderer.previewCuesheet(request)),
      ).then((results) => results.map((result) => result.status)),
    [
      {
        requestId: randomUUID(),
        setlistId: nextList.id,
        revision: nextList.revision,
        options: cuesheetPreset('operator'),
      },
      {
        requestId: randomUUID(),
        setlistId: nextList.id,
        revision: nextList.revision,
        options: cuesheetPreset('public'),
      },
    ],
  )
  expect(parallel).toEqual(['rejected', 'fulfilled'])
  expect((await state()).live).toEqual(before.live)
})
test('1000 cues with maximum stored notes stay responsive, paginated and bounded', async () => {
  test.setTimeout(90000)
  await replaceCues(1000, 2000)
  const start = Date.now(),
    job = await create({ ...cuesheetPreset('operator'), stageNote: true })
  const elapsed = Date.now() - start
  expect(elapsed).toBeLessThan(30000)
  expect(job.pages).toBeGreaterThan(100)
  const bytes = await pdfBytes(job.url)
  expect(bytes.length).toBeLessThan(200 * 1024 * 1024)
  const renderer = (await app.windows()).find((win) => win.url().includes('preview.html'))!
  const layout = await renderer.evaluate(() => ({
    rows: document.querySelectorAll('[data-primary]').length,
    tail: document.body.innerText.includes('1000번째'),
    headers: document.querySelectorAll('thead').length,
  }))
  expect(layout.tail).toBe(true)
  expect(layout.headers).toBe(job.pages)
  const memory = await app.evaluate(async ({ app, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('preview.html'),
    )!
    return app.getAppMetrics().find((metric) => metric.pid === win.webContents.getOSProcessId())
      ?.memory
  })
  await fs.writeFile(
    '/tmp/propre-cuesheet-1000-metrics.json',
    JSON.stringify({ elapsed, pages: job.pages, bytes: bytes.length, memory }, null, 2),
  )
  await fs.writeFile('/tmp/propre-cuesheet-1000.pdf', bytes)
})
test('font failure, empty services, sandbox navigation and output-role authority fail safely and can retry', async () => {
  await app.evaluate(({ app }) => {
    app.once('browser-window-created', (_event, win) => {
      win.webContents.once('dom-ready', () => {
        void win.webContents.executeJavaScript('document.fonts.check = () => false')
      })
    })
  })
  await expect(create()).rejects.toThrow('한글 글꼴')
  await expect
    .poll(
      async () => (await app.windows()).filter((win) => win.url().includes('preview.html')).length,
    )
    .toBe(0)
  await replaceCues(0)
  const empty = await create()
  expect(empty.pages).toBe(1)
  const renderer = (await app.windows()).find((win) => win.url().includes('preview.html'))!
  const originalURL = renderer.url()
  const blocked = await renderer.evaluate(async () => {
    const results = await Promise.all(
      ['https://example.invalid/secret', 'file:///etc/hosts'].map((url) =>
        fetch(url).then(
          () => false,
          () => true,
        ),
      ),
    )
    const link = document.createElement('a')
    link.href = 'file:///etc/hosts'
    document.body.append(link)
    link.click()
    return results
  })
  expect(blocked).toEqual([true, true])
  expect(renderer.url()).toBe(originalURL)
  await page.evaluate(() => window.ipcRenderer.toggleStage())
  await expect
    .poll(async () => (await app.windows()).some((win) => win.url().includes('stage-display')))
    .toBe(true)
  const stage = (await app.windows()).find((win) => win.url().includes('stage-display'))!
  await expect(
    stage.evaluate((id) => window.ipcRenderer.getCuesheetStatus(id), empty.id),
  ).rejects.toThrow()
  await expect(
    stage.evaluate((id) => window.ipcRenderer.saveCuesheet(id), empty.id),
  ).rejects.toThrow()
  await page.evaluate((id) => window.ipcRenderer.closeCuesheet(id), empty.id)
})
test('generation memory guard cancels its renderer and removes temporary files before a clean retry', async () => {
  await app.evaluate(({ app }) => {
    const original = app.getAppMetrics.bind(app)
    ;(globalThis as unknown as { restoreMetrics: () => void }).restoreMetrics = () => {
      app.getAppMetrics = original
    }
    app.getAppMetrics = () =>
      original().map((metric) => ({
        ...metric,
        memory: { ...metric.memory, workingSetSize: 2 * 1024 * 1024 + 1 },
      }))
    app.once('browser-window-created', (_event, win) => {
      const original = win.webContents.printToPDF.bind(win.webContents)
      win.webContents.printToPDF = async (options) => {
        await new Promise((resolve) => setTimeout(resolve, 700))
        return original(options)
      }
    })
  })
  await expect(create()).rejects.toThrow('메모리 한도')
  await expect
    .poll(
      async () => (await app.windows()).filter((win) => win.url().includes('preview.html')).length,
    )
    .toBe(0)
  await app.evaluate(() =>
    (globalThis as unknown as { restoreMetrics: () => void }).restoreMetrics(),
  )
  const job = await create()
  expect(job.pages).toBe(1)
  await page.evaluate((id) => window.ipcRenderer.closeCuesheet(id), job.id)
})
test('normal app quit clears private preview files while preserving an explicitly saved PDF', async () => {
  const job = await create(cuesheetPreset('operator')),
    file = path.join(dir, 'keep.pdf')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, file)
  expect(await page.evaluate((id) => window.ipcRenderer.saveCuesheet(id), job.id)).toMatchObject({
    success: true,
  })
  const root = path.join(
    os.tmpdir(),
    'propre-cuesheets-' +
      (await import('node:crypto')).createHash('sha256').update(dir).digest('hex').slice(0, 16),
  )
  expect(await fs.readdir(root)).toEqual([job.id])
  const closed = app.waitForEvent('close')
  await app.evaluate(({ app }) => app.quit())
  await closed
  expect(await fs.readdir(root)).toEqual([])
  expect((await PDFDocument.load(await fs.readFile(file))).getPageCount()).toBe(1)
})
test('unavailable temporary export storage does not block app startup and becomes usable after repair', async () => {
  const root = path.join(
    os.tmpdir(),
    'propre-cuesheets-' +
      (await import('node:crypto')).createHash('sha256').update(dir).digest('hex').slice(0, 16),
  )
  await app.evaluate(({ app }) => app.exit(0))
  await app.close().catch(() => {})
  await fs.rm(root, { recursive: true, force: true })
  await fs.writeFile(root, 'synthetic unavailable temp directory')
  try {
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
    await expect(create()).rejects.toThrow('임시 저장')
    await fs.rm(root, { force: true })
    const recovered = await create()
    expect(recovered.pages).toBe(1)
    await page.evaluate((id) => window.ipcRenderer.closeCuesheet(id), recovered.id)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
