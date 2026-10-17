let port,
  tabId,
  bindingId = '',
  latest = 0
function connect() {
  if (port) return
  port = chrome.runtime.connectNative('com.propre.music')
  port.onDisconnect.addListener(() => {
    port = undefined
    if (tabId)
      setTimeout(() => {
        try {
          connect()
        } catch {}
      }, 2000)
  })
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'ready') {
      latest = 0
      if (tabId) {
        const state = await chrome.tabs.sendMessage(tabId, {
          action: 'bind',
          sessionId: msg.sessionId,
        })
        bindingId = state.bindingId
      }
      await report()
      return
    }
    if (!tabId || msg.generation < latest || Date.now() > msg.expiresAt) return
    if (msg.action !== 'status') latest = msg.generation
    try {
      const result = await chrome.tabs.sendMessage(tabId, { ...msg, bindingId })
      if (result?.state?.bindingId !== bindingId) return
      port?.postMessage({
        type: 'state',
        requestId: msg.requestId,
        state: result.state,
        error: result.error,
      })
    } catch {
      port?.disconnect()
    }
  })
}
async function report() {
  if (!tabId) return
  const state = await chrome.tabs.sendMessage(tabId, { action: 'inspect' })
  if (state.bindingId !== bindingId) {
    port?.disconnect()
    return
  }
  port?.postMessage({ type: 'state', state })
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.tab || sender.id !== chrome.runtime.id || msg.action !== 'bind') return
  ;(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url?.startsWith('https://music.youtube.com/'))
      throw Error('유튜브 뮤직 탭에서 연결해주세요.')
    if (tabId === tab.id) {
      connect()
      await report()
      reply({ ok: true })
      return
    }
    if (tabId && tabId !== tab.id) {
      const old = await chrome.tabs.sendMessage(tabId, {
        action: 'pause',
        generation: ++latest,
        expiresAt: Date.now() + 2000,
        bindingId,
      })
      if (old.state?.playing !== false) throw Error('기존 음악 중단을 확인해주세요.')
      port?.postMessage({ type: 'state', state: old.state })
      await chrome.tabs.sendMessage(tabId, { action: 'release' })
    }
    const state = await chrome.tabs.sendMessage(tab.id, { action: 'bind' })
    tabId = tab.id
    bindingId = state.bindingId
    latest = 0
    connect()
    await report()
    reply({ ok: true })
  })().catch((e) => reply({ error: e.message }))
  return true
})
