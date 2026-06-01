import type { Api } from '../../preload'
import type { AppConfig, CustomEndpointConfig, ConnectionMode, DirectConfig } from '../../shared/config'

export type { AppConfig, CustomEndpointConfig, ConnectionMode, DirectConfig }

export type Provider = 'openai' | 'anthropic' | 'gemini'
export type Role = 'user' | 'assistant' | 'system'

export interface Chat {
  id: string
  title: string
  provider: Provider
  model: string
  created_at: number
  updated_at: number
  context_summary?: string
  summary_through_id?: string
}

export interface Message {
  id: string
  chat_id: string
  role: Role
  content: string
  created_at: number
  isStreaming?: boolean
  isError?: boolean
}

declare global {
  interface Window {
    api: Api
  }
}
