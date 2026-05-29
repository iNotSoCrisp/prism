import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import {
  createChat,
  createMessage,
  deleteChat,
  getAllChats,
  getChat,
  getMessages,
  getSetting,
  setSetting,
  updateChatMeta,
  updateChatTitle,
  type Chat,
  type Message,
  type Provider,
  type Role
} from './db'
import { fetchAvailableModels, generateChatTitle, getProviderFromModel, streamCompletion, PROVIDER_CONFIG } from './llm'
import {
  DEFAULT_ENDPOINT_URL,
  DEFAULT_MODEL,
  type AppConfig,
  type ConnectionMode
} from '../shared/config'

interface CreateMessageInput {
  chatId: string
  role: Role
  content: string
}

interface UpdateMetaInput {
  provider: Provider
  model: string
}

export type IpcResult<T> = { success: true; data: T } | { success: false; error: string }

export function registerIpcHandlers(): void {
  handle('chats:getAll', () => getAllChats())

  handle('chats:create', (_event, meta?: Partial<UpdateMetaInput>) => {
    const chat = createChat(meta?.provider ?? 'openai', meta?.model ?? DEFAULT_MODEL)
    setSetting('activeChatId', chat.id)
    return chat
  })

  handle('chats:delete', (_event, id: string) => {
    deleteChat(id)
    if (getSetting('activeChatId') === id) {
      const nextChat = getAllChats()[0]
      setSetting('activeChatId', nextChat?.id ?? '')
    }
  })

  handle('chats:updateTitle', (_event, id: string, title: string) => updateChatTitle(id, title))

  handle('chats:updateMeta', (_event, id: string, meta: UpdateMetaInput) => updateChatMeta(id, meta.provider, meta.model))

  handle('messages:getAll', (_event, chatId: string) => getMessages(chatId))

  handle('messages:create', (_event, input: CreateMessageInput) => createMessage(input))

  ipcMain.on('llm:stream', (event, chatId: string, userMessage: string, model: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const send = (channel: string, ...args: unknown[]): void => {
      if (!window?.isDestroyed()) event.sender.send(channel, ...args)
    }

    void (async () => {
      try {
        const chat = getChat(chatId)
        if (!chat) throw new Error('Chat not found')

        const config = loadAppConfig()
        const existingMessages = getMessages(chatId)
        const user = createMessage({ chatId, role: 'user', content: userMessage })
        send('messages:created', user)

        const history = getMessages(chatId).map((message) => ({ role: message.role, content: message.content }))
        let assistantContent = ''
        let failed = false

        await streamCompletion(
          config,
          model,
          history,
          (token) => {
            assistantContent += token
            send('llm:token', token)
          },
          () => undefined,
          (message) => {
            failed = true
            send('llm:error', message)
          }
        )

        if (failed) return

        const assistant = createMessage({ chatId, role: 'assistant', content: assistantContent })
        send('messages:created', assistant)

        if (existingMessages.length === 0) {
          void generateAndPersistTitle(chatId, config, model, userMessage, send)
        }

        send('llm:done')
      } catch (error) {
        send('llm:error', errorToMessage(error))
      }
    })()
  })

  handle('settings:get', (_event, key: string) => getSetting(key))

  handle('settings:set', (_event, key: string, value: string) => {
    setSetting(key, value)
  })

  handle('settings:getConfig', () => loadAppConfig())

  // Dynamic model fetching for custom endpoint mode
  ipcMain.handle('endpoint:fetchModels', async (_, endpointUrl: string, apiKey: string) => {
    try {
      const models = await fetchAvailableModels(endpointUrl, apiKey)
      return { success: true, models }
    } catch (err: any) {
      return { success: false, error: err.message ?? 'Unknown error', models: [] }
    }
  })

  // Dynamic model fetching for Direct API providers
  // Looks up the base URL from PROVIDER_CONFIG so the renderer doesn't need it.
  // Anthropic and Gemini don't expose a standard /v1/models — they return empty.
  ipcMain.handle('direct:fetchModels', async (_, provider: string, apiKey: string) => {
    try {
      const config = PROVIDER_CONFIG[provider as keyof typeof PROVIDER_CONFIG]
      if (!config) {
        // Anthropic / Gemini — no standard /v1/models endpoint
        return { success: false, error: 'Provider does not support live model listing', models: [] }
      }
      const models = await fetchAvailableModels(config.baseURL, apiKey)
      return { success: true, models }
    } catch (err: any) {
      return { success: false, error: err.message ?? 'Unknown error', models: [] }
    }
  })

  // Open external URLs in the default system browser
  ipcMain.handle('shell:openExternal', async (_, url: string) => {
    await shell.openExternal(url)
  })
}

function loadAppConfig(): AppConfig {
  const mode = (getSetting('connection_mode') as ConnectionMode | null) ?? 'direct'
  return {
    mode,
    direct: {
      openaiKey:     getSetting('api_key_openai')     ?? '',
      anthropicKey:  getSetting('api_key_anthropic')  ?? '',
      geminiKey:     getSetting('api_key_gemini')     ?? '',
      groqKey:       getSetting('api_key_groq')       ?? '',
      openrouterKey: getSetting('api_key_openrouter') ?? '',
      deepseekKey:   getSetting('api_key_deepseek')   ?? '',
      moonshotKey:   getSetting('api_key_moonshot')   ?? '',
      qwenKey:       getSetting('api_key_qwen')       ?? '',
      mistralKey:    getSetting('api_key_mistral')    ?? '',
      xaiKey:        getSetting('api_key_xai')        ?? '',
      cerebrasKey:   getSetting('api_key_cerebras')   ?? '',
      fireworksKey:  getSetting('api_key_fireworks')  ?? ''
    },
    customEndpoint: {
      endpointUrl: getSetting('custom_endpoint_url') ?? DEFAULT_ENDPOINT_URL,
      apiKey:      getSetting('custom_endpoint_key') ?? ''
    },
    defaultModel: getSetting('default_model') ?? DEFAULT_MODEL
  }
}

function handle<T>(channel: string, listener: (event: IpcMainInvokeEvent, ...args: never[]) => T): void {
  ipcMain.handle(channel, (event, ...args): IpcResult<T> => {
    try {
      return { success: true, data: listener(event, ...(args as never[])) }
    } catch (error) {
      return { success: false, error: errorToMessage(error) }
    }
  })
}

async function generateAndPersistTitle(
  chatId: string,
  config: AppConfig,
  model: string,
  userMessage: string,
  send: (channel: string, ...args: unknown[]) => void
): Promise<void> {
  try {
    const title = await generateChatTitle(config, model, userMessage)
    if (title === 'New Chat') return
    const updated = updateChatTitle(chatId, title)
    if (updated) send('chats:updated', updated)
  } catch {
    // Title generation is non-critical; keep the default title on failure.
  }
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown IPC error'
}

export function providerFromModelForChat(model: string): Provider {
  const provider = getProviderFromModel(model)
  if (provider === 'anthropic' || provider === 'gemini') return provider
  return 'openai'
}

export type IpcChat = Chat
export type IpcMessage = Message
