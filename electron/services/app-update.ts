import {
  UpdateManifestSchema,
  isNewerVersion,
  safeUpdateURL,
  type AppUpdateState,
  type UpdatePlatform,
} from '../../shared/app-update'

const MAX_MANIFEST_BYTES = 64 * 1024
export type UpdateFetch = (url: string, init: RequestInit) => Promise<Response>
/** Follow only HTTPS redirects, bound response size, and never send credentials. */
export async function readUpdateManifest(
  fetcher: UpdateFetch,
  feed: string,
  signal: AbortSignal,
): Promise<unknown> {
  let url = safeUpdateURL(feed)
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetcher(url.href, {
      signal,
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location) throw new Error('업데이트 주소를 확인하지 못했습니다.')
      url = safeUpdateURL(new URL(location, url).href, true)
      continue
    }
    if (
      !response.ok ||
      !response.body ||
      Number(response.headers.get('content-length')) > MAX_MANIFEST_BYTES
    ) {
      await response.body?.cancel()
      throw new Error('업데이트 정보를 읽지 못했습니다.')
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_MANIFEST_BYTES) {
          await reader.cancel()
          throw new Error('업데이트 정보가 너무 큽니다.')
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes))
  }
  throw new Error('업데이트 주소 이동이 너무 많습니다.')
}

/** Free distribution: discovery and an explicit browser download, never install or quit. */
export class AppUpdates {
  private state: AppUpdateState
  private downloadURL?: string
  private timer?: ReturnType<typeof setInterval>
  private controller?: AbortController
  private disposed = false
  private feed?: URL
  constructor(
    private version: string,
    private platform: UpdatePlatform | undefined,
    feed: string | undefined,
    private transport: { fetch: UpdateFetch; open: (url: string) => Promise<void> },
    private notify: (state: AppUpdateState) => void,
  ) {
    try {
      if (feed) this.feed = safeUpdateURL(feed)
    } catch {
      /* Invalid bundled config stays offline. */
    }
    this.state = {
      revision: 0,
      currentVersion: version,
      status: this.feed && platform ? 'idle' : 'disabled',
      message:
        this.feed && platform
          ? undefined
          : '이 빌드는 업데이트 다운로드 주소가 설정되지 않았습니다.',
    }
  }
  snapshot(): AppUpdateState {
    return { ...this.state }
  }
  private set(patch: Partial<AppUpdateState>) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }
    this.notify(this.snapshot())
  }
  async check() {
    if (
      !this.feed ||
      !this.platform ||
      this.disposed ||
      !['idle', 'available', 'download-opened', 'error'].includes(this.state.status)
    )
      return this.snapshot()
    this.downloadURL = undefined
    this.set({ status: 'checking', message: undefined })
    const controller = new AbortController()
    this.controller = controller
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      const raw = await readUpdateManifest(this.transport.fetch, this.feed.href, controller.signal)
      if (this.disposed || controller.signal.aborted) throw new Error('확인 중단')
      const manifest = UpdateManifestSchema.parse(raw)
      const checkedAt = new Date().toISOString()
      if (!isNewerVersion(manifest.version, this.version)) {
        this.set({ status: 'idle', version: undefined, checkedAt })
      } else {
        const target = manifest.downloads[this.platform]
        if (!target)
          this.set({
            status: 'idle',
            version: undefined,
            checkedAt,
            message: '이 Mac에 맞는 새 설치 파일이 아직 게시되지 않았습니다.',
          })
        else {
          const url = safeUpdateURL(target)
          if (url.origin !== this.feed.origin || !url.pathname.toLowerCase().endsWith('.dmg'))
            throw new Error('다운로드 주소가 올바르지 않습니다.')
          this.downloadURL = url.href
          this.set({ status: 'available', version: manifest.version, checkedAt })
        }
      }
    } catch {
      this.set({
        status: 'error',
        message: '새 버전을 확인하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해주세요.',
      })
    } finally {
      clearTimeout(timeout)
      if (this.controller === controller) this.controller = undefined
    }
    return this.snapshot()
  }
  async download() {
    if (
      !this.downloadURL ||
      this.disposed ||
      !['available', 'download-opened'].includes(this.state.status)
    )
      return this.snapshot()
    this.set({ status: 'opening', message: undefined })
    try {
      await this.transport.open(this.downloadURL)
      this.set({
        status: 'download-opened',
        message:
          '브라우저에서 다운로드를 확인하세요. 예배·송출을 마치고 ProPre를 종료한 뒤 새 앱으로 교체해주세요.',
      })
    } catch {
      this.set({
        status: 'available',
        message: '다운로드를 열지 못했습니다. 기본 브라우저를 확인하고 다시 시도해주세요.',
      })
    }
    return this.snapshot()
  }
  start() {
    if (!this.feed || !this.platform || this.timer || this.disposed) return
    void this.check()
    this.timer = setInterval(
      () => {
        void this.check()
      },
      4 * 60 * 60 * 1000,
    )
    this.timer.unref()
  }
  dispose() {
    this.disposed = true
    clearInterval(this.timer)
    this.controller?.abort()
  }
}
