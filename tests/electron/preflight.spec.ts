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
let app: ElectronApplication, page: Page, dir: string, missing: string
async function state() {
  return page.evaluate(() => window.ipcRenderer.bootstrap())
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-preflight-native-'))
  const repo = new Repository(dir)
  await repo.open()
  const file = path.join(dir, 'synthetic.png')
  await fs.writeFile(file, 'synthetic image bytes')
  const asset = await repo.register(file)
  missing = path.join(repo.mediaDir, asset.filename)
  await repo.saveDraft({
    id: 'song',
    title: '합성 긴 제목 찬양',
    slides: [
      {
        id: 'slide',
        type: 'text',
        content: '사전 점검 중에도 유지할 가사',
        backgroundUrl: repo.assetURL(asset),
      },
    ],
    revision: 1,
    createdAt: '2026-10-16T00:00:00.000Z',
    updatedAt: '2026-10-16T00:00:00.000Z',
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
  page = await app.firstWindow()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
})
test.afterEach(async () => {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
})
async function open() {
  await page.getByRole('button', { name: '전체 순서', exact: true }).click()
  await page.getByRole('button', { name: '사전 점검', exact: true }).click()
  return page.getByRole('dialog', { name: '예배 사전 점검' })
}
test('read-only check finds missing files, retains results, routes to the cue and invalidates after repair edits', async () => {
  await page.evaluate(async () => {
    await window.ipcRenderer.toggleOutput()
    await window.ipcRenderer.toggleStage()
    const slide = { id: 'live-fixture', type: 'text' as const, content: '점검 중 유지할 현재 화면' }
    window.ipcRenderer.send('route-screen-update', {
      screenId: 'main',
      data: {
        type: 'state-update',
        layers: {
          slide,
          audio: null,
          background: { type: 'none' },
          announcement: null,
          message: null,
          props: [],
        },
      },
    })
    window.ipcRenderer.send('update-stage', { current: slide, next: null })
  })
  await expect
    .poll(async () => (await state()).live?.layers.slide?.content)
    .toBe('점검 중 유지할 현재 화면')
  await fs.rm(missing)
  const before = await state(),
    dialog = await open()
  await dialog.getByRole('button', { name: '검사 시작', exact: true }).click()
  await expect(
    dialog.getByText('확인 필요 · 등록 파일을 찾지 못함 · 새 자료 연결 또는 파일 복원 필요', {
      exact: true,
    }),
  ).toBeVisible()
  await expect(dialog.getByText('직접 확인 · 실제 음향과 음량 확인', { exact: true })).toBeVisible()
  expect((await state()).live).toEqual(before.live)
  expect((await state()).externalOutput.source).toEqual(before.externalOutput.source)
  await dialog.getByRole('button', { name: '닫기', exact: true }).click()
  await page.getByRole('button', { name: '사전 점검', exact: true }).click()
  await expect(
    dialog.getByText('확인 필요 · 등록 파일을 찾지 못함 · 새 자료 연결 또는 파일 복원 필요', {
      exact: true,
    }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '수정하기', exact: true }).first().click()
  const edit = page.getByRole('dialog', { name: '예배 순서 편집' })
  await expect(edit).toBeVisible()
  await edit.getByLabel('순서 제목', { exact: true }).fill('수정한 찬양 제목')
  await edit.getByRole('button', { name: '변경 저장', exact: true }).click()
  await page.getByRole('button', { name: '사전 점검', exact: true }).click()
  await expect(dialog.getByText('재검사 필요 · 이전 내용 기준', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('checkbox').first()).toBeDisabled()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((win) => win.webContents.getURL().includes('control-panel'))!
      .setBounds({ width: 1024, height: 768 }),
  )
  await expect(dialog.getByRole('button', { name: '다시 검사', exact: true })).toBeInViewport({
    ratio: 1,
  })
  await page.screenshot({ path: '/tmp/propre-worship-preflight-compact.png' })
})
test('human confirmations are explicit, saved and invalidated by changing output topology or fonts', async () => {
  const dialog = await open()
  await dialog.getByRole('button', { name: '검사 시작', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '다시 검사', exact: true })).toBeVisible()
  const checkboxes = dialog.getByRole('checkbox')
  for (let index = 0; index < (await checkboxes.count()); index++) {
    await checkboxes.nth(index).check()
    await expect(checkboxes.nth(index)).toBeEnabled()
  }
  await expect(dialog.getByText('준비 확인 완료 · 현장 체크 포함', { exact: true })).toBeVisible()
  const summaries = JSON.parse(
    await fs.readFile(path.join(dir, 'service-preflight-v1.json'), 'utf8'),
  )
  expect(
    summaries[0].results.some((result: { status: string }) => result.status === 'acknowledged'),
  ).toBe(true)
  expect(JSON.stringify(summaries)).not.toContain('사전 점검 중에도 유지할 가사')
  await page.evaluate(() => window.ipcRenderer.toggleStage())
  await expect(dialog.getByText('재검사 필요 · 이전 내용 기준', { exact: true })).toBeVisible()
  await expect
    .poll(() => app.windows().some((win) => win.url().includes('stage-display')))
    .toBe(true)
  const stage = app.windows().find((win) => win.url().includes('stage-display'))!
  expect(await stage.evaluate(() => typeof window.ipcRenderer.preflight)).toBe('undefined')
})
test('1000-cue cancellation yields promptly without a completed state and keeps both live snapshots unchanged', async () => {
  await page.evaluate(async () => {
    const state = await window.ipcRenderer.bootstrap(),
      list = state.setlists[0],
      plan = structuredClone(list.servicePlan!)
    plan.items.push(
      ...Array.from({ length: 999 }, (_, index) => ({
        id: `fixture-${index}`,
        kind: 'prayer' as const,
        title: `합성 기도 ${index}`,
        enter: { visual: 'keep' as const, audio: 'keep' as const },
      })),
    )
    await window.ipcRenderer.saveServicePlan({
      requestId: crypto.randomUUID(),
      setlistId: list.id,
      expectedSetlistRevision: list.revision,
      plan,
    })
  })
  await page.reload()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  const dialog = await open(),
    before = await state()
  await dialog.getByRole('button', { name: '검사 시작', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '점검 취소', exact: true })).toBeVisible()
  const began = performance.now()
  await dialog.getByRole('button', { name: '점검 취소', exact: true }).click()
  await expect(
    dialog.getByText('점검을 취소했습니다. 부분 결과로 준비 완료를 판단하지 않습니다.', {
      exact: true,
    }),
  ).toBeVisible()
  expect(performance.now() - began).toBeLessThan(1000)
  expect((await state()).live).toEqual(before.live)
  expect((await state()).externalOutput.source).toEqual(before.externalOutput.source)
  const cancelLatencyMs = performance.now() - began
  const restart = performance.now()
  await dialog.getByRole('button', { name: '다시 검사', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '다시 검사', exact: true })).toBeVisible()
  const completeLatencyMs = performance.now() - restart
  const completed = await page.evaluate(async () => {
    const state = await window.ipcRenderer.bootstrap()
    return window.ipcRenderer.preflight({
      action: 'get',
      setlistId: state.activeSetlistId!,
      fonts: `loaded:${document.fonts.size}:0`,
    })
  })
  expect(completed?.processed).toBe(1000)
  expect(completed?.status).toBe('completed')
  await fs.writeFile(
    '/tmp/propre-worship-preflight-timing.json',
    JSON.stringify({ cues: 1000, cancelLatencyMs, completeLatencyMs }),
  )
})

test('oversized text and unavailable font measurements require explicit visual checks', async () => {
  const update = async (content: string, fontFamily: string) =>
    page.evaluate(
      async ({ content, fontFamily }) => {
        const state = await window.ipcRenderer.bootstrap(),
          p = state.setlistSongs[0].presentation
        await window.ipcRenderer.saveDraft({
          ...p,
          revision: (p.revision || 0) + 1,
          globalSlideStyle: { ...p.globalSlideStyle!, fontFamily, fontSize: 240 },
          slides: [{ ...p.slides[0], content }],
        })
      },
      { content, fontFamily },
    )
  await update('가'.repeat(2000), 'sans-serif')
  let dialog = await open()
  await dialog.getByRole('button', { name: '검사 시작', exact: true }).click()
  await expect(
    dialog.getByText('권장 · 본문 또는 요소가 화면을 넘을 수 있음 · 미리보기 확인', {
      exact: true,
    }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '닫기', exact: true }).click()
  await update('글꼴을 확인할 합성 문구', 'ProPreMissingSyntheticFont')
  await page.getByRole('button', { name: '사전 점검', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '예배 사전 점검' })
  await dialog.getByRole('button', { name: '다시 검사', exact: true }).click()
  await expect(
    dialog.getByText('직접 확인 · 글꼴 또는 본문 측정 불가 · 직접 화면 확인', { exact: true }),
  ).toBeVisible()
  await dialog.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: '사전 점검', exact: true })).toBeFocused()
})
