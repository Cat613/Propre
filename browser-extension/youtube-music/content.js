;(() => {
  const documentId = crypto.randomUUID()
  let generation = -1,
    active = true,
    desiredPlaying = false
  let sessionId = ''
  const media = () => document.querySelector('video')
  function state() {
    const el = media(),
      link = document.querySelector('ytmusic-player-bar .title a[href*="watch"]')
    const url = new URL(link?.href || location.href)
    return {
      bindingId: documentId,
      title: (document.querySelector('ytmusic-player-bar .title')?.textContent || '')
        .trim()
        .slice(0, 200),
      videoId: url.searchParams.get('v') || '',
      listId: url.searchParams.get('list') || new URL(location.href).searchParams.get('list') || '',
      playing: el ? !el.paused && !el.ended : null,
    }
  }
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.action === 'inspect') {
      reply(state())
      return
    }
    if (msg.action === 'release') {
      desiredPlaying = false
      active = false
      reply(state())
      return
    }
    if (msg.action === 'bind') {
      sessionId = msg.sessionId || sessionId
      desiredPlaying = media() ? !media().paused : false
      active = true
      generation = -1
      reply(state())
      return
    }
    if (
      !active ||
      msg.bindingId !== documentId ||
      msg.generation < generation ||
      Date.now() > msg.expiresAt
    ) {
      reply({ state: state(), error: 'stale' })
      return
    }
    generation = msg.generation
    const currentSession = sessionId
    const current = generation,
      el = media()
    if (!el) {
      reply({ state: state(), error: 'unsupported' })
      return
    }
    if (msg.action === 'pause') {
      desiredPlaying = false
      el.pause()
      reply({ state: state() })
      return
    }
    if (msg.action === 'status') {
      reply({ state: state() })
      return
    }
    if (msg.action === 'play') {
      desiredPlaying = true
      el.play().then(
        () => {
          if (
            currentSession !== sessionId ||
            current !== generation ||
            Date.now() > msg.expiresAt ||
            !active
          ) {
            if (
              (current === generation && currentSession === sessionId) ||
              !desiredPlaying ||
              !active
            )
              el.pause()
            reply({ state: state(), error: 'stale' })
          } else reply({ state: state() })
        },
        () => reply({ state: state(), error: 'autoplay-blocked' }),
      )
      return true
    }
  })
})()
