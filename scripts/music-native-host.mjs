// Chrome starts this helper. stdout is reserved for Native Messaging frames.
import fs from 'node:fs'
import net from 'node:net'
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const socket = net.createConnection(config.socket)
let input = Buffer.alloc(0),
  lines = ''
const send = (value) => {
  const body = Buffer.from(JSON.stringify(value))
  if (body.length > 65536) return
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length)
  process.stdout.write(Buffer.concat([header, body]))
}
socket.on('connect', () => socket.write(JSON.stringify({ token: config.token }) + '\n'))
socket.on('data', (data) => {
  lines += data.toString()
  if (Buffer.byteLength(lines) > 65536) {
    socket.destroy()
    return
  }
  let n
  while ((n = lines.indexOf('\n')) >= 0) {
    try {
      send(JSON.parse(lines.slice(0, n)))
    } catch {
      socket.destroy()
    }
    lines = lines.slice(n + 1)
  }
})
process.stdin.on('data', (data) => {
  input = Buffer.concat([input, data])
  while (input.length >= 4) {
    const n = input.readUInt32LE(0)
    if (n > 65536) {
      process.exit(1)
    }
    if (input.length < n + 4) return
    try {
      const message = JSON.parse(input.subarray(4, n + 4).toString())
      socket.write(JSON.stringify(message) + '\n')
    } catch {
      process.exit(1)
    }
    input = input.subarray(n + 4)
  }
})
process.stdin.on('end', () => socket.end())
socket.on('error', () => process.exit(1))
socket.on('close', () => process.exit(0))
