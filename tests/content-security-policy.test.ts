import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from '../shared/content-security-policy'

describe('renderer script policy', () => {
  it('authorizes only the dev server startup nonce and its actual websocket origin', () => {
    const policy = contentSecurityPolicy('http://localhost:5183/', 'syntheticStartupNonce123')
    expect(policy).toContain("script-src 'self' 'nonce-syntheticStartupNonce123'")
    expect(policy).toContain("connect-src 'self' output: ws://localhost:5183")
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(policy).not.toContain('unsafe-eval')
  })
  it('keeps a strict production policy even if a dev nonce remains in the environment', () => {
    const policy = contentSecurityPolicy(undefined, 'syntheticStartupNonce123')
    expect(policy).toContain("script-src 'self';")
    expect(policy).toContain("connect-src 'self' output:;")
    expect(policy).not.toContain('nonce-')
  })
  it('rejects a nonce that could inject another script source', () => {
    const policy = contentSecurityPolicy('http://127.0.0.1:5183/', "x' 'unsafe-inline")
    expect(policy).toContain("script-src 'self';")
  })
})
