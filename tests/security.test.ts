import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
const crypto = vi.hoisted(() => ({ available: true }))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => crypto.available,
    getSelectedStorageBackend: () => 'secure-backend',
    encryptString: (value: string) => Buffer.from('protected:' + value),
    decryptString: (value: Buffer) => {
      const text = value.toString()
      if (!text.startsWith('protected:')) throw new Error('invalid')
      return text.slice(10)
    },
  },
}))
import { KeyVault } from '../electron/services/security'
let dir: string
beforeEach(async () => {
  crypto.available = true
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-vault-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})
describe('key boundaries', () => {
  it('migrates an old fallback only into encrypted storage, removing the old raw fields', async () => {
    await fs.writeFile(
      path.join(dir, 'config.json'),
      JSON.stringify({ library: [], apiKeyFallback: 'synthetic-test-only' }),
    )
    const vault = new KeyVault(dir)
    await vault.open()
    expect(vault.configured()).toBe(true)
    const legacy = JSON.parse(await fs.readFile(path.join(dir, 'config.json'), 'utf8'))
    expect(legacy).not.toHaveProperty('apiKeyFallback')
    expect(legacy.library).toEqual([])
    expect(await fs.readFile(path.join(dir, 'key-v1.json'), 'utf8')).not.toContain(
      'synthetic-test-only',
    )
  })
  it('rejects protected save when OS encryption is unavailable', async () => {
    crypto.available = false
    const vault = new KeyVault(dir)
    await expect(vault.set('synthetic-test-only')).rejects.toThrow('보호')
    expect(vault.configured()).toBe(false)
    await expect(fs.stat(path.join(dir, 'key-v1.json'))).rejects.toThrow()
  })
  it('deletes a configured key without keeping a fallback', async () => {
    const vault = new KeyVault(dir)
    await vault.set('synthetic-test-only')
    await vault.set(null)
    expect(vault.configured()).toBe(false)
    expect(
      JSON.parse(await fs.readFile(path.join(dir, 'key-v1.json'), 'utf8')).encrypted,
    ).toBeNull()
  })
  it('migrates a usable legacy fallback when encrypted records are damaged', async () => {
    await fs.writeFile(path.join(dir, 'key-v1.json'), JSON.stringify({ encrypted: 'invalid' }))
    await fs.writeFile(
      path.join(dir, 'config.json'),
      JSON.stringify({
        apiKeyEncrypted: 'invalid',
        apiKeyFallback: 'synthetic-test-only',
        library: [],
      }),
    )
    const vault = new KeyVault(dir)
    await vault.open()
    expect(vault.configured()).toBe(true)
    expect(JSON.parse(await fs.readFile(path.join(dir, 'config.json'), 'utf8'))).toEqual({
      library: [],
    })
  })
  it('explicit deletion removes an unmigrated fallback so it cannot reappear', async () => {
    crypto.available = false
    await fs.writeFile(
      path.join(dir, 'config.json'),
      JSON.stringify({ apiKeyFallback: 'synthetic-test-only', library: [] }),
    )
    const vault = new KeyVault(dir)
    await vault.open()
    await vault.set(null)
    crypto.available = true
    await vault.open()
    expect(vault.configured()).toBe(false)
    expect(JSON.parse(await fs.readFile(path.join(dir, 'config.json'), 'utf8'))).toEqual({
      library: [],
    })
  })
})
