import { safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from './repository'
export class KeyVault {
  private encrypted: string | null = null
  constructor(private directory: string) {}
  private available(): boolean {
    return (
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
    )
  }
  async open(): Promise<void> {
    const file = path.join(this.directory, 'key-v1.json')
    try {
      const saved = JSON.parse(await fs.readFile(file, 'utf8'))
      if (typeof saved.encrypted === 'string') this.encrypted = saved.encrypted
    } catch {
      /* Missing or damaged key requires re-registration. */
    }
    try {
      const legacyFile = path.join(this.directory, 'config.json'),
        legacy = JSON.parse(await fs.readFile(legacyFile, 'utf8'))
      const plain = typeof legacy.apiKeyFallback === 'string' ? legacy.apiKeyFallback : null
      if (!this.configured() && this.available()) {
        if (typeof legacy.apiKeyEncrypted === 'string') {
          try {
            safeStorage.decryptString(Buffer.from(legacy.apiKeyEncrypted, 'base64'))
            await atomicWrite(file, JSON.stringify({ encrypted: legacy.apiKeyEncrypted }))
            this.encrypted = legacy.apiKeyEncrypted
          } catch {
            /* A damaged encrypted legacy value must not hide a usable fallback. */
          }
        }
        if (!this.configured() && plain) await this.set(plain)
      }
      if (this.configured()) {
        delete legacy.apiKeyEncrypted
        delete legacy.apiKeyFallback
        await atomicWrite(legacyFile, JSON.stringify(legacy))
      }
    } catch {
      /* Never print secret values, paths or platform crypto errors. */
    }
  }
  configured(): boolean {
    if (!this.encrypted || !this.available()) return false
    try {
      return !!safeStorage.decryptString(Buffer.from(this.encrypted, 'base64'))
    } catch {
      return false
    }
  }
  get(): string {
    if (!this.configured()) throw new Error('설정에서 API 키를 다시 등록해주세요.')
    return safeStorage.decryptString(Buffer.from(this.encrypted!, 'base64'))
  }
  async set(key: string | null): Promise<void> {
    if (key !== null && (!this.available() || key.length < 10 || key.length > 500))
      throw new Error('보호 저장을 사용할 수 없거나 키 형식이 올바르지 않습니다.')
    const encrypted = key ? safeStorage.encryptString(key.trim()).toString('base64') : null
    await atomicWrite(path.join(this.directory, 'key-v1.json'), JSON.stringify({ encrypted }))
    this.encrypted = encrypted
    try {
      const legacyFile = path.join(this.directory, 'config.json')
      const legacy = JSON.parse(await fs.readFile(legacyFile, 'utf8'))
      if ('apiKeyEncrypted' in legacy || 'apiKeyFallback' in legacy) {
        delete legacy.apiKeyEncrypted
        delete legacy.apiKeyFallback
        await atomicWrite(legacyFile, JSON.stringify(legacy))
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          '기존 키 기록을 정리하지 못했습니다. 저장 공간을 확인하고 다시 시도해주세요.',
        )
    }
  }
}
