import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { Repository } from '../electron/services/repository'
import { MusicBridge } from '../electron/services/music-bridge'
import { LocalMusicSchema, musicURL } from '../shared/music'
const dirs: string[] = []
async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-'))
  dirs.push(dir)
  const repo = new Repository(dir)
  await repo.open()
  await repo.manageSetlist({
    operation: 'create',
    title: '음악 예배',
    fromCurrent: false,
    expectedActiveId: null,
    expectedRevision: null,
  })
  const asset = repo.assetURL(await repo.register(path.resolve('tests/fixtures/silence.wav')))
  return { repo, dir, asset }
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true })
})
describe('music persistence and source contracts', () => {
  it('normalizes only supported YouTube Music targets', () => {
    expect(musicURL('https://music.youtube.com/watch?v=abc&list=PL123&tracking=secret')).toBe(
      'https://music.youtube.com/watch?v=abc&list=PL123',
    )
    for (const url of [
      'http://music.youtube.com/watch?v=x',
      'https://music.youtube.com.evil.test/watch?v=x',
      'https://music.youtube.com/redirect?url=x',
      'https://user:pass@music.youtube.com/watch?v=x',
    ])
      expect(() => musicURL(url)).toThrow()
  })
  it('rejects invalid ranges and non-finite values', () => {
    for (const v of [{ startSeconds: 4, endSeconds: 3 }, { volume: Infinity }, { fadeSeconds: 11 }])
      expect(() => LocalMusicSchema.parse({ url: 'media://asset/a/a.wav', ...v })).toThrow()
  })
  it('saves independent service music and round trips files, templates and backup with audio assets', async () => {
    const { repo, asset } = await setup()
    const list = repo.state.setlists[0]
    const item = {
      id: 'music-a',
      revision: 0,
      title: '기도 음악',
      source: {
        kind: 'youtube-music' as const,
        url: 'https://music.youtube.com/playlist?list=PLabc',
        fallback: LocalMusicSchema.parse({ url: asset }),
      },
    }
    await repo.saveMusic({ setlistId: list.id, expectedRevision: list.revision, items: [item] })
    await expect(
      repo.saveMusic({ setlistId: list.id, expectedRevision: list.revision, items: [] }),
    ).rejects.toThrow('변경')
    await repo.saveMusic({
      setlistId: list.id,
      expectedRevision: repo.state.setlists[0].revision,
      items: [item],
    })
    let saved = repo.state.setlists[0]
    await repo.saveServicePlan({
      requestId: crypto.randomUUID(),
      setlistId: saved.id,
      expectedSetlistRevision: saved.revision,
      plan: {
        ...saved.servicePlan,
        items: [
          {
            id: 'music-cue',
            kind: 'prayer',
            title: '기도',
            enter: { visual: 'keep', audio: 'keep' },
            musicPreparationId: item.id,
          },
        ],
      },
    })
    saved = repo.state.setlists[0]
    const file = JSON.parse(await repo.exportService(saved.id, saved.revision))
    expect(file.schemaVersion).toBe(4)
    expect(file.assets).toHaveLength(1)
    const other = new Repository(path.join(repo.directory, 'other'))
    await other.open()
    await other.importProject(JSON.stringify(file), false, undefined, false, {
      activeId: null,
      revision: null,
    })
    expect(other.state.setlists[0].music?.[0].source).toEqual(item.source)
    expect(other.state.setlists[0].music?.[0].id).not.toBe(item.id)
    expect(other.state.setlists[0].servicePlan?.items[0].musicPreparationId).toBe(
      other.state.setlists[0].music?.[0].id,
    )
    await repo.manageServiceTemplate({
      action: 'save-from-service',
      requestId: crypto.randomUUID(),
      setlistId: saved.id,
      expectedRevision: saved.revision,
      name: '음악 템플릿',
      description: '',
      includeLeaders: false,
      includeOperatorNotes: false,
      includeStageNotes: false,
      fixedCueIds: [],
    })
    const template = repo.state.serviceTemplates[0]
    expect(
      JSON.parse(await repo.exportServiceTemplate(template.id, template.revision)).assets,
    ).toHaveLength(1)
    await repo.manageServiceTemplate({
      action: 'instantiate',
      requestId: crypto.randomUUID(),
      id: template.id,
      expectedRevision: template.revision,
      title: '템플릿 예배',
      expectedActiveId: saved.id,
      expectedActiveRevision: saved.revision,
      slots: Object.fromEntries(template.items.map((x) => [x.id, null])),
    })
    const fromTemplate = repo.state.setlists[1]
    expect(fromTemplate.servicePlan?.items[0].musicPreparationId).toBe(fromTemplate.music?.[0].id)
    await repo.manageSetlist({
      operation: 'duplicate',
      id: saved.id,
      expectedRevision: saved.revision,
      title: '사본',
    })
    const duplicate = repo.state.setlists.find((x) => x.title === '사본')!
    expect(duplicate.music?.[0].id).not.toBe(item.id)
    expect(duplicate.servicePlan?.items[0].musicPreparationId).toBe(duplicate.music?.[0].id)
    const backup = await repo.exportProject(undefined)
    const restored = new Repository(path.join(repo.directory, 'restored'))
    await restored.open()
    await restored.importProject(backup, true)
    expect(restored.state.setlists.map((x) => x.music)).toEqual(
      repo.state.setlists.map((x) => x.music),
    )
  })
  it('migrates v4 without altering its bytes and protects active-only music pins from cleanup', async () => {
    const { repo, dir, asset } = await setup()
    const prior = JSON.stringify({ ...repo.state, schemaVersion: 4 })
    await fs.writeFile(path.join(dir, 'workspace-v4.json'), prior)
    await fs.rm(repo.filename)
    const migrated = new Repository(dir)
    await migrated.open()
    expect(migrated.state.schemaVersion).toBe(5)
    expect(await fs.readFile(path.join(dir, 'workspace-v4.json'), 'utf8')).toBe(prior)
    migrated.musicPins.add(asset)
    await migrated.setMedia([])
    await migrated.cleanup()
    expect(await migrated.assetPath(asset)).toBeTruthy()
  })
})
describe('native music bridge', () => {
  it('requires authenticated binding observations, checks playback targets and reports disconnect as unknown', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pb-'))
    dirs.push(dir)
    const bridge = new MusicBridge(dir, () => {})
    await bridge.start()
    const config = JSON.parse(await fs.readFile(path.join(dir, 'music-host.json'), 'utf8'))
    const socket = net.createConnection(config.socket)
    let pending = ''
    const commands: any[] = []
    const observation = {
      bindingId: 'binding-a',
      title: '합성 곡',
      videoId: 'abc',
      listId: 'PLabc',
      playing: false,
      pageListId: 'PLabc',
      canStart: true,
    }
    socket.on('data', (data) => {
      pending += data.toString()
      let n
      while ((n = pending.indexOf('\n')) >= 0) {
        const msg = JSON.parse(pending.slice(0, n))
        pending = pending.slice(n + 1)
        if (msg.type === 'ready')
          socket.write(JSON.stringify({ type: 'state', state: observation }) + '\n')
        else {
          commands.push(msg)
          observation.playing = msg.action === 'play'
          if (msg.action === 'play' && new URL(msg.url).pathname === '/playlist') {
            observation.videoId = 'abc'
            observation.listId = 'PLabc'
          }
          socket.write(
            JSON.stringify({ type: 'state', requestId: msg.requestId, state: observation }) + '\n',
          )
        }
      }
    })
    try {
      await new Promise<void>((r) =>
        socket.once('connect', () => {
          socket.write(JSON.stringify({ token: config.token }) + '\n')
          r()
        }),
      )
      for (let i = 0; i < 20 && !bridge.snapshot().connected; i++)
        await new Promise((r) => setTimeout(r, 5))
      await expect(
        bridge.command('play', 'https://music.youtube.com/watch?v=other'),
      ).rejects.toThrow('다릅니다')
      expect((await bridge.command('play', 'https://music.youtube.com/watch?v=abc')).playing).toBe(
        true,
      )
      await bridge.command('pause')
      observation.videoId = ''
      observation.listId = ''
      await bridge.command('status')
      expect(
        await bridge.command('play', 'https://music.youtube.com/playlist?list=PLabc'),
      ).toMatchObject({ playing: true, videoId: 'abc', listId: 'PLabc' })
      expect(commands.filter((x) => x.action === 'play').at(-1)).toMatchObject({
        url: 'https://music.youtube.com/playlist?list=PLabc',
        bindingId: 'binding-a',
      })
      socket.destroy()
      await new Promise((r) => setTimeout(r, 10))
      expect(bridge.snapshot()).toMatchObject({ connected: false, stale: true, playing: null })
      await expect(bridge.command('pause')).rejects.toThrow()
      expect(() => bridge.confirmStopped('wrong')).toThrow()
      expect(bridge.confirmStopped('binding-a')).toMatchObject({ stale: false, playing: false })
    } finally {
      socket.destroy()
      bridge.close()
    }
  })
})

describe('automatic Chrome preparation', () => {
  it('accepts only the current one-time request and target, then waits for the actual bound state', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pb-auto-'))
    dirs.push(dir)
    const bridge = new MusicBridge(dir, () => {})
    await bridge.start()
    const config = JSON.parse(await fs.readFile(path.join(dir, 'music-host.json'), 'utf8'))
    let socket: net.Socket | undefined
    const approvals: boolean[] = []
    const commands: string[] = []
    let requestId = ''
    const candidate = {
      bindingId: 'new-document',
      title: '',
      videoId: '',
      listId: '',
      pageListId: 'PLnew',
      playing: false,
    }
    const send = (value: unknown) => socket!.write(JSON.stringify(value) + '\n')
    try {
      const state = await bridge.prepareChrome(
        'https://music.youtube.com/playlist?list=PLnew',
        async (url) => {
          requestId = new URL(url).hash.slice('#propre-connect='.length)
          expect(requestId).toMatch(/^[a-f0-9]{64}$/)
          socket = net.createConnection(config.socket)
          let buffer = ''
          socket.on('connect', () => send({ token: config.token }))
          socket.on('data', (data) => {
            buffer += data.toString()
            let n: number
            while ((n = buffer.indexOf('\n')) >= 0) {
              const msg = JSON.parse(buffer.slice(0, n))
              buffer = buffer.slice(n + 1)
              if (msg.type === 'ready')
                send({ type: 'prepare-tab', requestId: 'wrong', state: candidate })
              else if (msg.type === 'prepare-approved') {
                approvals.push(msg.approved)
                if (approvals.length === 1)
                  send({
                    type: 'prepare-tab',
                    requestId,
                    state: { ...candidate, pageListId: 'other' },
                  })
                else if (approvals.length === 2)
                  send({ type: 'prepare-tab', requestId, state: candidate })
                else if (msg.approved) {
                  send({ type: 'state', state: { ...candidate, canStart: false } })
                  setTimeout(
                    () => send({ type: 'state', state: { ...candidate, canStart: true } }),
                    20,
                  )
                }
              } else commands.push(msg.action)
            }
          })
        },
      )
      expect(approvals).toEqual([false, false, true])
      expect(state).toMatchObject({
        connected: true,
        bindingId: 'new-document',
        playing: false,
        canStart: true,
      })
      expect(commands).not.toContain('play')
      send({ type: 'prepare-tab', requestId, state: candidate })
      for (let i = 0; i < 20 && approvals.length < 4; i++)
        await new Promise((r) => setTimeout(r, 5))
      expect(approvals[3]).toBe(false)
    } finally {
      socket?.destroy()
      bridge.close()
    }
  })
  it('reports browser launch errors and cancels pending handoffs on explicit stop', async () => {
    const bridge = new MusicBridge('/unused', () => {})
    await expect(
      bridge.prepareChrome('https://music.youtube.com/playlist?list=PLnew', async () => {
        throw Error('Chrome launch failed')
      }),
    ).rejects.toThrow('Chrome launch failed')
    let opened!: () => void
    const opening = new Promise<void>((resolve) => {
      opened = resolve
    })
    const preparing = bridge.prepareChrome(
      'https://music.youtube.com/playlist?list=PLnew',
      async () => {
        opened()
      },
    )
    const failed = expect(preparing).rejects.toThrow('취소')
    await opening
    await bridge.command('pause')
    await failed
    bridge.close()
  })
})
