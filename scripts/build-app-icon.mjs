import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep every macOS representation in the ICNS, including Retina Dock sizes.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'build/icon.png')
if (process.platform !== 'darwin')
  throw new Error('ICNS generation requires macOS sips and iconutil.')
const dimensions = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', source], {
  encoding: 'utf8',
})
const width = Number(dimensions.match(/pixelWidth: (\d+)/)?.[1])
const height = Number(dimensions.match(/pixelHeight: (\d+)/)?.[1])
if (width !== height || width < 1024) throw new Error('Use a square PNG of at least 1024px.')
const scratch = mkdtempSync(path.join(tmpdir(), 'propre-icon-'))
const iconset = path.join(scratch, 'ProPre.iconset')
try {
  const { mkdirSync } = await import('node:fs')
  mkdirSync(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      execFileSync(
        'sips',
        [
          '-z',
          String(size * scale),
          String(size * scale),
          source,
          '--out',
          path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`),
        ],
        { stdio: 'pipe' },
      )
    }
  }
  execFileSync('iconutil', [
    '--convert',
    'icns',
    iconset,
    '--output',
    path.join(root, 'build/icon.icns'),
  ])
  console.log('Generated build/icon.icns with 16–1024px representations.')
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
