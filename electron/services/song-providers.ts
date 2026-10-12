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
    const response = await this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: encoded,
      signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    })
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? 'AI 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.'
          : [401, 403, 404].includes(response.status)
            ? 'AI 키와 모델 접근 권한을 확인해주세요.'
            : 'AI 분석에 실패했습니다. 파일 크기·형식과 연결을 확인해주세요.',
      )
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
    } finally {
      reader.releaseLock()
    }
    // Native envelopes are kept only in memory, including Gemini thought signatures.
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
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
      if (result.status === 'incomplete')
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
        ([, v]) => typeof v === 'number',
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
