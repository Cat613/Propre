import { describe, it, expect, vi } from 'vitest'
import { DraftWriter } from '../src/store/persistence'
const p = (id: string, revision: number) => ({
  id,
  title: id,
  slides: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  revision,
})
describe('automatic saves', () => {
  it('keeps documents separate while switching rapidly', async () => {
    const save = vi.fn(async () => {}),
      writer = new DraftWriter(save, () => {}, 10000)
    writer.schedule({ presentation: p('a', 1), fingerprint: 'a' })
    writer.schedule({ presentation: p('b', 2), fingerprint: 'b' })
    writer.schedule({ presentation: p('a', 3), fingerprint: 'new-a' })
    await writer.flush()
    expect(save.mock.calls.map((c) => c[0])).toEqual(
      [p('a', 3), p('b', 2)].map((x, i) =>
        expect.objectContaining({ id: i === 0 ? 'a' : 'b', revision: x.revision }),
      ),
    )
    writer.dispose()
  })
  it('retains failed draft and retries successfully with the newer revision', async () => {
    let fails = true
    const saved: number[] = [],
      statuses: string[] = [],
      writer = new DraftWriter(
        async (value) => {
          if (fails) throw new Error('disk')
          saved.push(value.revision!)
        },
        (state) => statuses.push(state),
        10000,
      )
    writer.schedule({ presentation: p('a', 1), fingerprint: 'one' })
    await expect(writer.flush()).rejects.toThrow()
    writer.schedule({ presentation: p('a', 2), fingerprint: 'two' })
    fails = false
    await writer.flush()
    expect(saved).toEqual([2])
    expect(statuses).toContain('error')
    expect(statuses.at(-1)).toBe('saved')
    writer.dispose()
  })
  it('serializes a new edit arriving during an ongoing disk save', async () => {
    const saved: number[] = [],
      save = vi.fn(async (value) => {
        if (value.revision === 1) await new Promise((r) => setTimeout(r, 10))
        saved.push(value.revision)
      }),
      writer = new DraftWriter(save, () => {}, 10000)
    writer.schedule({ presentation: p('a', 1), fingerprint: 'one' })
    const flushing = writer.flush()
    await new Promise((r) => setTimeout(r, 1))
    writer.schedule({ presentation: p('a', 2), fingerprint: 'two' })
    await flushing
    expect(saved).toEqual([1, 2])
    writer.dispose()
  })
})
