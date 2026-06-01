import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChatWindow } from './components/ChatWindow'
import { OnboardingModal } from './components/OnboardingModal'
import { SettingsModal, type SettingsTab } from './components/SettingsModal'
import { Sidebar } from './components/Sidebar'
import { TopBar, providerForModel } from './components/TopBar'
import { useEndpointModels } from './hooks/useEndpointModels'
import { useAppStore } from './store'
import type { AppConfig, Chat, Message, Provider } from './types'

const FALLBACK_MODEL = 'gpt-4o'

export default function App() {
  const {
    chats,
    activeChat,
    messages,
    isStreaming,
    goalIteration,
    defaultModel,
    setChats,
    setActiveChat,
    upsertChat,
    removeChat,
    setMessages,
    appendToken,
    replaceStreamingMessage,
    setStreaming,
    setGoalIteration,
    setConnectionMode,
    setDirectConfig,
    setCustomEndpointConfig,
    setDefaultModel
  } = useAppStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('connection')
  const [preloadReady, setPreloadReady] = useState(() => Boolean(window.api))
  const [bootReady, setBootReady] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

  // Auto-fetch models whenever custom endpoint URL/key changes
  useEndpointModels()

  const applyConfig = useCallback(
    (config: AppConfig) => {
      setConnectionMode(config.mode)
      setDirectConfig(config.direct)
      setCustomEndpointConfig(config.customEndpoint)
      setDefaultModel(config.defaultModel)
    },
    [setConnectionMode, setCustomEndpointConfig, setDefaultModel, setDirectConfig]
  )

  const loadChat = useCallback(
    async (chat: Chat | null) => {
      if (!window.api) return
      setActiveChat(chat)
      if (!chat) {
        setMessages([])
        await window.api.settings.set('activeChatId', '')
        return
      }

      const loadedMessages = await window.api.messages.getAll(chat.id)
      setMessages(loadedMessages)
      await window.api.settings.set('activeChatId', chat.id)
    },
    [setActiveChat, setMessages]
  )

  const createNewChat = useCallback(async () => {
    if (!window.api) return
    const model = useAppStore.getState().defaultModel || defaultModel || FALLBACK_MODEL
    const provider = providerForModel(model)
    const chat = await window.api.chats.create({ provider, model })
    const latestChats = await window.api.chats.getAll()
    setChats(latestChats)
    upsertChat(chat)
    await loadChat(chat)
  }, [defaultModel, loadChat, setChats, upsertChat])

  const loadAppData = useCallback(async () => {
    if (!window.api) return
    const config = await window.api.settings.getConfig()
    applyConfig(config)

    const loadedChats = await window.api.chats.getAll()
    setChats(loadedChats)
    const activeChatId = await window.api.settings.get('activeChatId')
    const selected = loadedChats.find((chat) => chat.id === activeChatId) ?? loadedChats[0] ?? null
    if (selected) {
      setActiveChat(selected)
      const loadedMessages = await window.api.messages.getAll(selected.id)
      setMessages(loadedMessages)
      await window.api.settings.set('activeChatId', selected.id)
    } else {
      const model = config.defaultModel || FALLBACK_MODEL
      const chat = await window.api.chats.create({ provider: providerForModel(model), model })
      const latestChats = await window.api.chats.getAll()
      setChats(latestChats)
      upsertChat(chat)
      setActiveChat(chat)
      setMessages([])
      await window.api.settings.set('activeChatId', chat.id)
    }
  }, [applyConfig, setActiveChat, setChats, setMessages, upsertChat])

  useEffect(() => {
    if (!window.api) {
      setPreloadReady(false)
      return
    }

    let cancelled = false

    async function boot(): Promise<void> {
      if (!window.api) return
      try {
        const [connectionMode, onboardingComplete] = await Promise.all([
          window.api.settings.get('connection_mode'),
          window.api.settings.get('onboarding_complete')
        ])
        if (cancelled) return

        const requiresOnboarding = !connectionMode || onboardingComplete !== 'true'
        setShowOnboarding(requiresOnboarding)
        if (!requiresOnboarding) {
          await loadAppData()
        }
        if (!cancelled) {
          setPreloadReady(true)
          setBootReady(true)
        }
      } catch (error) {
        console.error(error)
        if (!cancelled) {
          setPreloadReady(true)
          setBootReady(true)
        }
      }
    }

    void boot()

    return () => {
      cancelled = true
    }
  }, [loadAppData])

  useEffect(() => {
    if (!window.api) return

    let tokenBuffer = ''
    let flushTimer: ReturnType<typeof setTimeout> | null = null

    const flushTokens = () => {
      flushTimer = null
      if (tokenBuffer) {
        const batch = tokenBuffer
        tokenBuffer = ''
        appendToken(batch)
      }
    }

    window.api.llm.removeStreamListeners()

    window.api.llm.onToken((token) => {
      tokenBuffer += token
      if (flushTimer === null) {
        flushTimer = setTimeout(flushTokens, 16)
      }
    })

    window.api.llm.onDone(() => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      flushTokens()
      setStreaming(false)
      setGoalIteration(null)
    })

    window.api.llm.onError((message) => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      flushTokens()
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        chat_id: useAppStore.getState().activeChat?.id ?? '',
        role: 'assistant',
        content: message,
        created_at: Date.now(),
        isError: true
      }
      replaceStreamingMessage(errorMessage)
      setStreaming(false)
      setGoalIteration(null)
    })

    window.api.llm.onMessageCreated((message) => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      flushTokens()
      replaceStreamingMessage(message)
    })

    window.api.llm.onGoalIteration((iteration) => setGoalIteration(iteration))

    window.api.llm.onChatUpdated((chat) => upsertChat(chat))

    return () => {
      if (flushTimer !== null) clearTimeout(flushTimer)
      window.api?.llm.removeStreamListeners()
    }
  }, [appendToken, replaceStreamingMessage, setStreaming, upsertChat])

  useEffect(() => {
    document.title = activeChat ? `${activeChat.title} — Prism` : 'Prism'
  }, [activeChat])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void createNewChat()
      }
      if (modifier && event.key === ',') {
        event.preventDefault()
        setSettingsTab('connection')
        setSettingsOpen(true)
      }
      if (event.key === 'Escape') {
        setSettingsOpen(false)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [createNewChat])

  const sendMessage = useCallback(
    async (content: string) => {
      if (!window.api || !activeChat || isStreaming || !content.trim()) return
      setStreaming(true)
      
      let text = content.trim()
      
      // Voice trigger interception
      // 1. Specific iterations: "turn on goal mode for 5 iterations"
      const iterRegex = /(?:\b(?:turn on|run|execute)(?: the)? goal mode for (\d+) iterations\b)[.,!?]*/gi
      // 2. Infinite goal mode: "turn on infinite goal mode"
      const infRegex = /(?:\b(?:turn on|run|execute)(?: the)? infinite goal mode\b)[.,!?]*/gi
      // 3. Default goal mode: "turn on goal mode"
      const defaultRegex = /(?:\b(?:turn on|run|execute)(?: the)? goal mode\b)[.,!?]*/gi

      if (iterRegex.test(text)) {
        // Reset lastIndex because test() advances it
        iterRegex.lastIndex = 0
        const match = iterRegex.exec(text)
        const iterations = match ? match[1] : ''
        const textWithoutTrigger = text.replace(iterRegex, '').trim()
        text = `/goal${iterations} ${textWithoutTrigger}`
      } else if (infRegex.test(text)) {
        const textWithoutTrigger = text.replace(infRegex, '').trim()
        text = `/goalinf ${textWithoutTrigger}`
      } else if (defaultRegex.test(text)) {
        const textWithoutTrigger = text.replace(defaultRegex, '').trim()
        text = `/goal ${textWithoutTrigger}`
      }
      
      const infMatch = text.match(/^\/goalinf\s+(.*)/is)
      const goalMatch = text.match(/^\/goal(\d*)\s+(.*)/is)
      
      if (infMatch) {
        const goalText = infMatch[1].trim()
        window.api.llm.streamGoal(activeChat.id, goalText, activeChat.model, Number.MAX_SAFE_INTEGER)
      } else if (goalMatch) {
        const iterations = goalMatch[1] ? parseInt(goalMatch[1], 10) : 10
        const goalText = goalMatch[2].trim()
        window.api.llm.streamGoal(activeChat.id, goalText, activeChat.model, iterations)
      } else {
        window.api.llm.stream(activeChat.id, text, activeChat.model)
      }
    },
    [activeChat, isStreaming, setStreaming]
  )

  const deleteChat = useCallback(
    async (chat: Chat) => {
      if (!window.api) return
      await window.api.chats.delete(chat.id)
      removeChat(chat.id)
      const latestChats = await window.api.chats.getAll()
      setChats(latestChats)
      if (activeChat?.id === chat.id) {
        await loadChat(latestChats[0] ?? null)
      }
    },
    [activeChat?.id, loadChat, removeChat, setChats]
  )

  const updateTitle = useCallback(
    async (title: string) => {
      if (!window.api || !activeChat) return
      const updated = await window.api.chats.updateTitle(activeChat.id, title)
      if (updated) upsertChat(updated)
    },
    [activeChat, upsertChat]
  )

  const updateMeta = useCallback(
    async (provider: Provider, model: string) => {
      if (!window.api || !activeChat) return
      const updated = await window.api.chats.updateMeta(activeChat.id, { provider, model })
      if (updated) upsertChat(updated)
    },
    [activeChat, upsertChat]
  )

  const normalizedActiveChat = useMemo(() => activeChat, [activeChat])

  const openSettings = useCallback((tab: SettingsTab = 'connection') => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }, [])

  const handleOnboardingComplete = useCallback(async () => {
    setShowOnboarding(false)
    await loadAppData()
  }, [loadAppData])

  if (!preloadReady && !window.api) {
    return (
      <div className="preload-error">
        <h1>Prism failed to start</h1>
        <p>The secure preload API did not load. Restart the app after checking the main process logs.</p>
      </div>
    )
  }

  if (showOnboarding) {
    return <OnboardingModal onComplete={() => void handleOnboardingComplete()} />
  }

  if (!bootReady) {
    return (
      <div className="preload-error">
        <h1>Starting Prism</h1>
        <p>Loading chats and connection settings...</p>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar
        chats={chats}
        activeChatId={activeChat?.id ?? null}
        onNewChat={createNewChat}
        onSelectChat={loadChat}
        onDeleteChat={deleteChat}
        onOpenSettings={openSettings}
      />
      <main className="chat-main">
        <TopBar chat={normalizedActiveChat} onTitleChange={updateTitle} onMetaChange={updateMeta} />
        <ChatWindow chat={normalizedActiveChat} messages={messages} isStreaming={isStreaming} goalIteration={goalIteration} onSend={sendMessage} />
      </main>
      {settingsOpen && <SettingsModal initialTab={settingsTab} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
