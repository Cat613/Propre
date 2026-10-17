import { z } from 'zod'
import type { ConnectionProfile } from '../../shared/song-preparation'
export interface ProviderFile {
  id: string
  name: string
  mime: string
  data: string
}
export interface ModelTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
export interface ModelCall {
  id: string
  name: string
  arguments: unknown
}
export interface ModelTurn {
  calls: ModelCall[]
  native: unknown
  usage: Record<string, number>
}
// Read only structured error fields. Provider messages may echo private input or keys.
async function providerFailure(response: Response, provider: ConnectionProfile['provider']) {
  let error: any = {}
  const reader = response.body?.getReader()
  if (reader) {
    try {
      const chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.length
        if (size > 65536) break
        chunks.push(part.value)
      }
      if (size <= 65536) error = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.error || {}
    } catch {
      // An empty, non-JSON or unreadable error still has a useful HTTP status.
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
  const name = { gemini: 'Gemini', openai: 'OpenAI', claude: 'Claude' }[provider]
  const prefix = `${name} API (${response.status}): `
  if (response.status === 402)
    return (
      prefix +
      (provider === 'gemini'
        ? '결제가 필요한 상태입니다. Google AI Studio에서 키가 속한 프로젝트의 결제 상태와 선불 크레딧 잔액을 확인해주세요. 유료 프로젝트는 잔액이 없어져도 무료 구간으로 자동 전환되지 않습니다. 무료로 사용하려면 Free Tier 프로젝트의 키를 선택해주세요.'
        : '결제가 필요한 상태입니다. 제공자 계정의 API 결제 상태와 크레딧 잔액을 확인해주세요.')
    )
  if (response.status === 429) {
    if (provider === 'gemini') {
      const details = Array.isArray(error?.details) ? error.details : []
      const violations = details.flatMap((d: any) =>
        Array.isArray(d?.violations) ? d.violations : [],
      )
      const quota = violations.map((v: any) => `${v?.quotaId || ''} ${v?.quotaMetric || ''}`)
      if (violations.some((v: any) => v?.quotaValue === '0' || v?.quotaValue === 0))
        return (
          prefix +
          '이 프로젝트에서 해당 모델의 할당량이 0입니다. Google AI Studio에서 키가 속한 프로젝트의 모델별 한도·결제 상태를 확인해주세요. 기다리거나 같은 프로젝트의 키를 새로 만들어도 해결되지 않을 수 있습니다.'
        )
      if (quota.some((q: string) => /PerDay|per_day/i.test(q)))
        return (
          prefix +
          '일일 사용 한도를 초과했습니다. Google AI Studio에서 해당 프로젝트의 한도와 초기화 시점을 확인해주세요.'
        )
      if (quota.some((q: string) => /PerMinute|per_minute/i.test(q)))
        return (
          prefix +
          '분당 요청 또는 토큰 한도를 초과했습니다. 잠시 후 다시 시도하거나 파일·곡 수를 줄여주세요. Google AI Studio에서 프로젝트 한도를 확인할 수 있습니다.'
        )
      return (
        prefix +
        '요청·토큰·일일 할당량 또는 결제 한도에 걸렸습니다. Google AI Studio에서 키가 속한 프로젝트의 사용량·모델별 한도·결제 상태를 확인해주세요. 이 응답만으로 일시 제한인지 확정할 수 없습니다.'
      )
    }
    if (
      provider === 'openai' &&
      (error?.type === 'insufficient_quota' ||
        [
          'insufficient_quota',
          'credit_balance_exhausted',
          'organization_usage_limit_exceeded',
          'organization_spend_limit_exceeded',
          'project_spend_limit_exceeded',
        ].includes(error?.code))
    )
      return (
        prefix +
        'API 크레딧 또는 사용·지출 한도가 부족합니다. OpenAI Platform에서 키가 속한 조직·프로젝트의 잔액과 한도를 확인해주세요. 기다리는 것만으로는 해결되지 않습니다.'
      )
    return (
      prefix +
      '요청 또는 사용 한도에 걸렸습니다. 제공자 계정의 잔액·사용 한도를 확인하고, 일시적인 요청 제한이면 잠시 후 다시 시도해주세요.'
    )
  }
  if ([401, 403, 404].includes(response.status))
    return prefix + 'AI 키와 모델 접근 권한을 확인해주세요.'
  return prefix + 'AI 분석에 실패했습니다. 파일 크기·형식과 연결을 확인해주세요.'
}
const record = z.record(z.string(), z.unknown())
const callName = z.string().min(1).max(160)
const geminiEnvelope = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z.array(
                  z
                    .object({
                      functionCall: z
                        .object({ name: callName, args: record, id: z.string().optional() })
                        .optional(),
                    })
                    .passthrough(),
                ),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough()
const openaiEnvelope = z
  .object({
    output: z.array(
      z
        .object({ type: z.string() })
        .passthrough()
        .superRefine((value, ctx) => {
          if (
            value.type === 'function_call' &&
            !z
              .object({
                call_id: z.string().min(1),
                name: callName,
                arguments: z.string(),
              })
              .safeParse(value).success
          )
            ctx.addIssue({ code: 'custom', message: 'Invalid tool call' })
        }),
    ),
  })
  .passthrough()
const claudeEnvelope = z
  .object({
    content: z.array(
      z
        .object({ type: z.string() })
        .passthrough()
        .superRefine((value, ctx) => {
          if (
            value.type === 'tool_use' &&
            !z
              .object({
                id: z.string().min(1),
                name: callName,
                input: record,
              })
              .safeParse(value).success
          )
            ctx.addIssue({ code: 'custom', message: 'Invalid tool call' })
        }),
    ),
  })
  .passthrough()
function transportFailure(signal: AbortSignal) {
  if (signal.aborted && signal.reason?.name === 'TimeoutError')
    return new Error(
      'AI 응답 대기 시간(2분)이 지났습니다. 확보된 초안을 확인하거나 파일을 나누어 다시 분석해주세요.',
    )
  if (signal.aborted) return new DOMException('분석이 취소되었습니다.', 'AbortError')
  return new Error('AI에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 분석해주세요.')
}
const malformedResponse = () =>
  new Error('AI 응답 형식을 읽지 못했습니다. 확보된 초안을 확인하거나 다시 분석해주세요.')
export class SongProvider {
  private history: unknown[] = []
  constructor(
    private profile: ConnectionProfile,
    private key: string,
    private request = fetch,
  ) {}
  async turn(
    prompt: string,
    files: ProviderFile[],
    tools: ModelTool[],
    signal: AbortSignal,
    systemInstruction?: string,
  ): Promise<ModelTurn> {
    const provider = this.profile.provider
    const content = files.flatMap((f) => {
      const label = `첨부 파일: ${JSON.stringify({ sourceId: f.id, name: f.name })}`
      const attachment =
        provider === 'gemini'
          ? { inlineData: { mimeType: f.mime, data: f.data } }
          : provider === 'openai'
            ? f.mime === 'application/pdf'
              ? {
                  type: 'input_file',
                  filename: f.name,
                  file_data: `data:${f.mime};base64,${f.data}`,
                }
              : { type: 'input_image', image_url: `data:${f.mime};base64,${f.data}` }
            : {
                type: f.mime === 'application/pdf' ? 'document' : 'image',
                source: { type: 'base64', media_type: f.mime, data: f.data },
              }
      return provider === 'gemini'
        ? [{ text: label }, attachment]
        : [{ type: provider === 'openai' ? 'input_text' : 'text', text: label }, attachment]
    })
    const user =
      provider === 'gemini'
        ? { role: 'user', parts: [{ text: prompt }, ...content] }
        : {
            role: 'user',
            content: [
              { type: provider === 'openai' ? 'input_text' : 'text', text: prompt },
              ...content,
            ],
          }
    if (!this.history.length) this.history.push(user)
    const body =
      provider === 'gemini'
        ? {
            ...(systemInstruction
              ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
              : {}),
            contents: this.history,
            tools: [
              {
                functionDeclarations: tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parametersJsonSchema: t.inputSchema,
                })),
              },
            ],
            generationConfig: { maxOutputTokens: 16000 },
          }
        : provider === 'openai'
          ? {
              model: this.profile.model,
              ...(systemInstruction ? { instructions: systemInstruction } : {}),
              input: this.history,
              store: false,
              max_output_tokens: 16000,
              tools: tools.map((t) => ({
                type: 'function',
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
                strict: false,
              })),
            }
          : {
              model: this.profile.model,
              max_tokens: 16000,
              ...(systemInstruction ? { system: systemInstruction } : {}),
              messages: this.history,
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema,
              })),
            }
    const encoded = JSON.stringify(body)
    if (Buffer.byteLength(encoded) > (provider === 'gemini' ? 19 : 30) * 1024 * 1024)
      throw new Error(
        '이 AI의 한 번에 읽을 수 있는 크기를 초과했습니다. 파일을 나누거나 줄인 뒤 다시 시도해주세요.',
      )
    const url =
      provider === 'gemini'
        ? `https://generativelanguage.googleapis.com/v1beta/models/${this.profile.model}:generateContent`
        : provider === 'openai'
          ? 'https://api.openai.com/v1/responses'
          : 'https://api.anthropic.com/v1/messages'
    const headers: Record<string, string> =
      provider === 'gemini'
        ? { 'x-goog-api-key': this.key }
        : provider === 'openai'
          ? { Authorization: `Bearer ${this.key}` }
          : { 'x-api-key': this.key, 'anthropic-version': '2023-06-01' }
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(120000)])
    let response: Response
    try {
      response = await this.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: encoded,
        signal: requestSignal,
      })
    } catch {
      throw transportFailure(requestSignal)
    }
    if (!response.ok) throw new Error(await providerFailure(response, provider))
    const reader = response.body?.getReader()
    if (!reader) throw new Error('AI 응답을 읽지 못했습니다.')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        length += part.value.length
        if (length > 4 * 1024 * 1024) {
          await reader.cancel()
          throw new Error('AI 응답이 너무 큽니다. 곡 수를 줄여주세요.')
        }
        chunks.push(part.value)
      }
    } catch {
      if (length > 4 * 1024 * 1024) throw new Error('AI 응답이 너무 큽니다. 곡 수를 줄여주세요.')
      throw transportFailure(requestSignal)
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    // Native envelopes are kept only in memory, including Gemini thought signatures.
    let result: any
    try {
      result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw malformedResponse()
    }
    const schema =
      provider === 'gemini'
        ? geminiEnvelope
        : provider === 'openai'
          ? openaiEnvelope
          : claudeEnvelope
    if (!schema.safeParse(result).success) throw malformedResponse()
    let calls: ModelCall[]
    if (provider === 'gemini') {
      const native = result.candidates?.[0]?.content
      if (!native || result.candidates?.[0]?.finishReason === 'MAX_TOKENS')
        throw new Error('AI 출력이 불완전합니다. 파일이나 곡 수를 줄여 다시 분석해주세요.')
      this.history.push(native)
      calls = (native.parts || [])
        .filter((p: any) => p.functionCall)
        .map((p: any, i: number) => ({
          id: p.functionCall.id || String(i),
          name: p.functionCall.name,
          arguments: p.functionCall.args,
        }))
    } else if (provider === 'openai') {
      if (['incomplete', 'failed', 'cancelled', 'canceled'].includes(result.status))
        throw new Error('AI 출력이 불완전합니다. 곡 수를 줄여주세요.')
      this.history.push(...(result.output || []))
      calls = (result.output || [])
        .filter((p: any) => p.type === 'function_call')
        .map((p: any) => ({ id: p.call_id, name: p.name, arguments: parseArguments(p.arguments) }))
    } else {
      if (result.stop_reason === 'max_tokens')
        throw new Error('AI 출력이 불완전합니다. 곡 수를 줄여주세요.')
      this.history.push({ role: 'assistant', content: result.content })
      calls = (result.content || [])
        .filter((p: any) => p.type === 'tool_use')
        .map((p: any) => ({ id: p.id, name: p.name, arguments: p.input }))
    }
    const usage = Object.fromEntries(
      Object.entries(result.usage || result.usageMetadata || {}).filter(
        ([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
      ),
    ) as Record<string, number>
    return { calls, native: result, usage }
  }
  answer(calls: ModelCall[], results: unknown[]) {
    if (this.profile.provider === 'gemini')
      this.history.push({
        role: 'user',
        parts: calls.map((call, i) => ({
          functionResponse: { id: call.id, name: call.name, response: { result: results[i] } },
        })),
      })
    else if (this.profile.provider === 'openai')
      this.history.push(
        ...calls.map((call, i) => ({
          type: 'function_call_output',
          call_id: call.id,
          output: JSON.stringify(results[i]),
        })),
      )
    else
      this.history.push({
        role: 'user',
        content: calls.map((call, i) => ({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(results[i]),
        })),
      })
  }
}
function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return { invalidArguments: true }
  }
}
