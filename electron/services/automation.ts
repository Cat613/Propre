import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  AI_RECEIPT_LIMIT,
  AI_REQUEST_BYTES,
  AI_TOOL_INFO,
  AI_TOOL_SCHEMAS,
  AI_WRITE_TOOLS,
  PreparationError,
  type AICommand,
  type AICommandResult,
  type AIConnectionState,
  type AIPermission,
  type AITool,
  type PreparedPreview,
} from '../../shared/automation'
import { atomicWrite } from './repository'

export class AutomationService {
  private listener: Server | undefined
  private token = ''
  private epoch = ''
  private permission: AIPermission = 'read'
  private activeRequests = 0
  private lastActivityAt: string | null = null
  private lastOperation: AIConnectionState['lastOperation'] = null
  private clients = new Map<string, number>()
  private receipts = new Map<string, { signature: string; promise: Promise<CallToolResult> }>()
  private tail: Promise<unknown> = Promise.resolve()
  private pending = new Map<string, { epoch: string; write: boolean }>()
  private lifecycle: Promise<unknown> = Promise.resolve()
  readonly connectionFile: string
  constructor(
    directory: string,
    private dispatch: (command: AICommand) => Promise<AICommandResult>,
    private preview: (snapshot: PreparedPreview) => Promise<string>,
    private notify: (state: AIConnectionState) => void = () => {},
  ) {
    this.connectionFile = path.join(directory, 'ai-connection.json')
  }
  state(): AIConnectionState {
    const now = Date.now()
    for (const [client, seen] of this.clients) if (now - seen > 90000) this.clients.delete(client)
    return {
      enabled: !!this.listener,
      permission: this.permission,
      connected: this.clients.size > 0,
      lastActivityAt: this.lastActivityAt,
      lastOperation: this.lastOperation,
    }
  }
  async initialize() {
    await fs.rm(this.connectionFile, { force: true })
  }
  setEnabled(enabled: boolean, permission: AIPermission): Promise<AIConnectionState> {
    const operation = this.lifecycle
      .catch(() => {})
      .then(async () => {
        // A permission change is a fresh session; old credentials cannot retain write access.
        await this.stop()
        this.permission = permission
        if (enabled) await this.start()
        this.notify(this.state())
        return this.state()
      })
    this.lifecycle = operation
    return operation
  }
  private async start() {
    this.token = randomBytes(32).toString('hex')
    this.epoch = randomUUID()
    const epoch = this.epoch
    this.receipts.clear()
    this.clients.clear()
    this.lastActivityAt = null
    this.lastOperation = null
    const server = createServer((req, res) => {
      void this.handle(req, res, epoch).catch(() => {
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
    })
    server.requestTimeout = 30000
    server.headersTimeout = 10000
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
          server.off('error', reject)
          resolve()
        })
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('address')
      await atomicWrite(
        this.connectionFile,
        JSON.stringify({
          version: 1,
          endpoint: `http://127.0.0.1:${address.port}/mcp`,
          token: this.token,
          session: this.epoch,
        }),
      )
      this.listener = server
    } catch {
      server.closeAllConnections()
      server.close()
      this.token = ''
      await fs.rm(this.connectionFile, { force: true }).catch(() => {})
      throw new Error('AI 연결을 시작하지 못했습니다. 저장소 접근 권한을 확인해주세요.')
    }
  }
  async stop(): Promise<void> {
    const server = this.listener
    this.listener = undefined
    this.token = ''
    this.epoch = ''
    this.clients.clear()
    try {
      await fs.rm(this.connectionFile, { force: true })
    } finally {
      if (server) {
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }
  }
  authorizeCommand(id: string): boolean {
    const request = this.pending.get(id)
    return (
      !!request &&
      !!this.listener &&
      request.epoch === this.epoch &&
      (!request.write || this.permission === 'prepare')
    )
  }
  private reject(res: ServerResponse, status: number) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ error: 'ProPre AI connection request rejected.' }))
  }
  private async handle(req: IncomingMessage, res: ServerResponse, epoch: string) {
    const address = this.listener?.address()
    if (!address || typeof address === 'string' || epoch !== this.epoch)
      return this.reject(res, 401)
    const host = `127.0.0.1:${address.port}`
    if (req.headers.host !== host || req.url !== '/mcp') return this.reject(res, 403)
    if (req.headers.origin && req.headers.origin !== `http://${host}`) return this.reject(res, 403)
    const provided = Buffer.from(req.headers.authorization || ''),
      expected = Buffer.from(`Bearer ${this.token}`)
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
      return this.reject(res, 401)
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' })
      return res.end()
    }
    if (!req.headers['content-type']?.startsWith('application/json')) return this.reject(res, 415)
    if (this.activeRequests >= 8) return this.reject(res, 429)
    if (Number(req.headers['content-length'] || 0) > AI_REQUEST_BYTES) return this.reject(res, 413)
    this.activeRequests++
    let mcp: McpServer | undefined
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > AI_REQUEST_BYTES) return this.reject(res, 413)
        chunks.push(Buffer.from(chunk))
      }
      let body: unknown
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return this.reject(res, 400)
      }
      if (!this.listener || epoch !== this.epoch) return this.reject(res, 401)
      const clientHeader = req.headers['x-propre-client']
      const client =
        typeof clientHeader === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(clientHeader)
          ? clientHeader
          : 'http-client'
      if (
        body &&
        typeof body === 'object' &&
        'method' in body &&
        body.method === 'notifications/propre-disconnected'
      ) {
        this.clients.delete(client)
        this.notify(this.state())
        res.writeHead(202)
        return res.end()
      }
      this.clients.set(client, Date.now())
      this.lastActivityAt = new Date().toISOString()
      this.notify(this.state())
      mcp = this.createMCP(epoch)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      await mcp.connect(transport)
      await transport.handleRequest(req, res, body)
    } finally {
      this.activeRequests--
      await mcp?.close().catch(() => {})
    }
  }
  private createMCP(epoch: string): McpServer {
    const mcp = new McpServer(
      { name: 'propre', version: '0.1.0' },
      {
        instructions:
          'Prepare ProPre materials without changing live output. Check get_app_state first. Before editing, read get_presentation or get_playlist and use its revision. Mutations require a UUID requestId; identical retries within this connection session reuse the result. After reconnection, re-read before deciding to create. Close operator input/modals before writes. get_preview is preparation-only. Use lookup_bible for source text. No live transmission, deletion, arbitrary file access, or external requests are supported.',
      },
    )
    for (const tool of Object.keys(AI_TOOL_SCHEMAS) as AITool[]) {
      mcp.registerTool(
        tool,
        {
          ...AI_TOOL_INFO[tool],
          inputSchema: AI_TOOL_SCHEMAS[tool],
          annotations: {
            readOnlyHint: !AI_WRITE_TOOLS.has(tool),
            destructiveHint: tool === 'update_presentation' || tool === 'set_playlist',
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async (args: unknown) => this.execute(tool, args, epoch),
      )
    }
    return mcp
  }
  private error(code: string, message: string, applied = false): CallToolResult {
    return {
      isError: true,
      structuredContent: { error: { code, message, applied } },
      content: [{ type: 'text', text: `${code}: ${message}` }],
    }
  }
  private execute(tool: AITool, args: unknown, epoch: string): Promise<CallToolResult> {
    if (!this.listener || epoch !== this.epoch)
      return Promise.resolve(this.error('CONNECTION_REVOKED', 'AI 연결이 해제되었습니다.'))
    if (AI_WRITE_TOOLS.has(tool) && this.permission !== 'prepare')
      return Promise.resolve(
        this.error(
          'PERMISSION_DENIED',
          '조회만 허용된 연결입니다. 앱 설정에서 자료 준비를 허용해주세요.',
        ),
      )
    const parsed = AI_TOOL_SCHEMAS[tool].parse(args)
    const requestId = 'requestId' in parsed ? parsed.requestId : undefined
    const signature = createHash('sha256')
      .update(JSON.stringify({ tool, args: parsed }))
      .digest('hex')
    if (requestId) {
      const previous = this.receipts.get(requestId)
      if (previous)
        return previous.signature === signature
          ? previous.promise
          : Promise.resolve(
              this.error('REQUEST_ID_REUSED', '같은 requestId를 다른 작업에 사용할 수 없습니다.'),
            )
      if (this.receipts.size >= AI_RECEIPT_LIMIT)
        return Promise.resolve(
          this.error(
            'SESSION_LIMIT',
            '세션 작업 한도에 도달했습니다. 연결을 다시 허용하고 자료를 재조회해주세요.',
          ),
        )
    }
    const operation = this.tail
      .catch(() => {})
      .then(async () => {
        if (!this.listener || epoch !== this.epoch)
          return this.error('CONNECTION_REVOKED', 'AI 연결이 해제되었습니다.')
        const id = randomUUID()
        this.pending.set(id, { epoch, write: AI_WRITE_TOOLS.has(tool) })
        let result: CallToolResult
        try {
          const response = await this.dispatch({ id, session: epoch, tool, arguments: parsed })
          if (response.error)
            result = this.error(response.error.code, response.error.message, response.error.applied)
          else {
            const data = response.data || {}
            const content: CallToolResult['content'] = [
              { type: 'text', text: JSON.stringify(data) },
            ]
            if (response.preview)
              content.push({
                type: 'image',
                data: await this.preview(response.preview),
                mimeType: 'image/png',
              })
            result = { structuredContent: data, content }
          }
        } catch (e) {
          result =
            e instanceof PreparationError
              ? this.error(e.code, e.message, e.applied)
              : this.error(
                  'RESULT_UNCERTAIN',
                  '작업 결과를 확인하지 못했습니다. 같은 requestId로 결과를 확인하거나 앱 상태를 조회해주세요.',
                )
        } finally {
          this.pending.delete(id)
        }
        if (epoch === this.epoch) {
          this.lastOperation = {
            tool,
            status: result.isError ? 'error' : 'completed',
            at: new Date().toISOString(),
          }
          this.notify(this.state())
        }
        return result
      })
    this.tail = operation
    if (requestId) this.receipts.set(requestId, { signature, promise: operation })
    return operation
  }
}
