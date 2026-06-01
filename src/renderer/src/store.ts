import { create } from 'zustand'
import {
  DEFAULT_ENDPOINT_URL,
  EMPTY_CUSTOM_ENDPOINT_CONFIG,
  EMPTY_DIRECT_CONFIG,
  type ConnectionMode,
  type CustomEndpointConfig,
  type DirectConfig
} from '../../shared/config'
import type { Chat, Message } from './types'

interface AppState {
  chats: Chat[]
  activeChat: Chat | null
  messages: Message[]
  isStreaming: boolean
  goalIteration: { current: number; max: number } | null
  connectionMode: ConnectionMode
  directConfig: DirectConfig
  customEndpointConfig: CustomEndpointConfig
  defaultModel: string

  // Dynamic model fetching (custom endpoint mode)
  availableModels: string[]
  modelsLoading: boolean
  modelsError: string | null

  // Dynamic model fetching (direct API mode — per provider)
  directModels: Record<string, string[]>      // provider key → fetched model IDs
  directModelsLoading: Record<string, boolean> // provider key → loading flag

  setChats: (chats: Chat[]) => void
  setActiveChat: (chat: Chat | null) => void
  upsertChat: (chat: Chat) => void
  removeChat: (id: string) => void
  setMessages: (messages: Message[]) => void
  addMessage: (message: Message) => void
  appendToken: (token: string) => void
  replaceStreamingMessage: (message: Message) => void
  setStreaming: (streaming: boolean) => void
  setGoalIteration: (iteration: { current: number; max: number } | null) => void
  setConnectionMode: (mode: ConnectionMode) => void
  setDirectConfig: (config: DirectConfig) => void
  setCustomEndpointConfig: (config: CustomEndpointConfig) => void
  setDefaultModel: (model: string) => void
  setAvailableModels: (models: string[]) => void
  setModelsLoading: (v: boolean) => void
  setModelsError: (err: string | null) => void
  setDirectModels: (provider: string, models: string[]) => void
  setDirectModelsLoading: (provider: string, v: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  chats: [],
  activeChat: null,
  messages: [],
  isStreaming: false,
  goalIteration: null,
  connectionMode: 'direct',
  directConfig: EMPTY_DIRECT_CONFIG,
  customEndpointConfig: EMPTY_CUSTOM_ENDPOINT_CONFIG,
  defaultModel: 'gpt-4o',

  availableModels: [],
  modelsLoading: false,
  modelsError: null,

  directModels: {},
  directModelsLoading: {},

  setChats: (chats) => set({ chats }),
  setActiveChat: (chat) => set({ activeChat: chat }),
  upsertChat: (chat) =>
    set((state) => {
      const chats = state.chats.some((item) => item.id === chat.id)
        ? state.chats.map((item) => (item.id === chat.id ? chat : item))
        : [chat, ...state.chats]
      return {
        chats: [...chats].sort((a, b) => b.updated_at - a.updated_at),
        activeChat: state.activeChat?.id === chat.id ? chat : state.activeChat
      }
    }),
  removeChat: (id) =>
    set((state) => ({
      chats: state.chats.filter((chat) => chat.id !== id),
      activeChat: state.activeChat?.id === id ? null : state.activeChat
    })),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  appendToken: (token) =>
    set((state) => {
      const messages = [...state.messages]
      const lastAssistantIndex = findLastAssistantIndex(messages)

      if (lastAssistantIndex === -1 || !messages[lastAssistantIndex].isStreaming) {
        return {
          messages: [
            ...messages,
            {
              id: `streaming-${Date.now()}`,
              chat_id: state.activeChat?.id ?? '',
              role: 'assistant',
              content: token,
              created_at: Date.now(),
              isStreaming: true
            }
          ]
        }
      }

      const lastAssistant = messages[lastAssistantIndex]
      messages[lastAssistantIndex] = { ...lastAssistant, content: lastAssistant.content + token }
      return { messages }
    }),
  replaceStreamingMessage: (message) =>
    set((state) => {
      const streamingIndex = state.messages.findIndex((item) => item.isStreaming)
      if (streamingIndex === -1) return { messages: [...state.messages, message] }
      return {
        messages: state.messages.map((item, index) => (index === streamingIndex ? message : item))
      }
    }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setGoalIteration: (iteration) => set({ goalIteration: iteration }),
  setConnectionMode: (mode) => set({ connectionMode: mode }),
  setDirectConfig: (config) => set({ directConfig: config }),
  setCustomEndpointConfig: (config) => set({ customEndpointConfig: config }),
  setDefaultModel: (model) => set({ defaultModel: model }),
  setAvailableModels: (models) => set({ availableModels: models }),
  setModelsLoading: (v) => set({ modelsLoading: v }),
  setModelsError: (err) => set({ modelsError: err }),
  setDirectModels: (provider, models) =>
    set((state) => ({ directModels: { ...state.directModels, [provider]: models } })),
  setDirectModelsLoading: (provider, v) =>
    set((state) => ({ directModelsLoading: { ...state.directModelsLoading, [provider]: v } }))
}))
function findLastAssistantIndex(messages: Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') return index
  }
  return -1
}

