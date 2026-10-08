import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { request } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { AutomationService } from '../electron/services/automation'
import { AI_REQUEST_BYTES, type AICommand, type AICommandResult } from '../shared/automation'
let dir: string, service: AutomationService, endpoint: string, token: string
const clients: Client[] = []
const dispatch = vi.fn<(command: AICommand) => Promise<AICommandResult>>()
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg=='
async function connect(permission: 'read' | 'prepare' = 'prepare') {
  await service.setEnabled(true, permission)
  const connection = JSON.parse(await fs.readFile(service.connectionFile, 'utf8'))
  endpoint = connection.endpoint
  token = connection.token
  const client = new Client({ name: 'propre-test', version: '1' })
  clients.push(client)
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  )
  return client
}
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-mcp-'))
  dispatch
    .mockReset()
    .mockImplementation(async (command) => ({ data: { tool: command.tool, saved: true } }))
  service = new AutomationService(dir, dispatch, async () => png)
  await service.initialize()
})
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => {})))
  await service.stop()
  await fs.rm(dir, { recursive: true, force: true })
})
const create = (id = randomUUID()) => ({
  requestId: id,
  title: '합성 준비 자료',
  slides: [{ content: '합성 본문' }],
})
describe('local MCP protocol and authorization', () => {
  it('discovers annotated tools and rejects malformed inputs before dispatch', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(9)
    expect(tools.find((t) => t.name === 'get_preview')?.annotations?.readOnlyHint).toBe(true)
    const bad = await client.callTool({
      name: 'create_presentation',
      arguments: { ...create(), requestId: 'not-a-uuid' },
    })
    expect(bad.isError).toBe(true)
    expect(dispatch).not.toHaveBeenCalled()
    const good = await client.callTool({ name: 'get_app_state', arguments: {} })
    expect(good.isError).not.toBe(true)
    expect(service.state().connected).toBe(true)
  })
  it('read permission blocks mutations on the server, including direct calls', async () => {
    const client = await connect('read')
    const result = await client.callTool({ name: 'create_presentation', arguments: create() })
    expect(result.structuredContent).toMatchObject({ error: { code: 'PERMISSION_DENIED' } })
    expect(dispatch).not.toHaveBeenCalled()
  })
  it('coalesces concurrent identical requests and rejects reuse with changed inputs', async () => {
    const client = await connect(),
      args = create()
    let release!: () => void
    dispatch.mockImplementationOnce(async (command) => {
      expect(service.authorizeCommand(command.id)).toBe(true)
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { data: { id: 'new', saved: true } }
    })
    const first = client.callTool({ name: 'create_presentation', arguments: args })
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    const second = client.callTool({ name: 'create_presentation', arguments: args })
    release()
    expect(await first).toEqual(await second)
    expect(dispatch).toHaveBeenCalledTimes(1)
    const reused = await client.callTool({
      name: 'create_presentation',
      arguments: { ...args, title: '다른 작업' },
    })
    expect(reused.structuredContent).toMatchObject({ error: { code: 'REQUEST_ID_REUSED' } })
  })
  it('never reexecutes an uncertain mutation on retry', async () => {
    const client = await connect(),
      args = create()
    dispatch.mockRejectedValueOnce(new Error('control crashed'))
    const first = await client.callTool({ name: 'create_presentation', arguments: args })
    expect(first.structuredContent).toMatchObject({ error: { code: 'RESULT_UNCERTAIN' } })
    expect(await client.callTool({ name: 'create_presentation', arguments: args })).toEqual(first)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
  it('rejects forged origins, hosts, missing credentials and oversized bodies', async () => {
    await connect()
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    expect(
      (
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await fetch(endpoint, {
          method: 'POST',
          headers: { ...headers, Origin: 'https://attacker.invalid' },
          body: '{}',
        })
      ).status,
    ).toBe(403)
    const forgedHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        endpoint,
        { method: 'POST', headers: { ...headers, Host: 'attacker.invalid' } },
        (res) => {
          res.resume()
          resolve(res.statusCode)
        },
      )
      req.on('error', reject)
      req.end('{}')
    })
    expect(forgedHostStatus).toBe(403)
    expect(
      (await fetch(endpoint, { method: 'POST', headers, body: 'x'.repeat(AI_REQUEST_BYTES + 1) }))
        .status,
    ).toBe(413)
    expect((await fetch(endpoint, { method: 'POST', headers, body: '{invalid' })).status).toBe(400)
  })
  it('revokes credentials and queued writes when the permission session changes', async () => {
    const client = await connect()
    let release!: () => void
    dispatch.mockImplementationOnce(async (command) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { data: { authorizedAfterRevoke: service.authorizeCommand(command.id) } }
    })
    const pending = client
      .callTool({ name: 'create_presentation', arguments: create() })
      .catch(() => null)
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    const previous = { endpoint, token }
    await service.setEnabled(true, 'read')
    release()
    await pending
    const fresh = JSON.parse(await fs.readFile(service.connectionFile, 'utf8'))
    expect(fresh.token === previous.token).toBe(false)
    expect(
      (
        await fetch(fresh.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${previous.token}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
      ).status,
    ).toBe(401)
    expect(service.state().permission).toBe('read')
  })
  it('uses an owner-only session file and removes it on stop/startup', async () => {
    expect(service.state().enabled).toBe(false)
    await connect()
    expect((await fs.stat(service.connectionFile)).mode & 0o077).toBe(0)
    await service.stop()
    await expect(fs.stat(service.connectionFile)).rejects.toThrow()
    await fs.writeFile(service.connectionFile, 'stale')
    await service.initialize()
    await expect(fs.stat(service.connectionFile)).rejects.toThrow()
  })
  it('connects through the shipped stdio adapter without putting credentials in its arguments', async () => {
    await connect()
    const client = new Client({ name: 'stdio-test', version: '1' })
    clients.push(client)
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [path.resolve('scripts/propre-mcp.mjs'), service.connectionFile],
        stderr: 'pipe',
      }),
    )
    expect((await client.listTools()).tools).toHaveLength(9)
    expect((await client.callTool({ name: 'get_app_state', arguments: {} })).isError).not.toBe(true)
    await service.setEnabled(false, 'read')
    await expect(client.callTool({ name: 'get_app_state', arguments: {} })).rejects.toThrow(
      /connection unavailable/,
    )
  })
})
