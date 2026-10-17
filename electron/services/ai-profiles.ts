import { safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { ConnectionProfileSchema, type ConnectionProfile } from '../../shared/song-preparation'
import { atomicWrite } from './repository'
import type { KeyVault } from './security'
const ProfileState = z.object({
  profiles: z.array(ConnectionProfileSchema).max(30),
  keys: z.record(z.string(), z.string()),
  defaultId: z.string().nullable(),
})
export class AIProfiles {
  private blocked = false
  private state: z.infer<typeof ProfileState> = { profiles: [], keys: {}, defaultId: null }
  constructor(
    private directory: string,
    private legacy: KeyVault,
  ) {}
  async open() {
    try {
      this.state = ProfileState.parse(
        JSON.parse(await fs.readFile(path.join(this.directory, 'ai-profiles-v1.json'), 'utf8')),
      )
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.blocked = true
        throw new Error('AI 연결 설정을 읽지 못했습니다. 기존 설정 파일을 확인해주세요.')
      }
      const profile: ConnectionProfile = {
        id: 'legacy-gemini',
        name: 'Gemini',
        provider: 'gemini',
        model: 'gemini-3.8-flash',
      }
      this.state.profiles = [profile]
      this.state.defaultId = profile.id
    }
  }
  list() {
    return {
      profiles: this.state.profiles.map((p) => ({ ...p, configured: this.configured(p.id) })),
      defaultId: this.state.defaultId,
    }
  }
  private available() {
    return (
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
    )
  }
  private configured(id: string) {
    try {
      return !!this.key(id)
    } catch {
      return false
    }
  }
  get(id: string) {
    const p = this.state.profiles.find((p) => p.id === id)
    if (!p) throw new Error('AI 연결을 선택해주세요.')
    return structuredClone(p)
  }
  key(id: string, expectedProvider?: string) {
    const profile = this.get(id)
    if (expectedProvider && profile.provider !== expectedProvider)
      throw new Error('AI 연결 제공자가 변경되었습니다. 연결을 다시 선택해주세요.')
    const encrypted = this.state.keys[id]
    if (encrypted && this.available())
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    if (id === 'legacy-gemini' && profile.provider === 'gemini') return this.legacy.get()
    throw new Error('이 AI 연결의 API 키를 등록해주세요.')
  }
  private tail: Promise<unknown> = Promise.resolve()
  async save(raw: unknown, key: unknown, defaultConnection: unknown) {
    if (this.blocked) throw new Error('AI 설정 파일을 복구한 뒤 다시 등록해주세요.')
    const p = ConnectionProfileSchema.parse(raw),
      secret = z.string().trim().min(10).max(500).nullable().parse(key),
      selectDefault = z.boolean().parse(defaultConnection)
    this.tail = this.tail
      .catch(() => {})
      .then(async () => {
        const next = structuredClone(this.state)
        if (next.profiles.some((old) => old.id === p.id && old.provider !== p.provider))
          delete next.keys[p.id]
        next.profiles = next.profiles.filter((x) => x.id !== p.id).concat(p)
        if (secret) {
          if (!this.available()) throw new Error('운영체제 보호 저장소를 사용할 수 없습니다.')
          next.keys[p.id] = safeStorage.encryptString(secret).toString('base64')
        }
        if (selectDefault || !next.defaultId) next.defaultId = p.id
        ProfileState.parse(next)
        await atomicWrite(path.join(this.directory, 'ai-profiles-v1.json'), JSON.stringify(next))
        this.state = next
      })
    await this.tail
    return this.list()
  }
  async remove(id: string) {
    if (this.blocked) throw new Error('AI 설정 파일을 복구한 뒤 다시 등록해주세요.')
    this.tail = this.tail
      .catch(() => {})
      .then(async () => {
        const next = structuredClone(this.state)
        next.profiles = next.profiles.filter((p) => p.id !== id)
        delete next.keys[id]
        if (next.defaultId === id) next.defaultId = next.profiles[0]?.id || null
        await atomicWrite(path.join(this.directory, 'ai-profiles-v1.json'), JSON.stringify(next))
        this.state = next
      })
    await this.tail
    return this.list()
  }
}
