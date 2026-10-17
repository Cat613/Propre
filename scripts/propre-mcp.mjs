// MCP stdio adapter. Only JSON-RPC messages are written to stdout.
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import readline from 'node:readline'
const filename = process.argv[2]
const client = randomUUID()
let protocolVersion
let session
let tail = Promise.resolve()
const output = (value) => process.stdout.write(JSON.stringify(value) + '\n')
async function connection() {
  const stat = await fs.lstat(filename)
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 4096 ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
    (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
  )
    throw new Error('connection')
  const value = JSON.parse(await fs.readFile(filename, 'utf8'))
  const url = new URL(value.endpoint)
  if (
    value.version !== 1 ||
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/mcp' ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^[a-f0-9]{64}$/.test(value.token) ||
    typeof value.session !== 'string'
  )
    throw new Error('connection')
  if (session && value.session !== session) throw new Error('session')
  session = value.session
  return value
}
async function forward(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    output({
      jsonrpc: '2.0',
      id: message?.id ?? null,
      error: { code: -32600, message: 'Invalid request' },
    })
    return
  }
  try {
    const { endpoint, token } = await connection()
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        'X-ProPre-Client': client,
        ...(protocolVersion ? { 'MCP-Protocol-Version': protocolVersion } : {}),
      },
      body: JSON.stringify(message),
      redirect: 'error',
      signal: AbortSignal.timeout(25000),
    })
    if (!response.ok) throw new Error('connection')
    if (response.status === 202 || message.id === undefined) return
    const result = await response.json()
    if (message.method === 'initialize' && result.result?.protocolVersion)
      protocolVersion = result.result.protocolVersion
    output(result)
  } catch {
    if (message.id !== undefined)
      output({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32001,
          message:
            'ProPre connection unavailable or changed. Open ProPre, allow AI connection in Settings, and reconnect this MCP server. Re-read app state before starting new work.',
        },
      })
  }
}
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', (line) => {
  if (Buffer.byteLength(line) > 1024 * 1024) {
    output({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } })
    return
  }
  let message
  try {
    message = JSON.parse(line)
  } catch {
    output({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    return
  }
  tail = tail.catch(() => {}).then(() => forward(message))
})
// Presence updates are notifications, never unsolicited stdio responses.
const presence = setInterval(() => {
  tail = tail
    .catch(() => {})
    .then(() => forward({ jsonrpc: '2.0', method: 'notifications/propre-connected' }))
}, 30000)
presence.unref()
lines.on('close', () => {
  clearInterval(presence)
  void tail.finally(async () => {
    await forward({ jsonrpc: '2.0', method: 'notifications/propre-disconnected' })
    process.exit(0)
  })
})
