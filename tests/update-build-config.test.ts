import { expect, it } from 'vitest'
// @ts-expect-error Build tooling is a Node ESM module.
import {
  updateBuildConfig,
  updateManifest,
  DEFAULT_UPDATE_URL,
} from '../scripts/update-build-config.mjs'
it('prepares unsigned/unnotarized files with a bundled free update feed and no publisher', () => {
  const config = updateBuildConfig(
    { appId: 'com.propre.presenter', mac: { icon: 'build/icon.icns' } },
    {},
  )
  expect(config.publish).toBeNull()
  expect(config.extraMetadata.propreUpdates.feedURL).toBe(DEFAULT_UPDATE_URL + 'propre-update.json')
  expect(config.mac).toMatchObject({
    target: ['dmg', 'zip'],
    forceCodeSigning: false,
    identity: null,
    notarize: false,
    icon: 'build/icon.icns',
  })
})
it('creates a numeric stable version manifest with the exact encoded DMG filename', () => {
  const result = updateManifest('0.2.0', 'ProPre 0.2.0-arm64.dmg', 'arm64', {
    PROPRE_UPDATE_URL: 'https://downloads.example.org/propre',
  })
  expect(result).toEqual({
    schemaVersion: 1,
    version: '0.2.0',
    downloads: { 'mac-arm64': 'https://downloads.example.org/propre/ProPre%200.2.0-arm64.dmg' },
  })
})
it.each([
  '',
  'http://example.org',
  'https://user:secret@example.org',
  'https://example.org?token=secret',
  'https://example.org/#test',
])('rejects unsafe feed %s', (url) => {
  expect(() => updateBuildConfig({}, { PROPRE_UPDATE_URL: url })).toThrow('PROPRE_UPDATE_URL')
})
it.each([
  ['0.2.0-beta.1', 'a.dmg', 'arm64'],
  ['0.2.0', '../a.dmg', 'arm64'],
  ['0.2.0', 'a.exe', 'arm64'],
  ['0.2.0', 'a.dmg', 'linux'],
])('rejects unsupported version, path, or CPU', (version, file, arch) => {
  expect(() => updateManifest(version, file, arch, {})).toThrow()
})
