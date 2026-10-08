export function contentSecurityPolicy(devURL?: string, devNonce?: string): string {
  const scripts = ["'self'"]
  const connections = ["'self'"]
  if (devURL) {
    const websocket = new URL(devURL)
    websocket.protocol = websocket.protocol === 'https:' ? 'wss:' : 'ws:'
    connections.push(websocket.origin)
    if (devNonce && /^[A-Za-z0-9+/]+={0,2}$/.test(devNonce)) scripts.push(`'nonce-${devNonce}'`)
  }
  return `default-src 'self'; script-src ${scripts.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' media: data:; media-src 'self' media:; font-src 'self' data:; connect-src ${connections.join(' ')}; object-src 'none'; base-uri 'none'; frame-src 'none'`
}
