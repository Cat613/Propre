import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { StageMessages } from '../electron/services/stage-messages'
import { messageLayout } from '../shared/stage-message'
import type { WindowManager } from '../electron/services/windows'
let service: StageMessages
let windows: {
  windows: Map<string, unknown>
  notify: ReturnType<typeof vi.fn>
  onStageReady?: () => void
  onStageClosed?: () => void
  onEmergencyStop?: () => void
}
const stage = () => ({
  isDestroyed: () => false,
  getContentBounds: () => ({ width: 800, height: 600 }),
  webContents: { send: vi.fn() },
})
const send = (text = '합성 안내', ttl: 0 | 5 | 20 = 20) =>
  service.command({
    action: 'send',
    requestId: randomUUID(),
    expectedRevision: service.snapshot().revision,
    text,
    ttl,
  })
beforeEach(() => {
  vi.useFakeTimers()
  windows = { windows: new Map([['stage', stage()]]), notify: vi.fn() }
  service = new StageMessages(windows as unknown as WindowManager)
})
afterEach(() => vi.useRealTimers())
it('keeps output and workspace out of the message path and deduplicates sends', () => {
  const command = {
    action: 'send',
    requestId: randomUUID(),
    expectedRevision: 0,
    text: '  무대 안내  ',
    ttl: 20,
  }
  const first = service.command(command)
  expect(first.message?.text).toBe('무대 안내')
  expect(first.delivery).toBe('pending')
  expect(service.command(command)).toEqual(first)
  expect(windows.notify.mock.calls.every(([channel]) => channel === 'stage-message-status')).toBe(
    true,
  )
  expect(
    (windows.windows.get('stage') as ReturnType<typeof stage>).webContents.send.mock.calls[0][0],
  ).toBe('stage-message')
  expect(() => service.command({ ...command, text: 'changed' })).toThrow('요청 ID')
})
it('rejects blank/oversize/three-line text, invalid TTL, absent Stage and stale revisions without replacing the prior message', () => {
  const before = send()
  for (const update of [
    { text: ' ' },
    { text: '가'.repeat(121) },
    { text: 'a\nb\nc' },
    { ttl: 3 },
    { expectedRevision: 0 },
  ]) {
    expect(() =>
      service.command({
        action: 'send',
        requestId: randomUUID(),
        expectedRevision: before.revision,
        text: 'new',
        ttl: 20,
        ...update,
      }),
    ).toThrow()
    expect(service.snapshot().message).toEqual(before.message)
  }
  windows.windows.clear()
  expect(() => send()).toThrow('무대 화면')
})
it('expires the latest message, ignores stale clears/acks and never resurrects expired messages on reconnect', () => {
  const first = send('one', 5)
  vi.advanceTimersByTime(1000)
  const second = send('two', 20)
  expect(() =>
    service.command({ action: 'clear', id: first.message!.id, expectedRevision: first.revision }),
  ).toThrow('이전 지우기')
  service.acknowledge(first.message!.id, first.revision, true)
  expect(service.snapshot().delivery).toBe('pending')
  service.acknowledge(second.message!.id, second.revision, true)
  expect(service.snapshot().delivery).toBe('displayed')
  vi.advanceTimersByTime(5000)
  expect(service.snapshot().message?.text).toBe('two')
  vi.advanceTimersByTime(15000)
  expect(service.snapshot().message).toBeNull()
  windows.onStageReady?.()
  expect(service.snapshot().message).toBeNull()
})
it('reports missing render acknowledgement and replays only current state after Stage recreation', () => {
  const first = send('pending', 0)
  vi.advanceTimersByTime(3000)
  expect(service.snapshot().delivery).toBe('unconfirmed')
  windows.windows.clear()
  windows.onStageClosed?.()
  expect(service.snapshot().stage).toBeNull()
  const next = stage()
  windows.windows.set('stage', next)
  windows.onStageReady?.()
  expect(next.webContents.send.mock.calls[0][1].message.id).toBe(first.message?.id)
  service.acknowledge(first.message!.id, first.revision, false)
  expect(service.snapshot().delivery).toBe('unconfirmed')
  windows.onEmergencyStop?.()
  expect(service.snapshot().message).toBeNull()
  expect(new StageMessages(windows as unknown as WindowManager).snapshot().message).toBeNull()
})
it('wraps Korean text with the same measurement and counts explicit blank lines', () => {
  const measure = (text: string, font: number) => text.length * font
  expect(messageLayout('가'.repeat(60), 800, 600, measure)).toMatchObject({ lines: 2, fits: true })
  expect(messageLayout('가'.repeat(100), 800, 600, measure)).toMatchObject({
    lines: 3,
    fits: false,
  })
  expect(messageLayout('가\n\n다', 800, 600, measure).fits).toBe(false)
})
it('keeps TTL monotonic across a wall-clock adjustment and does not revive on replay', () => {
  send('시계 변경 중 안내', 5)
  vi.setSystemTime(Date.now() + 3600000)
  windows.onStageReady?.()
  expect(service.snapshot().message).not.toBeNull()
  vi.advanceTimersByTime(5000)
  windows.onStageReady?.()
  expect(service.snapshot().message).toBeNull()
})
