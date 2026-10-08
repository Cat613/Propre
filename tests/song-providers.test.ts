import { describe, expect, it, vi } from 'vitest'
import { SongProvider } from '../electron/services/song-providers'
const files = [{ id: 'source', name: 'synthetic.pdf', mime: 'application/pdf', data: 'JVBERi0=' }]
const tools = [
  { name: 'get_song_job', description: 'job', inputSchema: { type: 'object', properties: {} } },
]
describe('AI provider request and response contracts', () => {
  it.each(['gemini', 'openai', 'claude'] as const)(
    '%s preserves native calls, continuations, PDF input, and usage',
    async (provider) => {
      const envelope =
        provider === 'gemini'
          ? {
              candidates: [
                {
                  content: {
                    role: 'model',
                    parts: [
                      {
                        thoughtSignature: 'opaque-signature',
                        functionCall: { name: 'get_song_job', args: {} },
                      },
                    ],
                  },
                },
              ],
              usageMetadata: { promptTokenCount: 4 },
            }
          : provider === 'openai'
            ? {
                status: 'completed',
                output: [
                  { type: 'function_call', name: 'get_song_job', arguments: '{}', call_id: 'call' },
                ],
                usage: { input_tokens: 4 },
              }
            : {
                content: [{ type: 'tool_use', id: 'call', name: 'get_song_job', input: {} }],
                usage: { input_tokens: 4 },
              }
      const request = vi
          .fn<typeof fetch>()
          .mockImplementation(async () => new Response(JSON.stringify(envelope))),
        adapter = new SongProvider(
          { id: 'p', name: 'test', provider, model: 'synthetic' },
          'synthetic-test-key',
          request,
        )
      const turn = await adapter.turn('prompt', files, tools, new AbortController().signal)
      expect(turn.calls[0].name).toBe('get_song_job')
      expect(Object.values(turn.usage)).toContain(4)
      adapter.answer(turn.calls, [{ result: 'staged' }])
      await adapter.turn('prompt', files, tools, new AbortController().signal)
      const body = JSON.parse(request.mock.calls[1][1]!.body as string)
      expect(JSON.stringify(body)).toContain('staged')
      expect(JSON.stringify(body)).toContain('JVBERi0=')
      expect(JSON.stringify(body)).not.toContain('synthetic-test-key')
      if (provider === 'gemini') {
        expect(JSON.stringify(body)).toContain('opaque-signature')
        expect(body.tools[0].functionDeclarations[0].parametersJsonSchema.type).toBe('object')
      }
      if (provider === 'openai') expect(body.tools[0].parameters.type).toBe('object')
      if (provider === 'openai') expect(body.store).toBe(false)
    },
  )
  it('rejects authentication, incomplete output, and oversized requests with actionable errors; respects abort signal', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 403 })),
      adapter = new SongProvider(
        { id: 'p', name: 'test', provider: 'openai', model: 'synthetic' },
        'key',
        request,
      )
    await expect(adapter.turn('', files, tools, new AbortController().signal)).rejects.toThrow(
      '접근 권한',
    )
    request.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'incomplete', output: [] })),
    )
    await expect(
      new SongProvider(
        { id: 'p', name: 'test', provider: 'openai', model: 'synthetic' },
        'key',
        request,
      ).turn('', files, tools, new AbortController().signal),
    ).rejects.toThrow('불완전')
    const large = new SongProvider(
      { id: 'p', name: 'test', provider: 'gemini', model: 'synthetic' },
      'key',
      request,
    )
    await expect(
      large.turn(
        '',
        [{ ...files[0], data: 'a'.repeat(20 * 1024 * 1024) }],
        tools,
        new AbortController().signal,
      ),
    ).rejects.toThrow('크기')
    const canceled = new AbortController()
    canceled.abort()
    request.mockImplementationOnce(async (_url, init) => {
      expect(init?.signal?.aborted).toBe(true)
      throw new DOMException('aborted', 'AbortError')
    })
    await expect(
      new SongProvider(
        { id: 'p', name: 'test', provider: 'openai', model: 'synthetic' },
        'key',
        request,
      ).turn('', [], tools, canceled.signal),
    ).rejects.toThrow('aborted')
  })
})
