import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import type { AppConfig, DirectConfig } from '../shared/config'

export interface CompletionMessage {
  role: string
  content: string
}

// ─── Provider types ───────────────────────────────────────────────────────────

type Provider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'openrouter'
  | 'deepseek'
  | 'moonshot'
  | 'qwen'
  | 'mistral'
  | 'xai'       // xAI — makers of Grok. NOT Xiaomi the phone company.
  | 'cerebras'
  | 'fireworks'

/**
 * Base URLs for all OpenAI-compatible providers.
 * Anthropic and Gemini are excluded — they use their own dedicated SDKs.
 */
export const PROVIDER_CONFIG: Record<Exclude<Provider, 'anthropic' | 'gemini'>, { baseURL: string }> = {
  openai:     { baseURL: 'https://api.openai.com/v1' },
  groq:       { baseURL: 'https://api.groq.com/openai/v1' },
  openrouter: { baseURL: 'https://openrouter.ai/api/v1' },
  deepseek:   { baseURL: 'https://api.deepseek.com/v1' },
  moonshot:   { baseURL: 'https://api.moonshot.cn/v1' },
  qwen:       { baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
  mistral:    { baseURL: 'https://api.mistral.ai/v1' },
  xai:        { baseURL: 'https://api.x.ai/v1' },
  cerebras:   { baseURL: 'https://api.cerebras.ai/v1' },
  fireworks:  { baseURL: 'https://api.fireworks.ai/inference/v1' },
}

// ─── Provider detection ───────────────────────────────────────────────────────

export function detectProvider(model: string): Provider {
  const m = model.toLowerCase()
  if (m.startsWith('claude')) return 'anthropic'
  if (m.startsWith('gemini')) return 'gemini'
  if (m.startsWith('deepseek')) return 'deepseek'
  if (m.startsWith('moonshot') || m.startsWith('kimi')) return 'moonshot'
  if (m.startsWith('qwen')) return 'qwen'
  if (m.startsWith('mistral') || m.startsWith('mixtral') || m.startsWith('codestral')) return 'mistral'
  if (m.startsWith('grok')) return 'xai'
  if (m.startsWith('llama') && m.includes('cerebras')) return 'cerebras'
  if (m.includes('fireworks/') || m.startsWith('accounts/fireworks')) return 'fireworks'
  if (m.includes('/')) return 'openrouter' // OpenRouter format: vendor/model
  if (m.startsWith('llama') || m.startsWith('llama3')) return 'groq'
  return 'openai'
}

// Keep legacy alias for backward compat with ipc.ts
export const getProviderFromModel = detectProvider

function getApiKeyForProvider(direct: DirectConfig, provider: Provider): string {
  switch (provider) {
    case 'openai':     return direct.openaiKey
    case 'anthropic':  return direct.anthropicKey
    case 'gemini':     return direct.geminiKey
    case 'groq':       return direct.groqKey
    case 'openrouter': return direct.openrouterKey
    case 'deepseek':   return direct.deepseekKey
    case 'moonshot':   return direct.moonshotKey
    case 'qwen':       return direct.qwenKey
    case 'mistral':    return direct.mistralKey
    case 'xai':        return direct.xaiKey
    case 'cerebras':   return direct.cerebrasKey
    case 'fireworks':  return direct.fireworksKey
    default:           return ''
  }
}

// ─── Streaming helpers ────────────────────────────────────────────────────────

async function streamOpenAICompatible(
  baseURL: string,
  apiKey: string,
  model: string,
  messages: CompletionMessage[],
  onToken: (t: string) => void,
  onDone: () => void,
  onError: (e: string) => void
): Promise<void> {
  try {
    const client = new OpenAI({ baseURL, apiKey })
    const stream = await client.chat.completions.create({
      model,
      messages: messages.map((msg) => ({
        role: normalizeOpenAIRole(msg.role),
        content: msg.content
      })),
      stream: true
    })
    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? ''
      if (token) onToken(token)
    }
    onDone()
  } catch (err: any) {
    onError(err.message ?? 'Stream failed')
  }
}

async function streamAnthropic(
  model: string,
  apiKey: string,
  messages: CompletionMessage[],
  onToken: (token: string) => void
): Promise<void> {
  const client = new Anthropic({ apiKey })
  const { system, conversation } = toAnthropicMessages(messages)
  const stream = client.messages.stream({
    model,
    max_tokens: 4096,
    system: system || undefined,
    messages: conversation
  })

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      onToken(event.delta.text)
    }
  }
}

async function streamGemini(
  model: string,
  apiKey: string,
  messages: CompletionMessage[],
  onToken: (token: string) => void
): Promise<void> {
  const client = new GoogleGenerativeAI(apiKey)
  const { systemInstruction, contents } = toGeminiContents(messages)
  const generativeModel = client.getGenerativeModel({ model, systemInstruction: systemInstruction || undefined })
  const result = await generativeModel.generateContentStream({ contents })

  for await (const chunk of result.stream) {
    const token = chunk.text()
    if (token) onToken(token)
  }
}

// ─── Main entry points ────────────────────────────────────────────────────────

async function streamViaDirect(
  direct: DirectConfig,
  model: string,
  messages: CompletionMessage[],
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): Promise<void> {
  try {
    const provider = detectProvider(model)
    const apiKey = getApiKeyForProvider(direct, provider)

    if (!apiKey.trim()) {
      onError('No API key set for this provider. Add it in Settings.')
      return
    }

    if (provider === 'anthropic') {
      await streamAnthropic(model, apiKey, messages, onToken)
      onDone()
    } else if (provider === 'gemini') {
      await streamGemini(model, apiKey, messages, onToken)
      onDone()
    } else {
      const { baseURL } = PROVIDER_CONFIG[provider]
      await streamOpenAICompatible(baseURL, apiKey, model, messages, onToken, onDone, onError)
    }
  } catch (error) {
    onError(errorToMessage(error))
  }
}

async function streamViaCustomEndpoint(
  endpointUrl: string,
  apiKey: string,
  model: string,
  messages: CompletionMessage[],
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): Promise<void> {
  // Normalize URL — ensure it ends with /v1
  let base = endpointUrl.trim().replace(/\/$/, '')
  if (!base.endsWith('/v1')) base = `${base}/v1`

  await streamOpenAICompatible(base, apiKey || 'dummy-key', model, messages, onToken, onDone, onError)
}

export async function streamCompletion(
  config: AppConfig,
  model: string,
  messages: CompletionMessage[],
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): Promise<void> {
  try {
    if (config.mode === 'custom') {
      await streamViaCustomEndpoint(
        config.customEndpoint.endpointUrl,
        config.customEndpoint.apiKey,
        model,
        messages,
        onToken,
        onDone,
        onError
      )
    } else {
      await streamViaDirect(config.direct, model, messages, onToken, onDone, onError)
    }
  } catch (error) {
    onError(errorToMessage(error))
  }
}

// ─── Dynamic model fetching ───────────────────────────────────────────────────

export async function fetchAvailableModels(
  endpointUrl: string,
  apiKey?: string
): Promise<string[]> {
  try {
    // Normalize URL — ensure it ends with /v1
    let base = endpointUrl.trim().replace(/\/$/, '')
    if (!base.endsWith('/v1')) base = `${base}/v1`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (apiKey && apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`
    }

    const res = await fetch(`${base}/models`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()

    if (Array.isArray(data?.data)) {
      return data.data.map((m: any) => m.id || m.name).filter(Boolean)
    }
    if (Array.isArray(data?.models)) {
      return data.models.map((m: any) => m.id || m.name).filter(Boolean)
    }
    if (Array.isArray(data)) {
      return data.map((m: any) => m.id || m.name).filter(Boolean)
    }
    return []
  } catch (err) {
    console.error('Failed to fetch models from endpoint:', err)
    return []
  }
}

// ─── Chat title generation ────────────────────────────────────────────────────

export async function generateChatTitle(config: AppConfig, model: string, firstUserMessage: string): Promise<string> {
  const prompt = `Summarize this in 4 words max: ${firstUserMessage}`

  try {
    if (config.mode === 'custom') {
      let base = config.customEndpoint.endpointUrl.trim().replace(/\/$/, '')
      if (!base.endsWith('/v1')) base = `${base}/v1`
      const client = new OpenAI({ baseURL: base, apiKey: config.customEndpoint.apiKey || 'dummy-key' })
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 20
      })
      return cleanTitle(response.choices[0]?.message?.content ?? '')
    }

    const provider = detectProvider(model)
    const apiKey = getApiKeyForProvider(config.direct, provider)
    if (!apiKey.trim()) return 'New Chat'

    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey })
      const response = await client.messages.create({
        model,
        max_tokens: 20,
        messages: [{ role: 'user', content: prompt }]
      })
      return cleanTitle(response.content.map((block) => (block.type === 'text' ? block.text : '')).join(''))
    }

    if (provider === 'gemini') {
      const client = new GoogleGenerativeAI(apiKey)
      const generativeModel = client.getGenerativeModel({ model, generationConfig: { maxOutputTokens: 20 } })
      const response = await generativeModel.generateContent(prompt)
      return cleanTitle(response.response.text())
    }

    const { baseURL } = PROVIDER_CONFIG[provider]
    const client = new OpenAI({ apiKey, baseURL })
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 20
    })
    return cleanTitle(response.choices[0]?.message?.content ?? '')
  } catch {
    return 'New Chat'
  }
}

// ─── Message format converters ────────────────────────────────────────────────

function toAnthropicMessages(messages: CompletionMessage[]): {
  system: string
  conversation: { role: 'user' | 'assistant'; content: string }[]
} {
  return {
    system: messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n'),
    conversation: messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: message.content
      }))
  }
}

function toGeminiContents(messages: CompletionMessage[]): {
  systemInstruction: string
  contents: { role: 'user' | 'model'; parts: { text: string }[] }[]
} {
  return {
    systemInstruction: messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n'),
    contents: messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text: message.content }]
      }))
  }
}

function normalizeOpenAIRole(role: string): 'system' | 'user' | 'assistant' {
  if (role === 'system' || role === 'assistant') return role
  return 'user'
}

function cleanTitle(value: string): string {
  const title = value.replace(/["""]/g, '').replace(/\s+/g, ' ').trim()
  return title || 'New Chat'
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown LLM error'
}
