import { z } from 'zod'

const stableVersion = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/
export const UpdateManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: z.string().regex(stableVersion),
    downloads: z
      .object({
        'mac-arm64': z.string().max(2048).optional(),
        'mac-x64': z.string().max(2048).optional(),
      })
      .strict(),
  })
  .strict()
export type UpdatePlatform = 'mac-arm64' | 'mac-x64'
export interface AppUpdateState {
  revision: number
  currentVersion: string
  status: 'disabled' | 'idle' | 'checking' | 'available' | 'opening' | 'download-opened' | 'error'
  version?: string
  checkedAt?: string
  message?: string
}
export function safeUpdateURL(value: string, allowQuery = false): URL {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (!allowQuery && url.search)
  )
    throw new Error('업데이트 주소가 올바르지 않습니다.')
  return url
}
export function isNewerVersion(candidate: string, current: string): boolean {
  if (!stableVersion.test(candidate) || !stableVersion.test(current)) return false
  const next = candidate.split('.').map(Number),
    previous = current.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (next[i] !== previous[i]) return next[i] > previous[i]
  }
  return false
}
