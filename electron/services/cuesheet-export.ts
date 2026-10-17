import { app, BrowserWindow, session, dialog, shell } from 'electron'
import fs from 'node:fs/promises'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { PDFDocument } from 'pdf-lib'
import { CuesheetRequest, cuesheetDTO, type CuesheetJob } from '../../shared/cuesheet'
import { atomicWrite, type Repository } from './repository'
import type { WindowManager } from './windows'
import type { FileResult } from '../../shared/contracts'
import { cuesheetHTML, paginateCuesheet } from './cuesheet-html'
interface Job {
  id: string
  setlistId: string
  revision: number
  title: string
  generatedAt: string
  included: string[]
  pages: number
  buffer?: Buffer
  directory?: string
  window?: BrowserWindow
  savedPath?: string
  printing: boolean
  cancelled: boolean
  landscape: boolean
}
export class CuesheetExport {
  private job?: Job
  private creating?: { id: string; signature: string; promise: Promise<CuesheetJob> }
  private seen = new Set<string>()
  private generation = 0
  readonly root: string
  constructor(
    private repo: Repository,
    private windows: WindowManager,
  ) {
    this.root = path.join(
      app.getPath('temp'),
      'propre-cuesheets-' + createHash('sha256').update(repo.directory).digest('hex').slice(0, 16),
    )
  }
  async open() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 })
    for (const name of await fs.readdir(this.root))
      if (/^[a-f0-9-]{36}$/.test(name)) {
        const filename = path.join(this.root, name)
        const stat = await fs.lstat(filename).catch(() => null)
        if (stat?.isDirectory() && !stat.isSymbolicLink())
          await fs.rm(filename, { recursive: true, force: true })
      }
  }
  private current(id: string) {
    const job = this.job
    if (!job || job.id !== id || job.cancelled || !job.buffer)
      throw new Error('미리보기가 만료되었습니다. 다시 만들어주세요.')
    return job
  }
  private stale(job: Job) {
    return (
      this.repo.state.setlists.find((list) => list.id === job.setlistId && !list.deletedAt)
        ?.revision !== job.revision
    )
  }
  status(id: string): CuesheetJob {
    const job = this.current(id)
    return {
      id,
      setlistId: job.setlistId,
      revision: job.revision,
      title: job.title,
      generatedAt: job.generatedAt,
      included: [...job.included],
      pages: job.pages,
      url: `output://cuesheet/${id}`,
      stale: this.stale(job),
      saved: !!job.savedPath,
    }
  }
  bytes(id: string) {
    return this.job?.id === id && !this.job.cancelled ? this.job.buffer : undefined
  }
  create(raw: unknown): Promise<CuesheetJob> {
    const request = CuesheetRequest.parse(raw),
      signature = JSON.stringify(request)
    if (this.creating?.id === request.requestId) {
      if (this.creating.signature !== signature)
        return Promise.reject(new Error('같은 요청 ID의 출력 옵션이 다릅니다.'))
      return this.creating.promise
    }
    if (this.seen.has(request.requestId))
      return Promise.reject(new Error('이전 출력 요청입니다. 새 미리보기를 만들어주세요.'))
    if (this.job?.printing)
      return Promise.reject(new Error('인쇄 대화상자를 마친 뒤 미리보기를 바꿔주세요.'))
    const generation = ++this.generation
    this.seen.add(request.requestId)
    if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value!)
    const promise = (async () => {
      if (this.job) await this.close(this.job.id)
      await this.repo.settled()
      if (generation !== this.generation) throw new Error('미리보기를 취소했습니다.')
      const list = this.repo.state.setlists.find(
        (list) => list.id === request.setlistId && !list.deletedAt,
      )
      if (!list || list.revision !== request.revision)
        throw new Error('예배 내용이 바뀌었습니다. 최신 내용으로 다시 만들어주세요.')
      const dto = cuesheetDTO(this.repo.workspace(), request.setlistId, request.options)
      const job: Job = {
        id: request.requestId,
        setlistId: list.id,
        revision: list.revision,
        title: list.title,
        generatedAt: dto.generatedAt,
        included: dto.included,
        pages: 0,
        printing: false,
        cancelled: false,
        landscape: request.options.orientation === 'landscape',
      }
      this.job = job
      let timer: ReturnType<typeof setTimeout> | undefined
      let memoryTimer: ReturnType<typeof setInterval> | undefined
      try {
        const operation = (async () => {
          await fs.mkdir(this.root, { recursive: true, mode: 0o700 })
          job.directory = path.join(this.root, job.id)
          await fs.mkdir(job.directory, { mode: 0o700 })
          if (job.cancelled || this.job !== job) throw new Error('미리보기를 취소했습니다.')
          const partition = session.fromPartition('propre-cuesheet-' + job.id, { cache: false })
          partition.setPermissionRequestHandler((_contents, _permission, callback) =>
            callback(false),
          )
          partition.setPermissionCheckHandler(() => false)
          const htmlPath = path.join(job.directory!, 'preview.html')
          await fs.writeFile(htmlPath, cuesheetHTML(dto, request.options), { mode: 0o600 })
          if (job.cancelled || this.job !== job) throw new Error('미리보기를 취소했습니다.')
          partition.webRequest.onBeforeRequest((details, callback) =>
            callback({ cancel: details.url !== pathToFileURL(htmlPath).href }),
          )
          const win = new BrowserWindow({
            show: false,
            title: 'ProPre · 큐시트 인쇄',
            width: request.options.orientation === 'landscape' ? 1200 : 850,
            height: 1000,
            webPreferences: {
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              webSecurity: true,
              backgroundThrottling: false,
              session: partition,
            },
          })
          job.window = win
          win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
          win.webContents.on('will-navigate', (event) => event.preventDefault())
          win.webContents.on('will-attach-webview', (event) => event.preventDefault())
          win.on('page-title-updated', (event) => event.preventDefault())
          await win.loadFile(htmlPath)
          const layout: { pages: number; overflow: boolean } =
            await win.webContents.executeJavaScript(`(${paginateCuesheet.toString()})()`)
          if (layout.overflow || job.cancelled || this.job !== job)
            throw new Error('페이지 배치를 확인하지 못했습니다. 다시 만들어주세요.')
          // Chromium's single huge print job can retain >1 GiB for long notes.
          // Only attach each bounded batch to the print DOM, then merge the
          // unchanged pages. pageRanges alone still lays out the whole document.
          await win.webContents.executeJavaScript(
            `window.__proprePrintPages = Array.from(document.querySelectorAll('.page')); document.body.replaceChildren()`,
          )
          const merged = await PDFDocument.create()
          for (let first = 1; first <= layout.pages; first += 50) {
            if (job.cancelled || this.job !== job) throw new Error('미리보기를 취소했습니다.')
            const last = Math.min(first + 49, layout.pages)
            await win.webContents.executeJavaScript(
              `document.body.replaceChildren(...window.__proprePrintPages.slice(${first - 1}, ${last}))`,
            )
            const part = await win.webContents.printToPDF({
              pageSize: 'A4',
              landscape: request.options.orientation === 'landscape',
              printBackground: true,
              preferCSSPageSize: true,
              displayHeaderFooter: false,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              pageRanges: `1-${last - first + 1}`,
            })
            const pdfPart = await PDFDocument.load(part, { updateMetadata: false })
            if (pdfPart.getPageCount() !== last - first + 1)
              throw new Error('PDF 페이지 범위를 확인하지 못했습니다. 다시 만들어주세요.')
            for (const page of await merged.copyPages(pdfPart, pdfPart.getPageIndices()))
              merged.addPage(page)
          }
          await win.webContents.executeJavaScript(
            `document.body.replaceChildren(...window.__proprePrintPages); delete window.__proprePrintPages`,
          )
          const bytes = Buffer.from(await merged.save())
          if (bytes.length > 200 * 1024 * 1024 || job.cancelled || this.job !== job)
            throw new Error('출력 크기를 초과했거나 작업을 취소했습니다.')
          const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
          if (pdf.getPageCount() !== layout.pages)
            throw new Error(
              'PDF 페이지 배치가 미리보기와 다릅니다. 글자 크기/방향을 바꾸어 다시 만들어주세요.',
            )
          job.pages = layout.pages
          job.buffer = bytes
          await atomicWrite(path.join(job.directory, 'preview.pdf'), bytes)
          if (job.cancelled || this.job !== job) throw new Error('미리보기를 취소했습니다.')
          return this.status(job.id)
        })()
        void operation
          .finally(async () => {
            if (job.cancelled) await this.cleanup(job)
          })
          .catch(() => {})
        return await Promise.race([
          operation,
          new Promise<CuesheetJob>((_resolve, reject) => {
            memoryTimer = setInterval(() => {
              const win = job.window
              if (!win || win.isDestroyed()) return
              const memory = app
                .getAppMetrics()
                .find((metric) => metric.pid === win.webContents.getOSProcessId())?.memory
              if (memory && memory.workingSetSize > 2 * 1024 * 1024) {
                job.cancelled = true
                win.destroy()
                reject(
                  new Error(
                    'PDF 생성이 메모리 한도를 넘었습니다. 포함 정보를 줄여 다시 시도해주세요.',
                  ),
                )
              }
            }, 250)
            timer = setTimeout(() => {
              job.cancelled = true
              job.window?.destroy()
              reject(new Error('PDF 생성이30초를 넘었습니다. 옵션/자료를 줄여 다시 시도해주세요.'))
            }, 30000)
          }),
        ])
      } catch (failure) {
        const cancelled = job.cancelled
        await this.close(job.id)
        await this.cleanup(job)
        const message = failure instanceof Error ? failure.message : ''
        throw new Error(
          message === 'font unavailable'
            ? '한글 글꼴 준비를 확인하지 못했습니다. 다시 시도해주세요.'
            : ['PDF 생성이', '페이지 배치', 'PDF 페이지', '출력 크기', '미리보기를 취소'].some(
                  (prefix) => message.startsWith(prefix),
                )
              ? message
              : cancelled
                ? '미리보기를 취소했습니다.'
                : 'PDF를 만들거나 임시 저장하지 못했습니다. 저장 공간을 확인하고 다시 시도해주세요.',
        )
      } finally {
        clearTimeout(timer)
        clearInterval(memoryTimer)
        if (this.creating?.id === job.id) this.creating = undefined
      }
    })().finally(() => {
      if (this.creating?.id === request.requestId) this.creating = undefined
    })
    this.creating = { id: request.requestId, signature, promise }
    return promise
  }
  async close(id: string) {
    const job = this.job
    if (!job || job.id !== id) {
      if (this.creating?.id === id) {
        this.generation++
        this.creating = undefined
      }
      return
    }
    if (job.printing) throw new Error('인쇄 대화상자를 먼저 마쳐주세요.')
    job.cancelled = true
    this.job = undefined
    await this.cleanup(job)
  }
  private async cleanup(job: Job) {
    if (job.window && !job.window.isDestroyed()) job.window.destroy()
    job.buffer = undefined
    if (job.directory) await fs.rm(job.directory, { recursive: true, force: true })
  }
  async save(id: string): Promise<FileResult> {
    const job = this.current(id)
    const selected = await dialog.showSaveDialog(this.windows.windows.get('control')!, {
      title: this.stale(job) ? '이전 내용 기준 큐시트 PDF 저장' : '큐시트 PDF 저장',
      defaultPath: job.title.replace(/[\\/:*?"<>|]/g, '-') + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (selected.canceled || !selected.filePath) return { success: false, canceled: true }
    this.current(id)
    if (this.stale(job)) {
      const confirm = await dialog.showMessageBox(this.windows.windows.get('control')!, {
        type: 'question',
        message: '예배 내용이 바뀌었습니다. 이전 내용의 미리보기를 저장할까요?',
        detail: `미리보기는 revision ${job.revision} 기준입니다. 최신 내용은 다시 만들어주세요.`,
        buttons: ['취소', '이전 내용으로 저장'],
        defaultId: 0,
        cancelId: 0,
      })
      if (confirm.response !== 1) return { success: false, canceled: true }
    }
    this.current(id)
    await atomicWrite(selected.filePath, job.buffer!)
    job.savedPath = selected.filePath
    return { success: true, filePath: selected.filePath }
  }
  async print(id: string): Promise<FileResult> {
    const job = this.current(id)
    if (job.printing || !job.window || job.window.isDestroyed())
      throw new Error('인쇄할 미리보기를 다시 만들어주세요.')
    if (this.stale(job)) {
      const confirm = await dialog.showMessageBox(this.windows.windows.get('control')!, {
        type: 'question',
        message: '예배 내용이 바뀌었습니다. 이전 내용으로 인쇄할까요?',
        buttons: ['취소', '이전 내용으로 인쇄'],
        defaultId: 0,
        cancelId: 0,
      })
      if (confirm.response !== 1) return { success: false, canceled: true }
    }
    this.current(id)
    job.printing = true
    try {
      if (process.env.PROPRE_TEST_HEADLESS !== '1') job.window.show()
      return await new Promise<FileResult>((resolve) =>
        job.window!.webContents.print(
          {
            silent: false,
            printBackground: true,
            pageSize: 'A4',
            landscape: job.landscape,
            margins: { marginType: 'none' },
          },
          (success, reason) =>
            resolve(
              success
                ? { success: true }
                : /cancel/i.test(reason)
                  ? { success: false, canceled: true }
                  : {
                      success: false,
                      error: '인쇄 요청을 완료하지 못했습니다. 프린터 설정을 확인해주세요.',
                    },
            ),
        ),
      )
    } finally {
      job.printing = false
      if (job.window && !job.window.isDestroyed()) job.window.hide()
      this.windows.windows.get('control')?.focus()
    }
  }
  reveal(id: string) {
    const job = this.current(id)
    if (!job.savedPath) throw new Error('PDF를 먼저 저장해주세요.')
    shell.showItemInFolder(job.savedPath)
  }
  async dispose() {
    this.generation++
    this.creating = undefined
    if (this.job) {
      this.job.printing = false
      await this.close(this.job.id)
    }
  }
  /** Electron does not await promises in will-quit. Only our private job is removed. */
  disposeOnQuit() {
    this.generation++
    this.creating = undefined
    const job = this.job
    this.job = undefined
    if (!job) return
    job.cancelled = true
    if (job.window && !job.window.isDestroyed()) job.window.destroy()
    job.buffer = undefined
    if (job.directory) {
      try {
        rmSync(job.directory, { recursive: true, force: true })
      } catch {
        /* The next start retries cleanup after a locked file is released. */
      }
    }
  }
}
