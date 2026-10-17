let port,
  tabId,
  bindingId = '',
  latest = 0,
  sessionId = '',
  connecting,
  bindingQueue = Promise.resolve()
const approvals = new Map()
function connect() {
  if (connecting) return connecting
  if (port && sessionId) return Promise.resolve()
  connecting = new Promise((resolve, reject) => {
    const connection = chrome.runtime.connectNative('com.propre.music')
    port = connection
    connection.onDisconnect.addListener(() => {
      if (port !== connection) return
      port = undefined
      sessionId = ''
      connecting = undefined
      reject(
        Error(
          'ProPre 연결 프로그램과 통신하지 못했습니다. 앱의 브라우저 연결 설정을 확인해주세요.',
        ),
      )
      for (const approval of approvals.values()) {
        clearTimeout(approval.timer)
        approval.reject(Error('ProPre 연결이 끊겼습니다.'))
      }
      approvals.clear()
      if (tabId) setTimeout(() => void connect().catch(() => {}), 2000)
    })
    connection.onMessage.addListener(async (msg) => {
      if (msg.type === 'ready') {
        latest = 0
        sessionId = msg.sessionId
        try {
          if (tabId) {
            const state = await chrome.tabs.sendMessage(tabId, { action: 'bind', sessionId })
            bindingId = state.bindingId
            await report()
          }
          connecting = undefined
          resolve()
        } catch (error) {
          reject(error)
          connection.disconnect()
        }
        return
      }
      if (msg.type === 'prepare-approved') {
        const pending = approvals.get(msg.requestId)
        if (!pending) return
        approvals.delete(msg.requestId)
        clearTimeout(pending.timer)
        if (msg.approved) pending.resolve()
        else
          pending.reject(
            Error(
              msg.reason ||
                '자동 연결 요청이 만료되었거나 재생 대상이 바뀌었습니다. 앱에서 다시 준비해주세요.',
            ),
          )
        return
      }
      if (!tabId || msg.generation < latest || Date.now() > msg.expiresAt) return
      if (msg.action !== 'status') latest = msg.generation
      const targetTab = tabId,
        targetBinding = bindingId
      try {
        const result = await chrome.tabs.sendMessage(targetTab, {
          ...msg,
          bindingId: targetBinding,
        })
        if (
          tabId !== targetTab ||
          bindingId !== targetBinding ||
          result?.state?.bindingId !== bindingId
        )
          return
        connection.postMessage({
          type: 'state',
          requestId: msg.requestId,
          state: result.state,
          error: result.error,
        })
      } catch {
        connection.disconnect()
      }
    })
  })
  return connecting
}
async function report() {
  if (!tabId) return
  const targetTab = tabId,
    targetBinding = bindingId
  const state = await chrome.tabs.sendMessage(targetTab, { action: 'inspect' })
  if (tabId !== targetTab || bindingId !== targetBinding) return
  if (state.bindingId !== bindingId) {
    port?.disconnect()
    return
  }
  port?.postMessage({ type: 'state', state })
}
function bindTab(tab) {
  const task = bindingQueue.then(async () => {
    await connect()
    if (tabId && tabId !== tab.id) {
      const old = await chrome.tabs.sendMessage(tabId, {
        action: 'pause',
        generation: ++latest,
        expiresAt: Date.now() + 2000,
        bindingId,
      })
      if (old.error || old.state?.playing !== false) throw Error('기존 음악 중단을 확인해주세요.')
      port?.postMessage({ type: 'state', state: old.state })
      await chrome.tabs.sendMessage(tabId, { action: 'release' })
    }
    const state = await chrome.tabs.sendMessage(tab.id, { action: 'bind', sessionId })
    tabId = tab.id
    bindingId = state.bindingId
    latest = 0
    await report()
  })
  bindingQueue = task.catch(() => {})
  return task
}
function approvePreparation(requestId, state) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      approvals.delete(requestId)
      reject(Error('자동 연결 승인을 확인하지 못했습니다. 앱에서 다시 준비해주세요.'))
    }, 5000)
    approvals.set(requestId, { resolve, reject, timer })
    port.postMessage({ type: 'prepare-tab', requestId, state })
  })
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return
  if (msg.action === 'prepare-bind' && sender.tab?.id) {
    if (sender.frameId !== 0) return
    let url
    try {
      url = new URL(sender.url || sender.tab.url)
    } catch {
      return
    }
    if (
      url.origin !== 'https://music.youtube.com' ||
      !/^[a-f0-9]{64}$/.test(msg.requestId || '') ||
      url.hash !== `#propre-connect=${msg.requestId}`
    )
      return
    ;(async () => {
      await connect()
      const state = await chrome.tabs.sendMessage(sender.tab.id, { action: 'inspect' })
      await approvePreparation(msg.requestId, state)
      await bindTab(sender.tab)
      reply({ ok: true })
    })().catch((error) => {
      port?.postMessage({
        type: 'prepare-failed',
        requestId: msg.requestId,
        error: String(error.message).slice(0, 300),
      })
      reply({ error: error.message })
    })
    return true
  }
  if (sender.tab || msg.action !== 'bind') return
  ;(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !tab.url?.startsWith('https://music.youtube.com/'))
      throw Error('유튜브 뮤직 탭에서 연결해주세요.')
    await bindTab(tab)
    reply({ ok: true })
  })().catch((error) => reply({ error: error.message }))
  return true
})
