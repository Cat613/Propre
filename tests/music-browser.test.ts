import { expect, it, vi } from 'vitest'
import { openMusicInChrome } from '../electron/services/music-browser'

it('opens a validated music link in Chrome without using the default browser or a shell', async () => {
  const launch = vi.fn(async () => {})
  await openMusicInChrome(
    'https://music.youtube.com/watch?v=track-a&list=PLtest&tracking=discard',
    {
      platform: 'darwin',
      launch,
    },
  )
  expect(launch).toHaveBeenCalledExactlyOnceWith('/usr/bin/open', [
    '-b',
    'com.google.Chrome',
    'https://music.youtube.com/watch?v=track-a&list=PLtest',
  ])
})
it('rejects unrelated and unsafe links before opening an application', async () => {
  const launch = vi.fn(async () => {})
  for (const url of [
    'https://example.com/watch?v=x',
    'file:///tmp/music',
    'https://music.youtube.com.evil.test/watch?v=x',
  ])
    await expect(openMusicInChrome(url, { platform: 'darwin', launch })).rejects.toThrow()
  expect(launch).not.toHaveBeenCalled()
})
it('reports Chrome launch failures without falling back to the default browser', async () => {
  const launch = vi.fn(async () => {
    throw new Error('Application not found')
  })
  await expect(
    openMusicInChrome('https://music.youtube.com/playlist?list=PLtest', {
      platform: 'darwin',
      launch,
    }),
  ).rejects.toThrow('Google Chrome에서 링크를 열지 못했습니다')
  expect(launch).toHaveBeenCalledTimes(1)
})
it('preserves only a validated one-time connection marker when opening Chrome', async () => {
  const launch = vi.fn(async () => {})
  const marker = 'a'.repeat(64)
  await openMusicInChrome(
    `https://music.youtube.com/playlist?list=PLtest#propre-connect=${marker}`,
    { platform: 'darwin', launch },
  )
  expect(launch.mock.calls[0]).toEqual([
    '/usr/bin/open',
    [
      '-b',
      'com.google.Chrome',
      `https://music.youtube.com/playlist?list=PLtest#propre-connect=${marker}`,
    ],
  ])
  launch.mockClear()
  await openMusicInChrome('https://music.youtube.com/playlist?list=PLtest#propre-connect=invalid', {
    platform: 'darwin',
    launch,
  })
  expect(launch.mock.calls[0]).toEqual([
    '/usr/bin/open',
    ['-b', 'com.google.Chrome', 'https://music.youtube.com/playlist?list=PLtest'],
  ])
})
