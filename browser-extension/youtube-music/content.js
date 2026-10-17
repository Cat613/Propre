;(() => {
  const documentId = crypto.randomUUID()
  let generation = -1,
    active = true,
    desiredPlaying = false,
    blockLateStart = false
  let sessionId = ''
  const media = () => document.querySelector('video')
  // Target only the album/playlist header, never a recommendation or shuffle button.
  const startButton = () => {
    const button = document.querySelector(
      'ytmusic-responsive-header-renderer ytmusic-play-button-renderer, ytmusic-detail-header-renderer ytmusic-play-button-renderer',
    )
    return button &&
      button.getAttribute('aria-disabled') !== 'true' &&
      button.getClientRects().length
      ? button
      : null
  }
  function state() {
    const el = media(),
      link =
        document.querySelector('ytmusic-player-bar .title a[href*="watch"]') ||
        document.querySelector(
          'ytmusic-responsive-list-item-renderer[play-button-state="playing"] a[href*="watch"], ytmusic-responsive-list-item-renderer[play-button-state="paused"] a[href*="watch"]',
        ),
      page = new URL(location.href),
      player = link?.href
        ? new URL(link.href, location.href)
        : page.pathname === '/watch'
          ? page
          : null
    return {
      bindingId: documentId,
      title: (document.querySelector('ytmusic-player-bar .title')?.textContent || '')
        .trim()
        .slice(0, 200),
      videoId: el?.currentSrc ? player?.searchParams.get('v') || '' : '',
      listId: el?.currentSrc ? player?.searchParams.get('list') || '' : '',
      pageVideoId: page.pathname === '/watch' ? page.searchParams.get('v') || '' : '',
      pageListId: page.pathname === '/playlist' ? page.searchParams.get('list') || '' : '',
      canStart: page.pathname === '/playlist' && !!startButton(),
      playing: el ? !el.paused && !el.ended : false,
    }
  }
  // A site queue load may finish after pause/timeout. Stop that late play as well.
  document.addEventListener(
    'play',
    () => {
      if (blockLateStart && !desiredPlaying) media()?.pause()
    },
    true,
  )
  // A real user can still take over playback directly in Chrome after cancellation.
  for (const name of ['pointerdown', 'keydown'])
    document.addEventListener(
      name,
      (event) => {
        if (event.isTrusted) blockLateStart = false
      },
      true,
    )
  function matches(target, observed) {
    return target.pathname === '/playlist'
      ? !!observed.videoId && target.searchParams.get('list') === observed.listId
      : !!observed.videoId && target.searchParams.get('v') === observed.videoId
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
    const currentSession = sessionId,
      current = generation
    const valid = () =>
      currentSession === sessionId &&
      current === generation &&
      Date.now() <= msg.expiresAt &&
      active
    if (msg.action === 'pause') {
      desiredPlaying = false
      media()?.pause()
      reply({ state: state() })
      return
    }
    if (msg.action === 'status') {
      reply({ state: state() })
      return
    }
    if (msg.action === 'play') {
      let target
      try {
        target = new URL(msg.url)
        if (
          target.origin !== 'https://music.youtube.com' ||
          target.username ||
          target.password ||
          !['/playlist', '/watch'].includes(target.pathname) ||
          !/^[a-zA-Z0-9_-]{1,160}$/.test(
            target.searchParams.get(target.pathname === '/playlist' ? 'list' : 'v') || '',
          )
        )
          throw Error('target')
      } catch {
        reply({ state: state(), error: 'target-mismatch' })
        return
      }
      const loaded = matches(target, state()) && !!media()?.currentSrc
      const page = new URL(location.href)
      const button =
        !loaded &&
        target.pathname === '/playlist' &&
        page.pathname === '/playlist' &&
        page.searchParams.get('list') === target.searchParams.get('list')
          ? startButton()
          : null
      if (!loaded && !button) {
        reply({ state: state(), error: 'start-unavailable' })
        return
      }
      desiredPlaying = true
      blockLateStart = !!button
      ;(async () => {
        try {
          if (button) {
            button.click()
            // Click only once; loading can take seconds. Check the actual player, not the click.
            while (valid()) {
              const el = media()
              if (matches(target, state()) && el?.currentSrc && el.readyState >= 2 && !el.paused)
                break
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
          } else await media().play()
          if (!valid()) {
            if (
              (current === generation && currentSession === sessionId) ||
              !desiredPlaying ||
              !active
            ) {
              desiredPlaying = false
              media()?.pause()
            }
            reply({ state: state(), error: 'stale' })
            return
          }
          if (!matches(target, state()) || state().playing !== true) throw Error('not-playing')
          blockLateStart = false
          reply({ state: state() })
        } catch {
          if (current === generation && currentSession === sessionId) {
            desiredPlaying = false
            media()?.pause()
          }
          reply({ state: state(), error: valid() ? 'autoplay-blocked' : 'stale' })
        }
      })()
      return true
    }
  })
  const preparation = new URL(location.href).hash.match(/^#propre-connect=([a-f0-9]{64})$/)
  if (preparation) {
    // Runs at document_start so even a watch page's own autoplay stays silent.
    desiredPlaying = false
    blockLateStart = true
    media()?.pause()
    void chrome.runtime.sendMessage({ action: 'prepare-bind', requestId: preparation[1] }).then(
      (result) => {
        if (!result?.ok) return
        const url = new URL(location.href)
        if (url.hash !== `#propre-connect=${preparation[1]}`) return
        url.hash = ''
        history.replaceState(history.state, '', url.href)
      },
      () => {},
    )
  }
})()
