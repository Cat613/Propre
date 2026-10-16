export const DEFAULT_UPDATE_URL = 'https://github.com/Cat613/Propre/releases/latest/download/'
export function updateDirectory(env = process.env) {
  let url
  try {
    url = new URL(env.PROPRE_UPDATE_URL ?? DEFAULT_UPDATE_URL)
  } catch {
    throw new Error('PROPRE_UPDATE_URL must be an HTTPS update directory URL.')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('PROPRE_UPDATE_URL must use HTTPS without credentials, query or fragment.')
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}
export function updateBuildConfig(base, env = process.env) {
  const url = updateDirectory(env)
  return {
    ...base,
    publish: null,
    forceCodeSigning: false,
    extraMetadata: {
      ...base.extraMetadata,
      propreUpdates: { feedURL: new URL('propre-update.json', url).href },
    },
    mac: {
      ...base.mac,
      target: ['dmg', 'zip'],
      identity: null,
      forceCodeSigning: false,
      notarize: false,
    },
  }
}
export function updateManifest(version, filename, arch, env = process.env) {
  if (
    !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(version) ||
    !['arm64', 'x64'].includes(arch) ||
    !filename.endsWith('.dmg') ||
    /[\\/]/.test(filename)
  )
    throw new Error('A stable version and a macOS DMG filename/architecture are required.')
  return {
    schemaVersion: 1,
    version,
    downloads: {
      [`mac-${arch}`]: new URL(encodeURIComponent(filename), updateDirectory(env)).href,
    },
  }
}
