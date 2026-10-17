import { describe, expect, it, vi } from 'vitest'
import { SongProvider } from '../electron/services/song-providers'
const files = [{ id: 'source', name: 'synthetic.pdf', mime: 'application/pdf', data: 'JVBERi0=' }]
const tools = [
  { name: 'get_song_job', description: 'job', inputSchema: { type: 'object', properties: {} } },
]
describe('AI provider request and response contracts', () => {
  it('explains Gemini payment-required errors without blaming the file or exposing remote content', async () => {
    const adapter = new SongProvider(
      { id: 'p', name: 'test', provider: 'gemini', model: 'synthetic' },
      'synthetic-private-key',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: 'synthetic-private-key private source' } }),
            { status: 402 },
          ),
        ),
    )
    const failure = await adapter
      .turn('', files, tools, new AbortController().signal)
      .catch((e: Error) => e)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('Gemini API (402)')
    expect((failure as Error).message).toContain('선불 크레딧 잔액')
    expect((failure as Error).message).toContain('Free Tier')
    expect((failure as Error).message).not.toContain('파일 크기')
    expect((failure as Error).message).not.toContain('synthetic-private-key')
    expect((failure as Error).message).not.toContain('private source')
  })
  it.each([
    {
      provider: 'gemini' as const,
      error: { details: [{ violations: [{ quotaValue: '0' }] }] },
      expected: '할당량이 0',
    },
    {
      provider: 'gemini' as const,
      error: {
        details: [
          { violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
        ],
      },
      expected: '일일 사용 한도',
    },
    {
      provider: 'gemini' as const,
      error: {
        details: [
          { violations: [{ quotaMetric: 'generate_content_free_tier_input_tokens_per_minute' }] },
        ],
      },
      expected: '분당 요청 또는 토큰',
    },
    { provider: 'gemini' as const, error: {}, expected: '일시 제한인지 확정할 수 없습니다' },
    {
      provider: 'openai' as const,
      error: { code: 'credit_balance_exhausted' },
      expected: '기다리는 것만으로는 해결되지 않습니다',
    },
    {
      provider: 'openai' as const,
      error: { type: 'insufficient_quota' },
      expected: '크레딧 또는 사용·지출 한도',
    },
    {
      provider: 'openai' as const,
      error: { code: 'rate_limit_exceeded' },
      expected: '일시적인 요청 제한',
    },
  ])(
    'distinguishes $provider quota failures without exposing provider messages ($expected)',
    async ({ provider, error, expected }) => {
      const adapter = new SongProvider(
        { id: 'p', name: 'test', provider, model: 'synthetic' },
        'synthetic-private-key',
        vi.fn<typeof fetch>().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: { ...error, message: 'synthetic-private-key private source content' },
            }),
            { status: 429 },
          ),
        ),
      )
      const failure = await adapter
        .turn('', files, tools, new AbortController().signal)
        .catch((e: Error) => e)
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toContain(expected)
      expect((failure as Error).message).toContain('429')
      expect((failure as Error).message).not.toContain('synthetic-private-key')
      expect((failure as Error).message).not.toContain('private source content')
    },
  )
  it.each(['not JSON', 'x'.repeat(65537), 'null', '{"error":{"details":null}}'])(
    'keeps malformed and oversized provider errors safe',
    async (body) => {
      const adapter = new SongProvider(
        { id: 'p', name: 'test', provider: 'gemini', model: 'synthetic' },
        'key',
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 429 })),
      )
      await expect(adapter.turn('', files, tools, new AbortController().signal)).rejects.toThrow(
        'Google AI Studio',
      )
    },
  )
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
    ).rejects.toThrow('취소')
  })
  it.each(['gemini', 'openai', 'claude'] as const)(
    '%s rejects malformed success responses without exposing private contents',
    async (provider) => {
      const bodies = [
        'private-source-and-synthetic-key invalid JSON',
        'null',
        JSON.stringify({
          candidates: [{ content: { parts: 'private-source' } }],
          output: 'private-source',
          content: 'private-source',
        }),
        JSON.stringify({
          candidates: [
            { content: { parts: [{ functionCall: { name: { private: 'source' }, args: {} } }] } },
          ],
          output: [
            { type: 'function_call', arguments: {}, call_id: 'call', name: 'stage_song_drafts' },
          ],
          content: [{ type: 'tool_use', id: 'call', name: 'stage_song_drafts', input: null }],
        }),
      ]
      for (const body of bodies) {
        const adapter = new SongProvider(
          { id: 'p', name: 'test', provider, model: 'synthetic' },
          'synthetic-key',
          vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
        )
        const failure = await adapter
          .turn('', files, tools, new AbortController().signal)
          .catch((error: Error) => error)
        expect(failure).toBeInstanceOf(Error)
        expect((failure as Error).message).toContain('응답 형식')
        expect((failure as Error).message).not.toContain('private-source')
        expect((failure as Error).message).not.toContain('synthetic-key')
      }
    },
  )
  it('sanitizes network and stream failures instead of persisting private exception messages', async () => {
    for (const request of [
      vi.fn<typeof fetch>().mockRejectedValue(new Error('private-source synthetic-key')),
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('private-source synthetic-key'))
            },
          }),
        ),
      ),
    ]) {
      const adapter = new SongProvider(
        { id: 'p', name: 'test', provider: 'openai', model: 'synthetic' },
        'synthetic-key',
        request,
      )
      const failure = await adapter
        .turn('', files, tools, new AbortController().signal)
        .catch((error: Error) => error)
      expect((failure as Error).message).toContain('인터넷 연결')
      expect((failure as Error).message).not.toContain('private-source')
      expect((failure as Error).message).not.toContain('synthetic-key')
    }
  })
})
