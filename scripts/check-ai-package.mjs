import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

if (process.platform !== 'darwin') {
  console.log('Packaged MCP adapter check applies to the supported macOS package.')
  process.exit(0)
}
const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'))
const contents = path.resolve(`release/${pkg.version}/mac-${process.arch}/ProPre.app/Contents`)
const executable = path.join(contents, 'MacOS', 'ProPre')
const bridge = path.join(contents, 'Resources', 'app.asar', 'scripts', 'propre-mcp.mjs')
await fs.access(executable)
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-package-mcp-'))
const token = randomBytes(32).toString('hex')
const client = new Client({ name: 'package-bridge-check', version: '1' })
const server = createServer((req, res) => {
  void (async () => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401)
      res.end()
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (body.method.startsWith('notifications/')) {
      res.writeHead(202)
      res.end()
      return
    }
    const mcp = new McpServer({ name: 'synthetic-package-check', version: '1' })
    mcp.registerTool(
      'get_app_state',
      { inputSchema: {}, annotations: { readOnlyHint: true } },
      async () => ({
        structuredContent: { synthetic: true },
        content: [{ type: 'text', text: 'Synthetic packaged adapter check' }],
      }),
    )
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    await mcp.connect(transport)
    try {
      await transport.handleRequest(req, res, body)
    } finally {
      await mcp.close()
    }
  })().catch(() => {
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
})
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const connectionFile = path.join(directory, 'ai-connection.json')
  await fs.writeFile(
    connectionFile,
    JSON.stringify({
      version: 1,
      endpoint: `http://127.0.0.1:${address.port}/mcp`,
      token,
      session: randomUUID(),
    }),
    { mode: 0o600 },
  )
  // Runs only the bundled Node adapter; never launches the user's packaged GUI or workspace.
  await client.connect(
    new StdioClientTransport({
      command: executable,
      args: [bridge, connectionFile],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      stderr: 'pipe',
    }),
  )
  const result = await client.callTool({ name: 'get_app_state', arguments: {} })
  if (result.isError || result.structuredContent?.synthetic !== true)
    throw new Error('Packaged adapter validation failed.')
  console.log('Packaged app stdio adapter initialized and called a synthetic tool.')
} finally {
  await client.close().catch(() => {})
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await fs.rm(directory, { recursive: true, force: true })
}
