import fs from 'node:fs/promises'
import path from 'node:path'
import { build, Platform } from 'electron-builder'
import { updateBuildConfig, updateManifest } from './update-build-config.mjs'
const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'))
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch))
  throw new Error('The free release target is macOS arm64/x64.')
const config = updateBuildConfig(pkg.build)
// Prepare unsigned files only. Rights/platform review still gates the release command.
const artifacts = await build({ targets: Platform.MAC.createTarget(), config, publish: 'never' })
const dmg = artifacts.find((file) => file.endsWith('.dmg'))
if (!dmg) throw new Error('A DMG artifact was not generated.')
const manifestFile = path.join(path.dirname(dmg), 'propre-update.json')
const manifest = updateManifest(pkg.version, path.basename(dmg), process.arch)
try {
  const previous = JSON.parse(await fs.readFile(manifestFile, 'utf8'))
  if (previous.schemaVersion === 1 && previous.version === manifest.version)
    manifest.downloads = { ...previous.downloads, ...manifest.downloads }
} catch {
  /* The first build has no previous manifest. */
}
await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n')
console.log(
  'Free distribution files prepared. Upload the DMG before propre-update.json. No files were published.',
)
