import net from 'node:net'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { musicURL, musicTargetMatches, type MusicBridgeState } from '../../shared/music'
const observation = z
  .object({
    bindingId: z.string().max(300),
    title: z.string().max(200),
    videoId: z.string().max(160),
    listId: z.string().max(160),
    playing: z.boolean().nullable(),
    pageVideoId: z.string().max(160).optional(),
    pageListId: z.string().max(160).optional(),
    canStart: z.boolean().optional(),
  })
  .strict()
export class MusicBridge {
  private server?: net.Server
  private socket?: net.Socket
  private token = randomBytes(32).toString('hex')
  private observed = 0
  private state: MusicBridgeState = {
    connected: false,
    stale: false,
    playing: null,
    title: '',
    videoId: '',
    listId: '',
    bindingId: '',
  }
  private pending = new Map<
    string,
    {
      resolve: (s: MusicBridgeState) => void
      reject: (e: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private sessionId = randomUUID()
  private sequence = 0
  private generation = 0
  private timer?: ReturnType<typeof setInterval>
  private unresolved = false
  private preparation?: {
    requestId: string
    url: string
    bindingId?: string
    resolve: (state: MusicBridgeState) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
  private preparationGeneration = 0
  private cancelPreparation(message: string) {
    const pending = this.preparation
    this.preparation = undefined
    if (pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
  }
  async prepareChrome(input: string, open: (url: string) => Promise<unknown>) {
    const url = musicURL(input)
    ++this.preparationGeneration
    this.cancelPreparation('새 음악 준비 요청으로 변경되었습니다.')
    // A silent tab handoff is allowed only after the old source confirms pause.
    const pause = this.command('pause')
    const generation = this.preparationGeneration
    await pause
    if (generation !== this.preparationGeneration)
      throw new Error('음악 준비 요청이 변경되었습니다.')
    const requestId = randomBytes(32).toString('hex')
    return new Promise<MusicBridgeState>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.preparation?.requestId === requestId)
          this.cancelPreparation(
            'Chrome 자동 연결을 확인하지 못했습니다. ProPre 음악 연결 확장 설치·새로고침과 연결 프로그램 설정을 확인해주세요. 열린 탭에서 수동 연결도 가능합니다.',
          )
      }, 30000)
      this.preparation = { requestId, url, resolve, reject, timer }
      void open(`${url}#propre-connect=${requestId}`).catch((error) => {
        if (this.preparation?.requestId === requestId)
          this.cancelPreparation(
            error instanceof Error ? error.message : 'Chrome에서 링크를 열지 못했습니다.',
          )
      })
    })
  }
  constructor(
    private directory: string,
    private notify: (state: MusicBridgeState) => void,
  ) {}
  async start() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
    const filename = path.join(this.directory, 'm.sock')
    await fs.rm(filename, { force: true })
    this.server = net.createServer((socket) => {
      let authorized = false,
        buffer = ''
      socket.on('error', () => {})
      socket.on('data', (data) => {
        buffer += data.toString()
        if (Buffer.byteLength(buffer) > 65536) {
          socket.destroy()
          return
        }
        let index: number
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 1)
          try {
            const msg = JSON.parse(line)
            if (!authorized) {
              const supplied = Buffer.from(typeof msg.token === 'string' ? msg.token : '')
              if (
                supplied.length !== this.token.length ||
                !timingSafeEqual(supplied, Buffer.from(this.token)) ||
                this.socket
              ) {
                socket.destroy()
                return
              }
              authorized = true
              this.socket = socket
              socket.write(JSON.stringify({ type: 'ready', sessionId: this.sessionId }) + '\n')
              continue
            }
            if (msg.type === 'prepare-failed') {
              if (this.preparation?.requestId === msg.requestId)
                this.cancelPreparation(
                  '탭 자동 연결에 실패했습니다. ' +
                    (typeof msg.error === 'string'
                      ? msg.error.slice(0, 300)
                      : 'Chrome에서 기존 음악의 중단 상태와 확장 연결을 확인해주세요.'),
                )
              continue
            }
            if (msg.type === 'prepare-tab') {
              const pending = this.preparation
              const candidate = observation.parse(msg.state)
              const target = pending ? new URL(pending.url) : null
              const matches =
                target?.pathname === '/playlist'
                  ? target.searchParams.get('list') === candidate.pageListId
                  : target?.searchParams.get('v') === candidate.pageVideoId
              const approved =
                !!pending &&
                !pending.bindingId &&
                msg.requestId === pending.requestId &&
                matches &&
                candidate.playing === false &&
                !this.unresolved
              if (approved) pending!.bindingId = candidate.bindingId
              socket.write(
                JSON.stringify({
                  type: 'prepare-approved',
                  requestId: msg.requestId,
                  approved,
                  reason: !pending
                    ? '음악 준비 요청이 종료되었습니다. 앱에서 다시 준비해주세요.'
                    : msg.requestId !== pending.requestId
                      ? '다른 준비 요청의 탭입니다. 앱에서 다시 준비해주세요.'
                      : !matches
                        ? '열린 탭의 곡·목록을 확인하지 못했습니다. 페이지 로딩 후 다시 준비해주세요.'
                        : '기존 음악의 중단을 먼저 확인해주세요.',
                }) + '\n',
              )
              continue
            }
            if (msg.type === 'state') {
              const parsed = observation.parse(msg.state)
              if (
                this.unresolved &&
                this.state.bindingId &&
                this.state.bindingId !== parsed.bindingId
              ) {
                socket.destroy()
                return
              }
              this.state = { ...parsed, connected: true, stale: false }
              this.observed = performance.now()
              this.unresolved = parsed.playing !== false
              this.notify(this.snapshot())
              const preparation = this.preparation
              if (
                preparation?.bindingId === parsed.bindingId &&
                parsed.playing === false &&
                musicTargetMatches(preparation.url, this.snapshot())
              ) {
                this.preparation = undefined
                clearTimeout(preparation.timer)
                preparation.resolve(this.snapshot())
              }
              const p = this.pending.get(msg.requestId)
              if (p) {
                clearTimeout(p.timer)
                this.pending.delete(msg.requestId)
                if (msg.error)
                  p.reject(
                    new Error(
                      msg.error === 'not-loaded' || msg.error === 'start-unavailable'
                        ? '앨범·재생목록의 재생 버튼을 찾지 못했습니다. Chrome에서 해당 목록을 다시 열거나 직접 재생한 뒤 다시 시도해주세요.'
                        : msg.error === 'autoplay-blocked'
                          ? 'Chrome에서 재생이 차단됐습니다. 유튜브 뮤직에서 재생 버튼을 한 번 누른 뒤 다시 시도해주세요.'
                          : '브라우저에서 명령을 적용하지 못했습니다.',
                    ),
                  )
                else p.resolve(this.snapshot())
              }
            }
          } catch {
            socket.destroy()
            return
          }
        }
      })
      socket.on('close', () => {
        if (this.socket !== socket) return
        this.socket = undefined
        this.state.connected = false
        this.state.stale = true
        this.state.playing = null
        for (const p of this.pending.values()) {
          clearTimeout(p.timer)
          p.reject(new Error('브라우저 연결이 끊겼습니다.'))
        }
        this.pending.clear()
        this.notify(this.snapshot())
      })
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(filename, resolve)
    })
    await fs.chmod(filename, 0o600)
    await fs.writeFile(
      path.join(this.directory, 'music-host.json'),
      JSON.stringify({ socket: filename, token: this.token }),
      { mode: 0o600 },
    )
    this.timer = setInterval(() => {
      if (this.socket) void this.command('status').catch(() => {})
      this.notify(this.snapshot())
    }, 2000)
    this.timer.unref()
  }
  snapshot(): MusicBridgeState {
    const stale = this.state.connected && performance.now() - this.observed > 6000
    return {
      ...this.state,
      sequence: ++this.sequence,
      stale: this.state.stale || stale,
      playing: stale ? null : this.state.playing,
    }
  }
  async command(
    action: 'status' | 'pause' | 'play' | 'disconnect',
    url?: string,
  ): Promise<MusicBridgeState> {
    if (action !== 'status') {
      this.preparationGeneration++
      this.cancelPreparation('음악 준비 요청이 취소되었습니다.')
    }
    if (!this.socket) {
      if (action === 'pause' && !this.unresolved) return this.snapshot()
      if (action === 'status') return this.snapshot()
      throw new Error(
        '브라우저 음악 상태를 확인할 수 없습니다. 브라우저에서 정지 여부를 확인해주세요.',
      )
    }
    if (action === 'disconnect') {
      await this.command('pause')
      this.socket?.destroy()
      this.unresolved = false
      this.state = {
        connected: false,
        stale: false,
        playing: false,
        title: '',
        videoId: '',
        listId: '',
        bindingId: '',
      }
      this.notify(this.snapshot())
      return this.snapshot()
    }
    if (action === 'play') {
      const state = this.snapshot()
      if (state.stale || !musicTargetMatches(url || '', state))
        throw new Error('브라우저에서 선택한 곡·재생목록이 다릅니다. 먼저 준비해주세요.')
    }
    if (action !== 'status') this.generation++
    const requestId = randomUUID(),
      generation = this.generation,
      timeout = action === 'play' ? 12000 : 2000
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        if (action === 'play' && generation === this.generation) {
          this.generation++
          this.socket?.write(
            JSON.stringify({
              action: 'pause',
              generation: this.generation,
              requestId: randomUUID(),
              expiresAt: Date.now() + 2000,
              bindingId: this.state.bindingId,
            }) + '\n',
          )
        }
        reject(new Error('브라우저 응답을 확인하지 못했습니다. 음악이 계속 나올 수 있습니다.'))
      }, timeout)
      this.pending.set(requestId, {
        resolve: (state) => {
          if (action !== 'status' && generation !== this.generation) {
            reject(new Error('음악 요청이 변경되었습니다.'))
            return
          }
          if (
            (action === 'play' &&
              (state.playing !== true || !musicTargetMatches(url || '', state, false))) ||
            (action === 'pause' && state.playing !== false)
          ) {
            reject(new Error('음악 상태가 확인되지 않았습니다.'))
            return
          }
          resolve(state)
        },
        reject,
        timer,
      })
      this.socket!.write(
        JSON.stringify({
          action,
          requestId,
          generation,
          expiresAt: Date.now() + timeout,
          bindingId: this.state.bindingId,
          ...(action === 'play' ? { url: musicURL(url || '') } : {}),
        }) + '\n',
      )
    })
  }
  confirmStopped(bindingId: string) {
    const state = this.snapshot()
    if (!state.stale || !bindingId || state.bindingId !== bindingId)
      throw new Error('외부 상태가 바뀌었습니다. 다시 확인해주세요.')
    this.socket?.destroy()
    this.socket = undefined
    this.unresolved = false
    this.state = {
      connected: false,
      stale: false,
      playing: false,
      title: '',
      videoId: '',
      listId: '',
      bindingId: '',
    }
    this.notify(this.snapshot())
    return this.snapshot()
  }
  async setup(extensionId: string, executable: string, helper: string, home: string) {
    if (!this.server?.listening)
      throw new Error('브라우저 연결 준비에 실패했습니다. 앱을 다시 실행해주세요.')
    if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Chrome 확장 프로그램 ID를 확인해주세요.')
    const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'"
    const launcher = path.join(this.directory, 'music-host.sh')
    await fs.writeFile(
      launcher,
      `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(executable)} ${quote(helper)} ${quote(path.join(this.directory, 'music-host.json'))}\n`,
      { mode: 0o700 },
    )
    await fs.chmod(launcher, 0o700)
    const manifest = path.join(
      home,
      'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.propre.music.json',
    )
    await fs.mkdir(path.dirname(manifest), { recursive: true })
    await fs.writeFile(
      manifest,
      JSON.stringify({
        name: 'com.propre.music',
        description: 'ProPre 음악 연결',
        path: launcher,
        type: 'stdio',
        allowed_origins: [`chrome-extension://${extensionId}/`],
      }),
      { mode: 0o600 },
    )
  }
  close() {
    this.cancelPreparation('앱 연결이 종료되었습니다.')
    clearInterval(this.timer)
    this.socket?.destroy()
    this.server?.close()
  }
}
