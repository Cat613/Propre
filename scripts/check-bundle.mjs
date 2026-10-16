import fs from 'node:fs/promises'
import path from 'node:path'
const directory = path.resolve('dist/assets'), files = await fs.readdir(directory)
const scripts = await Promise.all(files.filter(f => f.endsWith('.js')).map(async name => ({name,bytes:(await fs.stat(path.join(directory,name))).size})))
// Keep the original 700 KB budget for shared Control/Main/Stage code. Detail
// dialogs are dynamic imports, loaded only when the operator opens that flow.
const pdf = scripts.filter(s => /^pdf(?:\.worker\.min)?-/.test(s.name))
const worship = scripts.filter(s => /^(ServicePlanPanel|PreflightDialog|ServiceTemplatesDialog|CueSheetExportDialog)-/.test(s.name))
const core = scripts.filter(s => !pdf.includes(s) && !worship.includes(s))
const total = core.reduce((sum,s) => sum+s.bytes,0), detailTotal = worship.reduce((sum,s) => sum+s.bytes,0)
if (core.some(s => s.bytes > 700000) || total > 700000) throw new Error(`Renderer JavaScript budget exceeded: ${total} bytes`)
if (worship.some(s => s.bytes > 100000) || detailTotal > 180000) throw new Error(`Optional worship detail budget exceeded: ${detailTotal} bytes`)
if (pdf.some(s => s.bytes > (s.name.startsWith('pdf.worker') ? 1200000 : 500000))) throw new Error('Optional PDF viewer budget exceeded')
console.log(`Renderer JavaScript budget passed: core ${total} bytes; optional worship details ${detailTotal} bytes; optional PDF parser/worker ${pdf.reduce((n,s) => n+s.bytes,0)} bytes.`)
