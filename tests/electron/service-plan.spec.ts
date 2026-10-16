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
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-service-native-'))
  const repo = new Repository(dir)
  await repo.open()
  const now = '2026-10-16T00:00:00.000Z'
  await repo.saveDraft({
    id: 'song',
    title: '합성 찬양',
    slides: [{ id: 'slide', type: 'text', content: '합성 가사' }],
    createdAt: now,
    updatedAt: now,
    revision: 1,
  })
  await repo.setPlaylist([{ id: 'row', presentationId: 'song' }])
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
  await expect
    .poll(() => app.windows().some((win) => win.url().includes('control-panel')))
    .toBe(true)
  page = app.windows().find((win) => win.url().includes('control-panel'))!
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
})
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
})
test('Control saves a plan while the current output remains unchanged and stale edits are rejected', async () => {
  const result = await page.evaluate(async () => {
    const before = await window.ipcRenderer.bootstrap()
    const list = before.setlists.find((x) => x.id === before.activeSetlistId)!
    const plan = structuredClone(list.servicePlan!)
    plan.items.push({
      id: 'prayer',
      kind: 'prayer',
      title: '대표기도',
      operatorNote: '청중 비공개 합성 메모',
      enter: { visual: 'keep', audio: 'keep' },
    })
    const command = {
      requestId: crypto.randomUUID(),
      setlistId: list.id,
      expectedSetlistRevision: list.revision,
      plan,
    }
    const saved = await window.ipcRenderer.saveServicePlan(command)
    let staleRejected = false
    try {
      await window.ipcRenderer.saveServicePlan({ ...command, requestId: crypto.randomUUID() })
    } catch {
      staleRejected = true
    }
    const after = await window.ipcRenderer.bootstrap()
    return {
      items: saved.setlists[0].servicePlan?.items.length,
      staleRejected,
      beforeLive: before.live,
      afterLive: after.live,
      sourceBefore: before.externalOutput.source,
      sourceAfter: after.externalOutput.source,
    }
  })
  expect(result.items).toBe(2)
  expect(result.staleRejected).toBe(true)
  expect(result.afterLive).toEqual(result.beforeLive)
  expect(result.sourceAfter).toEqual(result.sourceBefore)
  const disk = JSON.parse(await fs.readFile(path.join(dir, 'workspace-v4.json'), 'utf8'))
  expect(disk.setlists[0].servicePlan.items[1].operatorNote).toBe('청중 비공개 합성 메모')
})
test('Main and Stage cannot invoke the plan mutation API', async () => {
  await page.evaluate(async () => {
    await window.ipcRenderer.toggleOutput()
    await window.ipcRenderer.toggleStage()
  })
  await expect.poll(() => app.windows().length).toBe(3)
  for (const win of app.windows().filter((win) => win !== page)) {
    const result = await win.evaluate(async () => {
      const api = window.ipcRenderer
      if (typeof api.saveServicePlan !== 'function') return 'not-exposed'
      try {
        await api.saveServicePlan({
          requestId: crypto.randomUUID(),
          setlistId: 'forbidden',
          expectedSetlistRevision: 0,
          plan: { version: 1, timezone: 'Asia/Seoul', items: [] },
        })
        return 'allowed'
      } catch {
        return 'denied'
      }
    })
    expect(['not-exposed', 'denied']).toContain(result)
  }
})
test('the simple full-order UI adds a private note, prepares explicitly, advances and supports Undo at compact sizes', async () => {
  await page.getByRole('button', { name: '전체 순서', exact: true }).click()
  await page.getByRole('button', { name: '순서 추가', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '예배 순서 추가' })
  await dialog
    .getByRole('textbox', { name: '순서 제목', exact: true })
    .fill('대표기도와 다음 봉독 준비')
  await dialog.getByRole('spinbutton', { name: '예상 시간 분' }).fill('3')
  await dialog.getByText('담당자·메모·화면 설정', { exact: true }).click()
  await dialog
    .getByRole('textbox', { name: '운영 메모', exact: true })
    .fill('청중에게 표시하지 않는 합성 진행 메모')
  await dialog.getByRole('button', { name: '순서 추가', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: '2. 대표기도와 다음 봉독 준비' })).toBeVisible()
  // A newly inserted cue is placed after the selected cue, or at the end if none was selected.
  const prayer = page.getByRole('button', { name: /대표기도와 다음 봉독 준비/ }).first()
  await prayer.click()
  await page.evaluate(async () => {
    await window.ipcRenderer.toggleOutput()
    await window.ipcRenderer.toggleStage()
  })
  const before = await page.evaluate(() => window.ipcRenderer.bootstrap())
  await page.getByRole('button', { name: '1. 합성 찬양', exact: true }).click()
  const selected = await page.evaluate(() => window.ipcRenderer.bootstrap())
  expect(selected.live).toEqual(before.live)
  await page.getByRole('button', { name: '준비 확인', exact: true }).click()
  await expect(page.getByRole('button', { name: '이 순서 진행', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '이 순서 진행', exact: true }).click()
  await expect
    .poll(async () => ({
      session:
        (await page.evaluate(() => window.ipcRenderer.bootstrap())).serviceSession?.currentCueId ||
        null,
      errors: await page.getByRole('alert').allTextContents(),
    }))
    .toEqual({ session: before.setlists[0].servicePlan!.items[0].id, errors: [] })
  const live = await page.evaluate(() => window.ipcRenderer.bootstrap())
  expect(live.live?.layers.slide?.content).toBe('합성 가사')
  expect(JSON.stringify(live.live)).not.toContain('청중에게 표시하지 않는')
  await prayer.click()
  expect((await page.evaluate(() => window.ipcRenderer.bootstrap())).live).toEqual(live.live)
  await page.getByRole('button', { name: '순서 위로', exact: true }).click()
  await expect(page.getByRole('button', { name: '1. 대표기도와 다음 봉독 준비' })).toBeVisible()
  await page.getByRole('button', { name: '순서 편집 되돌리기', exact: true }).click()
  await expect(page.getByRole('button', { name: '1. 합성 찬양', exact: true })).toBeVisible()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL().includes('control-panel'))!
      .setBounds({ width: 1024, height: 768 }),
  )
  await expect(page.getByRole('button', { name: '준비 확인', exact: true })).toBeInViewport({
    ratio: 1,
  })
  await expect(page.getByRole('button', { name: '이 순서 진행', exact: true })).toBeInViewport({
    ratio: 1,
  })
  await page.screenshot({ path: '/tmp/propre-worship-p1-compact.png' })
  for (const size of [
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, bounds) =>
        BrowserWindow.getAllWindows()
          .find((win) => win.webContents.getURL().includes('control-panel'))!
          .setBounds(bounds),
      size,
    )
    await expect(page.getByRole('button', { name: '이 순서 진행', exact: true })).toBeInViewport({
      ratio: 1,
    })
    await page.screenshot({ path: `/tmp/propre-worship-p1-${size.width}.png` })
  }
  await page.getByRole('button', { name: '예배 마치기', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.ipcRenderer.bootstrap())).serviceSession?.status,
    )
    .toBe('finished')
})

test('whole-service file buttons include notes, cancel safely and import an independent service without changing output', async () => {
  await page.evaluate(async () => {
    const state = await window.ipcRenderer.bootstrap(),
      list = state.setlists[0],
      plan = structuredClone(list.servicePlan!)
    plan.items.push({
      id: 'private',
      kind: 'prayer',
      title: '파일 기도',
      operatorNote: '파일에 보존할 비공개 메모',
      enter: { visual: 'keep', audio: 'keep' },
    })
    await window.ipcRenderer.saveServicePlan({
      requestId: crypto.randomUUID(),
      setlistId: list.id,
      expectedSetlistRevision: list.revision,
      plan,
    })
  })
  await page.reload()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  const file = path.join(dir, 'service.ppros')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  }, file)
  await page.getByRole('button', { name: '콘티 더 보기', exact: true }).click()
  await page.getByRole('button', { name: '예배 전체로 저장', exact: true }).click()
  await expect
    .poll(async () =>
      fs
        .readFile(file, 'utf8')
        .then((data) => JSON.parse(data).kind)
        .catch(() => ''),
    )
    .toBe('service')
  const before = await page.evaluate(() => window.ipcRenderer.bootstrap())
  await page.getByRole('button', { name: '콘티 더 보기', exact: true }).click()
  await page.getByRole('button', { name: '예배 파일 불러오기', exact: true }).click()
  expect((await page.evaluate(() => window.ipcRenderer.bootstrap())).setlists).toEqual(
    before.setlists,
  )
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })
  await page.getByRole('button', { name: '콘티 더 보기', exact: true }).click()
  await page.getByRole('button', { name: '예배 파일 불러오기', exact: true }).click()
  await expect(page.getByRole('button', { name: '2. 파일 기도', exact: true })).toBeVisible()
  const after = await page.evaluate(() => window.ipcRenderer.bootstrap())
  expect(after.setlists).toHaveLength(before.setlists.length + 1)
  expect(after.activeSetlistId).not.toBe(before.activeSetlistId)
  expect(after.draft).toEqual(before.draft)
  expect(after.live).toEqual(before.live)
  expect(after.externalOutput.source).toEqual(before.externalOutput.source)
})

test('owned PDF/web cues prepare without output, switch to slides, stop via native F2 and resume only explicitly', async () => {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.addPage([180, 240])
  doc.addPage([240, 180])
  const file = path.join(dir, 'cue.pdf')
  await fs.writeFile(file, await doc.save())
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  const pdf = (await page.evaluate(() => window.ipcRenderer.selectOutputPDFs())).resources.find(
    (r) => r.kind === 'pdf',
  )!
  const { createServer } = await import('node:http')
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end('<body>synthetic cue web</body>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  try {
    const web = (
      await page.evaluate(
        (url) =>
          window.ipcRenderer.manageOutputResource({ action: 'create-web', name: '큐 웹', url }),
        url,
      )
    ).find((r) => r.kind === 'web')!
    await page.evaluate(
      async ({ pdfId, webId }) => {
        for (const [id, resourceId] of [
          ['cue-pdf', pdfId],
          ['cue-web', webId],
        ]) {
          const state = await window.ipcRenderer.bootstrap(),
            list = state.setlists[0],
            plan = structuredClone(list.servicePlan!)
          plan.items.push({
            id,
            kind: 'sermon',
            title: id,
            binding: {
              kind: 'resource',
              resourceId,
              ...(id === 'cue-pdf' ? { page: 2, rotation: 90 as const } : {}),
            },
            enter: { visual: 'bound', audio: 'keep' },
          })
          await window.ipcRenderer.attachServiceCue({
            requestId: crypto.randomUUID(),
            setlistId: list.id,
            expectedSetlistRevision: list.revision,
            cueId: id,
            plan,
            source: {
              kind: 'resource',
              id: resourceId,
              ...(id === 'cue-pdf' ? { page: 2, rotation: 90 as const } : {}),
            },
          })
        }
        await window.ipcRenderer.toggleStage()
      },
      { pdfId: pdf.id, webId: web.id },
    )
    const prepare = (cueId: string) =>
      page.evaluate(async (cueId) => {
        const state = await window.ipcRenderer.bootstrap(),
          list = state.setlists[0]
        return window.ipcRenderer.prepareServiceCue({
          setlistId: list.id,
          expectedSetlistRevision: list.revision,
          cueId,
        })
      }, cueId)
    const commit = (token: string) =>
      page.evaluate((token) => window.ipcRenderer.commitServiceCue(token), token)
    const p = await prepare('cue-pdf')
    expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind).toBe(
      'slides',
    )
    await commit(p.token)
    const livePDF = (await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source
    expect(livePDF).toMatchObject({ kind: 'pdf', page: 2, rotation: 90 })
    const stage = app.windows().find((w) => w.url().includes('stage-display'))!
    await expect(stage.getByAltText('현재 PDF 페이지')).toBeVisible()
    const w = await prepare('cue-web')
    expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind).toBe(
      'pdf',
    )
    await commit(w.token)
    expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind).toBe(
      'web',
    )
    const state = await page.evaluate(() => window.ipcRenderer.bootstrap()),
      songId = state.setlists[0].servicePlan!.items[0].id
    await commit((await prepare(songId)).token)
    expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind).toBe(
      'slides',
    )
    expect(
      (await page.evaluate(() => window.ipcRenderer.bootstrap())).live?.layers.slide?.content,
    ).toBe('합성 가사')
    const stale = await prepare('cue-web')
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().includes('control-panel'))!
        .webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F2' }),
    )
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.ipcRenderer.bootstrap())).serviceSession?.status,
      )
      .toBe('interrupted')
    await expect(commit(stale.token)).rejects.toThrow('다시 준비')
    await expect
      .poll(
        async () =>
          JSON.parse(await fs.readFile(path.join(dir, 'service-session-v1.json'), 'utf8')).status,
      )
      .toBe('interrupted')
    await app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows())
        if (!win.webContents.getURL().includes('control-panel')) win.close()
    })
    await page.reload()
    await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().includes('control-panel'))!
        .webContents.send('app-update-changed', {
          revision: 999,
          status: 'available',
          currentVersion: '0.1.0',
          version: '0.2.0',
        }),
    )
    await page.getByRole('button', { name: 'v0.2.0 다운로드' }).click()
    await expect(page.getByRole('dialog').getByText(/예배와 송출을 모두 마친/)).toBeVisible()
    await expect(page.getByRole('button', { name: '재시작하여 업데이트' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    expect((await page.evaluate(() => window.ipcRenderer.getExternalOutput())).source.kind).toBe(
      'slides',
    )
    await commit((await prepare('cue-pdf')).token)
    expect((await page.evaluate(() => window.ipcRenderer.bootstrap())).serviceSession?.status).toBe(
      'running',
    )
    await page.evaluate(() => window.ipcRenderer.finishService())
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('cue edits retain input on concurrent changes and support keyboard order and focus restoration', async () => {
  await page.getByRole('button', { name: '전체 순서', exact: true }).click()
  const first = page.getByRole('button', { name: '1. 합성 찬양', exact: true })
  await first.click()
  await page.getByRole('button', { name: '선택한 순서 편집', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '예배 순서 편집' })
  await dialog.getByLabel('순서 제목', { exact: true }).fill('입력을 유지할 긴 찬양 제목')
  await page.evaluate(async () => {
    const state = await window.ipcRenderer.bootstrap(),
      list = state.setlists[0],
      plan = structuredClone(list.servicePlan!)
    plan.items.push({
      id: 'concurrent',
      kind: 'prayer',
      title: '병행 작업 기도',
      enter: { visual: 'keep', audio: 'keep' },
    })
    await window.ipcRenderer.saveServicePlan({
      requestId: crypto.randomUUID(),
      setlistId: list.id,
      expectedSetlistRevision: list.revision,
      plan,
    })
  })
  await dialog.getByRole('button', { name: '변경 저장', exact: true }).click()
  await expect(dialog.getByLabel('순서 제목', { exact: true })).toHaveValue(
    '입력을 유지할 긴 찬양 제목',
  )
  await expect(dialog.getByRole('alert')).toBeVisible()
  await dialog.getByRole('button', { name: /최신.*적용|최신.*확인|입력.*적용/ }).click()
  await dialog.getByRole('button', { name: '변경 저장', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const changed = page.getByRole('button', { name: '1. 입력을 유지할 긴 찬양 제목', exact: true })
  await expect(changed).toBeFocused()
  await changed.press('Alt+ArrowDown')
  const moved = page.getByRole('button', { name: '2. 입력을 유지할 긴 찬양 제목', exact: true })
  await expect(moved).toBeVisible()
  await moved.press('ArrowUp')
  await expect(page.getByRole('button', { name: '1. 병행 작업 기도', exact: true })).toBeFocused()
  expect((await page.evaluate(() => window.ipcRenderer.bootstrap())).serviceSession).toBeNull()
})
