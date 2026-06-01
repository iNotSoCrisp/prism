import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import {
  createChat,
  createMessage,
  deleteChat,
  getAllChats,
  getAllMemories,
  deleteMemory,
  getChat,
  searchChats,
  getMessages,
  getSetting,
  setSetting,
  updateChatMeta,
  updateChatTitle,
  type Chat,
  type Memory,
  type Message,
  type Provider,
  type Role
} from './db'
import { fetchAvailableModels, generateChatTitle, extractMemories, getProviderFromModel, streamCompletion, PROVIDER_CONFIG, cancelStream, isCancelled, resetCancelled, compactHistory } from './llm'
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
  
  handle('chats:search', (_event, query: string) => searchChats(query))

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

  handle('chats:updateMeta', (_event, chatId: string, meta: { provider: Provider; model: string }) =>
    updateChatMeta(chatId, meta.provider, meta.model)
  )

  function buildOptimizedHistory(chatId: string, chat: Chat) {
    const fullHistory = getMessages(chatId)
    
    let recentIndex = 0
    if (chat.summary_through_id) {
      const idx = fullHistory.findIndex(m => m.id === chat.summary_through_id)
      if (idx !== -1) {
        recentIndex = idx + 1
      }
    }
    
    const recentMessages = fullHistory.slice(recentIndex).map(m => ({ role: m.role, content: m.content }))
    const history: { role: string; content: string }[] = []
    
    const memories = getAllMemories()
    if (memories.length > 0) {
      const memoryText = memories.map(m => `- ${m.content}`).join('\n')
      const systemPrompt = `Here are some facts and preferences you should remember about the user:\n${memoryText}`
      history.push({ role: 'system', content: systemPrompt })
    }
    
    if (chat.context_summary) {
      history.push({ role: 'system', content: `Summary of earlier conversation:\n${chat.context_summary}` })
    }
    
    history.push(...recentMessages)
    return history
  }

  handle('messages:getAll', (_event, chatId: string) => getMessages(chatId))

  handle('messages:create', (_event, input: CreateMessageInput) => createMessage(input))

  handle('memories:getAll', () => getAllMemories())

  handle('memories:delete', (_event, id: string) => deleteMemory(id))

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

        const history = buildOptimizedHistory(chatId, chat)

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

        if (isCancelled) {
          // Asynchronously compact history if it exceeds threshold
          const allMsgs = getMessages(chatId)
          let recentCount = allMsgs.length
          if (chat.summary_through_id) {
            const idx = allMsgs.findIndex(m => m.id === chat.summary_through_id)
            if (idx !== -1) recentCount = allMsgs.length - (idx + 1)
          }
          if (recentCount > 25) {
            void compactHistory(chat, allMsgs, config)
          }

          send('llm:done')
          return
        }

        const assistant = createMessage({ chatId, role: 'assistant', content: assistantContent })
        send('messages:created', assistant)

        if (existingMessages.length === 0) {
          void generateAndPersistTitle(chatId, config, model, userMessage, send)
        }

        // Asynchronously extract any new memories from the user's message
        void extractMemories(config, model, userMessage)

        // Asynchronously compact history if it exceeds threshold
        const allMsgs = getMessages(chatId)
        let recentCount = allMsgs.length
        if (chat.summary_through_id) {
          const idx = allMsgs.findIndex(m => m.id === chat.summary_through_id)
          if (idx !== -1) recentCount = allMsgs.length - (idx + 1)
        }
        if (recentCount > 25) {
          void compactHistory(chat, allMsgs, config)
        }

        send('llm:done')
      } catch (error) {
        send('llm:error', errorToMessage(error))
      }
    })()
  })

  ipcMain.on('llm:stream-goal', (event, chatId: string, userMessage: string, model: string, maxIterations: number = 10) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const send = (channel: string, ...args: unknown[]): void => {
      if (!window?.isDestroyed()) event.sender.send(channel, ...args)
    }

    void (async () => {
      try {
        const chat = getChat(chatId)
        if (!chat) throw new Error('Chat not found')

        const existingMessages = getMessages(chatId)
        const config = loadAppConfig()
        
        resetCancelled()
        
        // Save initial goal as user message
        const user = createMessage({ chatId, role: 'user', content: `/goal ${userMessage}` })
        send('messages:created', user)

        // Set up the persistent history for the loop
        const history = buildOptimizedHistory(chatId, chat)

        let iterations = 0
        const MAX_ITERATIONS = maxIterations
        let success = false
        let isFirstIteration = true

        while (iterations < MAX_ITERATIONS && !success && !isCancelled) {
          send('llm:goal-iteration', { current: iterations + 1, max: MAX_ITERATIONS })
          
          let assistantContent = ''
          let failed = false
          
          if (!isFirstIteration) {
            // Give the frontend a tiny visual gap before the next stream starts
            await new Promise(r => setTimeout(r, 500))
          }

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

          if (failed || isCancelled) break

          // Save the AI's output to DB and history
          const assistant = createMessage({ chatId, role: 'assistant', content: assistantContent })
          send('messages:created', assistant)
          history.push({ role: 'assistant', content: assistantContent })

          // Check if the AI output exactly [YES]
          if (assistantContent.includes('[YES]')) {
            success = true
            break
          }
          
          if (isFirstIteration && existingMessages.length === 0) {
            void generateAndPersistTitle(chatId, config, model, `/goal ${userMessage}`, send)
          }

          // If not successful, prompt it to reflect!
          let reflectionPrompt = `Review your previous output against the original goal: "${userMessage}". Have you perfectly achieved it? If yes, respond with '[YES]' followed by the completely perfected final answer. If no, respond with '[NO]', explain what is missing, and then provide the improved output.`
          
          const currentAttempt = iterations + 1
          if (currentAttempt === 3) {
            reflectionPrompt += `\n\nNOTE: You have failed this evaluation multiple times. You must drastically change your strategy, think outside the box, or take a completely different approach to solve this goal. Do not repeat the same mistakes or output the same failed logic.`
          } else if (currentAttempt > 3 && (currentAttempt - 3) % 5 === 0) {
            reflectionPrompt += `\n\nCRITICAL WARNING: You are stuck in a loop and failing repeatedly. Radically alter your perspective. Re-evaluate the core assumptions of the prompt and try a completely new angle.`
          }
          
          const reflectionUserMsg = createMessage({ chatId, role: 'user', content: reflectionPrompt })
          send('messages:created', reflectionUserMsg)
          history.push({ role: 'user', content: reflectionPrompt })

          iterations++
          isFirstIteration = false
        }

        // Asynchronously compact history if it exceeds threshold
        const allMsgs = getMessages(chatId)
        let recentCount = allMsgs.length
        if (chat.summary_through_id) {
          const idx = allMsgs.findIndex(m => m.id === chat.summary_through_id)
          if (idx !== -1) recentCount = allMsgs.length - (idx + 1)
        }
        if (recentCount > 25) {
          void compactHistory(chat, allMsgs, config)
        }

        send('llm:done')
      } catch (error) {
        send('llm:error', errorToMessage(error))
      }
    })()
  })

  ipcMain.on('llm:cancel', () => {
    cancelStream()
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

  // Voice-to-text transcription via Groq API (if available) or local whisper.cpp
  ipcMain.handle('voice:transcribe', async (_, audioBytes: number[]) => {
    const tmpDir = os.tmpdir()
    const id = Date.now()
    const webmPath = path.join(tmpDir, `prism-audio-${id}.webm`)
    const wavPath = path.join(tmpDir, `prism-audio-${id}.wav`)

    // Ensure Homebrew and system paths are available for shelljs inside nodejs-whisper
    process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ''}`

    try {
      // 1. Write incoming audio bytes to a temp webm file
      const buf = Buffer.from(audioBytes)
      fs.writeFileSync(webmPath, buf)

      // Guard against corrupt/empty blobs that ffmpeg cannot parse
      if (buf.length < 1024) {
        return { success: true, text: '', error: null }
      }

      const config = loadAppConfig()
      // Use the config key if set
      const groqKey = config.direct.groqKey

      if (groqKey) {
        try {
          const blob = new Blob([buf], { type: 'audio/webm' })
          const formData = new FormData()
          formData.append('file', blob, 'audio.webm')
          formData.append('model', 'whisper-large-v3')
          formData.append('language', 'en')
          // Optional: Add a prompt to heavily bias the model towards typical app commands
          formData.append('prompt', 'Jarvis, turn on goal mode. Turn on the infinite goal mode for 5 iterations.')

          const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${groqKey}`
            },
            body: formData
          })

          if (!response.ok) {
            throw new Error(`Groq API error: ${response.status} ${response.statusText}`)
          }

          const data = await response.json()
          if (data.text) {
            // Clean up temp files
            try { fs.unlinkSync(webmPath) } catch (e) {}
            return { success: true, text: data.text.trim(), error: null }
          }
        } catch (err) {
          console.error('[STT] Groq API failed, falling back to local Whisper:', err)
        }
      }

      // 2. Convert to 16kHz mono WAV (required by whisper.cpp)
      await new Promise<void>((resolve, reject) => {
        execFile('/opt/homebrew/bin/ffmpeg', [
          '-y',
          '-i', webmPath,
          '-ar', '16000',
          '-ac', '1',
          '-f', 'wav',
          wavPath
        ], (err) => {
          if (err) reject(new Error(`ffmpeg conversion failed: ${err.message}`))
          else resolve()
        })
      })

      // 3. Run local whisper transcription
      const { nodewhisper } = await import('nodejs-whisper')
      const result = await nodewhisper(wavPath, {
        modelName: 'small.en',
        removeWavFileAfterTranscription: true,
        withCuda: false,
        logger: { debug: () => {}, error: console.error, log: () => {} } as any,
        whisperOptions: {
          outputInText: true,
          outputInVtt: false,
          outputInSrt: false,
          outputInCsv: false,
          translateToEnglish: false,
          language: 'en',
          wordTimestamps: false,
          timestamps_length: 60,
          splitOnWord: true,
        }
      })

      // result is stdout string from whisper-cli; strip timestamp artifacts
      const raw: any = result
      let text = ''
      if (typeof raw === 'string') {
        text = raw
      } else if (Array.isArray(raw)) {
        text = raw.map((s: any) => (typeof s === 'string' ? s : s.text ?? '')).join(' ')
      }

      // Strip [HH:MM:SS.mmm --> HH:MM:SS.mmm] and clean up
      text = text
        .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]/g, '')
        .replace(/\[BLANK_AUDIO\]/g, '')
        .trim()

      return { success: true, text, error: null }
    } catch (error) {
      console.error('Transcription error:', error)
      return { success: false, text: '', error: String(error) }
    } finally {
      try { if (fs.existsSync(webmPath)) fs.unlinkSync(webmPath) } catch {}
    }
  })

  ipcMain.handle('debug:saveFile', async (_, filename: string, buffer: ArrayBuffer) => {
    if (app.isPackaged) {
      return { success: false, error: 'Debug tools disabled in production' }
    }
    try {
      const fs = require('fs')
      const path = require('path')
      const dest = path.join(process.cwd(), filename)
      fs.writeFileSync(dest, Buffer.from(buffer))
      console.log(`Saved debug file to ${dest}`)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Voice Text-to-Speech is now handled entirely client-side via Kokoro TTS (WASM/ONNX)
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
    // 1. Immediately set a fallback title (first 5 words) for instant UI feedback
    const words = userMessage.trim().split(/\s+/)
    const fallbackTitle = words.slice(0, 5).join(' ') + (words.length > 5 ? '...' : '')
    
    let updated = updateChatTitle(chatId, fallbackTitle)
    if (updated) send('chats:updated', updated)

    // 2. Ask the LLM to generate a smart summary in the background
    console.log('[DEBUG] Generating title for:', userMessage)
    const llmTitle = await generateChatTitle(config, model, userMessage)
    console.log('[DEBUG] LLM generated title:', llmTitle)
    
    // 3. Update the title again if the LLM successfully generated a better one
    if (llmTitle && llmTitle !== 'New Chat' && llmTitle !== fallbackTitle) {
      console.log('[DEBUG] Updating chat title to:', llmTitle)
      updated = updateChatTitle(chatId, llmTitle)
      if (updated) send('chats:updated', updated)
    }
  } catch (err) {
    console.error('Title generation workflow failed:', err)
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
