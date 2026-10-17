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
const operationalMetrics: {
  startupMs: number[]
  memoryKB: number[]
  runtime?: { electron?: string; node: string; chrome?: string }
} = { startupMs: [], memoryKB: [] }
async function launch() {
  const started = Date.now()
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
  operationalMetrics.startupMs.push(Date.now() - started)
  operationalMetrics.runtime = await app.evaluate(() => ({
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  }))
}
async function fillFirstSlide(text: string) {
  await page.getByTestId('slide-card').first().dblclick()
  await page.locator('textarea').first().fill(text)
  await page.locator('textarea').first().press('Tab')
}
test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-native-'))
  await launch()
})
test.afterEach(async () => {
  await app
    ?.evaluate(({ app }) =>
      app.getAppMetrics().reduce((sum, item) => sum + item.memory.workingSetSize, 0),
    )
    .then((memory) => operationalMetrics.memoryKB.push(memory))
    .catch(() => {})
  // Failed disk writes deliberately block normal close; test fixtures have no user data.
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await fs.rm(dir, { recursive: true, force: true })
})
test.afterAll(async () => {
  await fs.mkdir('test-results', { recursive: true })
  await fs.writeFile(
    'test-results/operational-metrics.json',
    JSON.stringify(operationalMetrics, null, 2),
  )
})
test('automatic edits survive normal close and relaunch without a save button', async () => {
  await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
  const editor = page.locator('textarea').first()
  await page.getByTestId('slide-card').first().dblclick()
  await editor.fill('저장 버튼 없는 수정')
  await editor.press('Tab')
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  await expect(page.getByLabel('마지막 저장 시각')).toBeVisible()
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(dir, 'workspace-v5.json'), 'utf8')).draft?.slides[0]
          .content,
    )
    .toBe('저장 버튼 없는 수정')
  await app.close()
  await launch()
  await expect(page.getByText('저장 버튼 없는 수정', { exact: true }).first()).toBeVisible()
  expect(await page.evaluate(() => window.ipcRenderer.role)).toBe('control')
})
test('native windows and Dock entries have distinct titles, restricted APIs, and snapshot replay', async () => {
  await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
  await page.getByTestId('slide-card').first().click()
  await page.evaluate(async () => {
    await window.ipcRenderer.toggleOutput()
    await window.ipcRenderer.toggleStage()
  })
  await expect.poll(async () => app.windows().length).toBe(3)
  const titles = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => w.getTitle()),
  )
  expect(new Set(titles)).toEqual(
    new Set(['ProPre · 컨트롤', 'ProPre · 메인 송출', 'ProPre · 모니터']),
  )
  const output = app.windows().find((p) => p.url().includes('output-display'))!,
    stage = app.windows().find((p) => p.url().includes('stage-display'))!
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(dir, 'workspace-v5.json'), 'utf8')).draft?.slides[0]
          ?.content,
    )
    .toBe('')
  await expect(output.locator('body')).toHaveText('')
  await expect(stage.locator('[data-stage-section="current"] [data-stage-text]')).toHaveText('')
  await fillFirstSlide('합성 송출 본문')
  await expect(output.getByText('합성 송출 본문', { exact: true })).toBeVisible()
  await expect(stage.getByText('합성 송출 본문', { exact: true })).toBeVisible()
  expect(await output.evaluate(() => Object.keys(window.ipcRenderer))).not.toContain('saveDraft')
  expect(await stage.evaluate(() => Object.keys(window.ipcRenderer))).not.toContain('setApiKey')
  expect(await page.evaluate(() => Object.keys(window.ipcRenderer))).not.toContain('invoke')
  await output.reload()
  await expect(output.getByText('합성 송출 본문', { exact: true })).toBeVisible()
  await page.evaluate(() => window.ipcRenderer.toggleOutput())
  await page.evaluate(() => window.ipcRenderer.toggleOutput())
  await expect
    .poll(async () => app.windows().some((p) => p.url().includes('output-display')))
    .toBe(true)
  const replaced = app.windows().find((p) => p.url().includes('output-display'))!
  await expect(replaced.getByText('합성 송출 본문', { exact: true })).toBeVisible()
  if (process.platform === 'darwin') {
    const labels = await app.evaluate(({ app }) => app.dock?.getMenu()?.items.map((i) => i.label))
    expect(labels).toEqual(['ProPre · 컨트롤', 'ProPre · 메인 송출', 'ProPre · 모니터'])
  }
})
test('bulk editing autosaves and modal hotkeys do not operate the live screen', async () => {
  await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
  await page.getByTestId('slide-card').first().click()
  await page.getByRole('button', { name: '전체 텍스트 목록 편집', exact: true }).click()
  await page
    .getByRole('textbox', { name: '전체 슬라이드 텍스트' })
    .fill('첫 번째 수정\n\n두 번째 수정')
  await page.keyboard.press('F2')
  await page.getByRole('button', { name: '완료', exact: true }).click()
  await expect(page.getByText('첫 번째 수정', { exact: true }).first()).toBeVisible()
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(dir, 'workspace-v5.json'), 'utf8')).draft?.slides
          .length,
    )
    .toBe(2)
  await expect(page.getByText('화면 연결 중')).toHaveCount(0)
})
test('renderer crash recovers an edit still waiting for its disk checkpoint', async () => {
  await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
  await page.getByTestId('slide-card').first().dblclick()
  await page.locator('textarea').first().fill('중단 직전 복구')
  const reopened = app.waitForEvent('window')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.getTitle().includes('컨트롤'))!
      .webContents.forcefullyCrashRenderer(),
  )
  page = await reopened
  await expect(
    page.getByTestId('slide-card').first().getByText('중단 직전 복구', { exact: true }),
  ).toBeVisible()
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(dir, 'workspace-v5.json'), 'utf8')).draft?.slides[0]
          .content,
    )
    .toBe('중단 직전 복구')
})

test('closing and reopening control keeps output current and restores the document', async () => {
  await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
  await fillFirstSlide('합성 송출 본문')
  await page.getByTestId('slide-card').first().click()
  await page.evaluate(() => window.ipcRenderer.toggleOutput())
  const output = await expect
    .poll(() =>
      app
        .windows()
        .find((p) => p.url().includes('output-display'))
        ?.url(),
    )
    .not.toBeUndefined()
    .then(() => app.windows().find((p) => p.url().includes('output-display'))!)
  await expect(output.getByText('합성 송출 본문', { exact: true })).toBeVisible()
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.getTitle().includes('컨트롤'))!
      .close(),
  )
  await expect.poll(() => app.windows().length).toBe(1)
  await app.evaluate(({ app }) => app.emit('activate'))
  await expect.poll(() => app.windows().length).toBe(2)
  page = app.windows().find((p) => p !== output)!
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  await expect(output.getByText('합성 송출 본문', { exact: true })).toBeVisible()
})

test('save failure remains visible and the unsaved edit survives retry', async () => {
  await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(dir, 'workspace-v5.json'), 'utf8')).library.length,
    )
    .toBe(1)
  await fs.rename(path.join(dir, 'workspace-v5.json'), path.join(dir, 'safe-copy.json'))
  await fs.mkdir(path.join(dir, 'workspace-v5.json'))
  await page.getByTestId('slide-card').first().dblclick()
  await page.locator('textarea').first().fill('실패 후 재시도')
  await expect(page.getByText('자동 저장 실패', { exact: true })).toBeVisible()
  const exported = path.join(dir, 'unsaved.ppros')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, exported)
  await page.getByRole('button', { name: '파일', exact: true }).click()
  await page.getByRole('button', { name: '파일로 내보내기', exact: true }).click()
  await expect
    .poll(async () => {
      try {
        return JSON.parse(await fs.readFile(exported, 'utf8')).presentations[0].slides[0].content
      } catch {
        return null
      }
    })
    .toBe('실패 후 재시도')
  const reopened = app.waitForEvent('window')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.getTitle().includes('컨트롤'))!
      .webContents.forcefullyCrashRenderer(),
  )
  page = await reopened
  await expect(
    page.getByTestId('slide-card').first().getByText('실패 후 재시도', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('자동 저장 실패', { exact: true })).toBeVisible()
  await fs.rm(path.join(dir, 'workspace-v5.json'), { recursive: true })
  await fs.rename(path.join(dir, 'safe-copy.json'), path.join(dir, 'workspace-v5.json'))
  await page.getByRole('button', { name: '재시도', exact: true }).click()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(dir, 'workspace-v5.json'), 'utf8')).draft?.slides[0]
          .content,
    )
    .toBe('실패 후 재시도')
})

test('registered image URL loads with web security and survives portable backup', async () => {
  const image = path.join(dir, 'image # one.png')
  await fs.writeFile(
    image,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Zq0AAAAASUVORK5CYII=',
      'base64',
    ),
  )
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, image)
  await page.getByRole('button', { name: '미디어 슬라이드 추가', exact: true }).click()
  await page.getByTestId('slide-card').first().click()
  await page.evaluate(() => window.ipcRenderer.toggleOutput())
  await expect
    .poll(() =>
      app
        .windows()
        .find((p) => p.url().includes('output-display'))
        ?.url(),
    )
    .not.toBeUndefined()
  const output = app.windows().find((p) => p.url().includes('output-display'))!
  await expect
    .poll(() =>
      output
        .locator('img')
        .first()
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1)
  const exported = path.join(dir, 'backup.ppros')
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
  }, exported)
  await page.getByText('자동 저장됨', { exact: true }).waitFor()
  expect((await page.evaluate(() => window.ipcRenderer.createBackup())).success).toBe(true)
  const backup = JSON.parse(await fs.readFile(exported, 'utf8'))
  expect(backup.assets).toHaveLength(1)
  expect(backup.presentations[0].slides[0].backgroundUrl).toMatch(/^media:\/\/asset\//)
  expect(backup.assets[0]).not.toHaveProperty('filePath')
})

test('position editor stays open while changes apply and traps keyboard focus', async () => {
  await page.getByRole('button', { name: '레이어', exact: true }).click()
  await page.getByRole('button', { name: '+ 텍스트', exact: true }).click()
  await page.getByRole('button', { name: '배치 설정', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '고정 안내 화면 배치', exact: true })
  await expect(modal).toBeVisible()
  await modal.getByText('안내 텍스트', { exact: true }).locator('..').click()
  await modal.getByRole('slider').focus()
  await page.keyboard.press('End')
  await expect(modal.getByText('500%', { exact: true })).toBeVisible()
  await modal.getByRole('button', { name: '완료 · 자동 적용', exact: true }).focus()
  await page.keyboard.press('Tab')
  expect(await modal.evaluate((node) => node.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
  await page.getByRole('button', { name: '배치 설정', exact: true }).click()
  await modal.getByText('안내 텍스트', { exact: true }).locator('..').click()
  await expect(modal.getByText('500%', { exact: true })).toBeVisible()
})

test('canvas text changes persist while its editor is still open', async () => {
  await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
  await page.getByTestId('slide-card').first().getByTitle('슬라이드 편집', { exact: true }).click()
  const modal = page.getByRole('dialog', { name: '슬라이드 편집', exact: true })
  await modal.getByRole('button', { name: '+ 텍스트 추가', exact: true }).click()
  await modal.getByPlaceholder('텍스트 입력', { exact: true }).fill('캔버스 자동 저장')
  await expect
    .poll(
      async () =>
        JSON.parse(
          await fs.readFile(path.join(dir, 'workspace-v5.json'), 'utf8'),
        ).draft?.slides[0]?.elements?.some(
          (e: { text?: string }) => e.text === '캔버스 자동 저장',
        ) || false,
    )
    .toBe(true)
  await expect(modal).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
  await page.getByTestId('slide-card').first().click()
  await page.evaluate(() => window.ipcRenderer.toggleStage())
  await expect.poll(() => app.windows().some((p) => p.url().includes('stage-display'))).toBe(true)
  await expect(
    app
      .windows()
      .find((p) => p.url().includes('stage-display'))!
      .getByText(/캔버스 자동 저장/),
  ).toBeVisible()
})

test('settings autosave shows failures and can retry without editing a slide', async () => {
  await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
  await page.getByText('자동 저장됨', { exact: true }).waitFor()
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await page.getByRole('button', { name: '시스템 환경 설정 열기' }).click()
  const modal = page.getByRole('dialog', { name: '시스템 환경 설정', exact: true })
  await modal.getByRole('button', { name: /무대/ }).click()
  await fs.rename(path.join(dir, 'workspace-v5.json'), path.join(dir, 'safe-copy.json'))
  await fs.mkdir(path.join(dir, 'workspace-v5.json'))
  await modal.getByRole('slider').first().focus()
  await page.keyboard.press('End')
  await expect(page.getByText('자동 저장 실패', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await fs.rm(path.join(dir, 'workspace-v5.json'), { recursive: true })
  await fs.rename(path.join(dir, 'safe-copy.json'), path.join(dir, 'workspace-v5.json'))
  await page.getByRole('button', { name: '재시도', exact: true }).click()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  expect(
    JSON.parse(await fs.readFile(path.join(dir, 'workspace-v5.json'), 'utf8')).settings
      .stageCurrentFontSize,
  ).toBe(200)
})

test('switching back to an existing document restores that document on relaunch', async () => {
  async function add(text: string) {
    await page.getByRole('button', { name: '빈 슬라이드 추가', exact: true }).click()
    await page.getByTestId('slide-card').first().dblclick()
    await page.locator('textarea').first().fill(text)
    await page.locator('textarea').first().press('Tab')
    await expect
      .poll(
        async () =>
          JSON.parse(await fs.readFile(path.join(dir, 'workspace-v5.json'), 'utf8')).draft
            ?.slides[0]?.content,
      )
      .toBe(text)
  }
  await add('자료 A 복원')
  await page.getByRole('button', { name: '새 찬양', exact: true }).click()
  await add('자료 B 유지')
  await page.getByTestId('library-item').filter({ hasText: '자료 A 복원' }).click()
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(dir, 'workspace-v5.json'), 'utf8')).draft?.slides[0]
          ?.content,
    )
    .toBe('자료 A 복원')
  await app.close()
  await launch()
  await expect(
    page.getByTestId('slide-card').first().getByText('자료 A 복원', { exact: true }),
  ).toBeVisible()
  await expect(page.getByTestId('library-item').filter({ hasText: '자료 B 유지' })).toHaveCount(1)
})

test('registered video element decodes through the restricted media protocol', async () => {
  const clip = path.join(dir, 'video # one.webm')
  await fs.copyFile(path.resolve('tests/fixtures/video.webm'), clip)
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, clip)
  const [url] = await page.evaluate(() => window.ipcRenderer.selectMediaFiles())
  const project = path.join(dir, 'video-elements.ppros')
  await fs.writeFile(
    project,
    JSON.stringify({
      title: '영상 요소 합성 자료',
      slides: [
        {
          id: 'video-slide',
          type: 'text',
          elements: [
            {
              id: 'video-element',
              type: 'video',
              url,
              x: 10,
              y: 10,
              width: 80,
              height: 80,
              zIndex: 1,
              coordinateUnit: 'percent',
            },
          ],
        },
      ],
    }),
  )
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, project)
  await page.getByRole('button', { name: '파일', exact: true }).click()
  await page.getByRole('button', { name: '프로젝트 불러오기', exact: true }).click()
  await expect(page.getByTestId('slide-card')).toHaveCount(1)
  await page.getByTestId('slide-card').first().click()
  await page.evaluate(() => window.ipcRenderer.toggleOutput())
  await expect.poll(() => app.windows().some((p) => p.url().includes('output-display'))).toBe(true)
  const output = app.windows().find((p) => p.url().includes('output-display'))!
  await expect(output.locator('video')).toHaveCount(1)
  await expect
    .poll(() =>
      output.locator('video').evaluate((media: HTMLVideoElement) => ({
        width: media.videoWidth,
        loaded: media.readyState >= 2,
        error: media.error?.code || null,
      })),
    )
    .toEqual({ width: 32, loaded: true, error: null })
})

test('idle music status preference persists while music stays in the media inspector', async () => {
  await expect(page.getByRole('button', { name: '음악 열기', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await page.getByRole('checkbox', { name: '대기 중 음악 상태 표시', exact: true }).uncheck()
  await expect(page.getByRole('button', { name: '음악 열기', exact: true })).toBeHidden()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  await app.close()
  await launch()
  await expect(page.getByRole('button', { name: '음악 열기', exact: true })).toBeHidden()
  await page.getByRole('button', { name: '미디어', exact: true }).click()
  await page.locator('.media-filters').getByRole('button', { name: '음악', exact: true }).click()
  await page.getByLabel('음악 추가', { exact: true }).click()
  await expect(page.getByRole('button', { name: '오디오 선택', exact: true })).toBeVisible()
})

test('audio has one owner, survives tab switches, and stops with clear all', async () => {
  await page.evaluate(async () => {
    const b = await window.ipcRenderer.bootstrap()
    await window.ipcRenderer.manageSetlist({
      operation: 'create',
      title: '오디오 시험',
      fromCurrent: false,
      expectedActiveId: b.activeSetlistId,
      expectedRevision: b.setlists.find((x) => x.id === b.activeSetlistId)?.revision ?? null,
    })
  })
  await page.reload()
  await expect(page.getByText('자동 저장됨', { exact: true })).toBeVisible()
  const clip = path.resolve('tests/fixtures/silence.wav')
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, clip)
  await page.locator('.media-filters').getByRole('button', { name: '음악', exact: true }).click()
  await page.getByLabel('음악 추가', { exact: true }).click()
  await page.getByRole('button', { name: '오디오 선택', exact: true }).click()
  await page.getByRole('textbox', { name: '음악 이름', exact: true }).fill('시험 음악')
  await page.getByRole('checkbox', { name: '지정 구간 반복', exact: true }).check()
  await page.getByRole('button', { name: '음악 저장', exact: true }).click()
  await page.getByRole('button', { name: '시험 음악 음악 준비', exact: true }).click()
  await expect(page.getByRole('button', { name: '준비한 음악 재생', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '준비한 음악 재생', exact: true }).click()
  await expect
    .poll(() => page.locator('[data-music-engine]').evaluate((el: HTMLAudioElement) => el.paused))
    .toBe(false)
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await page.getByRole('checkbox', { name: '대기 중 음악 상태 표시', exact: true }).uncheck()
  await expect(
    page.getByLabel('음악 상태').getByRole('button', { name: '음악 중지', exact: true }),
  ).toBeVisible()
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused))
    .toBe(false)
  await page.getByRole('button', { name: '스타일', exact: true }).click()
  await expect(page.locator('audio')).toHaveCount(1)
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused))
    .toBe(false)
  await page.evaluate(() => window.ipcRenderer.toggleOutput())
  await expect.poll(() => app.windows().some((p) => p.url().includes('output-display'))).toBe(true)
  await expect(
    app
      .windows()
      .find((p) => p.url().includes('output-display'))!
      .locator('audio'),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '모두 지우기', exact: true }).click()
  await expect
    .poll(() => page.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused))
    .toBe(true)
})
