import fs from 'node:fs/promises'
import path from 'node:path'
const directory = path.resolve('dist/assets'), files = await fs.readdir(directory)
const scripts = await Promise.all(files.filter(f => f.endsWith('.js')).map(async name => ({name,bytes:(await fs.stat(path.join(directory,name))).size})))
// PDF inspection loads its parser and worker only for a selected source. Keep
// the existing control/output budget independent of this optional document path.
const pdf = scripts.filter(s => /^pdf(?:\.worker\.min)?-/.test(s.name))
const core = scripts.filter(s => !pdf.includes(s))
const total = core.reduce((sum,s) => sum+s.bytes,0)
if (core.some(s => s.bytes > 700000) || total > 700000) throw new Error(`Renderer JavaScript budget exceeded: ${total} bytes`)
if (pdf.some(s => s.bytes > (s.name.startsWith('pdf.worker') ? 1200000 : 500000))) throw new Error('Optional PDF viewer budget exceeded')
console.log(`Renderer JavaScript budget passed: ${total} bytes; optional PDF parser/worker ${pdf.reduce((n,s) => n+s.bytes,0)} bytes.`)
