import { ChevronDown, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store'
import type { Chat, DirectConfig, Provider } from '../types'

// ─── Direct API grouped model list ────────────────────────────────────────────

export interface DirectModelGroup {
  provider: string
  label: string
  keyName: keyof DirectConfig
  models: { label: string; value: string }[]
}

export const DIRECT_MODEL_GROUPS: DirectModelGroup[] = [
  {
    provider: 'openai',
    label: 'OpenAI',
    keyName: 'openaiKey',
    models: [
      { label: 'GPT-4.1', value: 'gpt-4.1' },
      { label: 'GPT-4.1 Mini', value: 'gpt-4.1-mini' },
      { label: 'GPT-4.1 Nano', value: 'gpt-4.1-nano' },
      { label: 'GPT-4o', value: 'gpt-4o' },
      { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
      { label: 'GPT-4o (Nov 2024)', value: 'gpt-4o-2024-11-20' },
      { label: 'GPT-4o (Aug 2024)', value: 'gpt-4o-2024-08-06' },
      { label: 'o4-mini', value: 'o4-mini' },
      { label: 'o3', value: 'o3' },
      { label: 'o3-mini', value: 'o3-mini' },
      { label: 'o1', value: 'o1' },
      { label: 'o1-mini', value: 'o1-mini' },
      { label: 'o1-pro', value: 'o1-pro' },
      { label: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
      { label: 'GPT-4', value: 'gpt-4' },
      { label: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
    ]
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    keyName: 'anthropicKey',
    models: [
      { label: 'Claude Opus 4.5', value: 'claude-opus-4-5' },
      { label: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5' },
      { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' },
      { label: 'Claude Opus 4', value: 'claude-opus-4-0' },
      { label: 'Claude Sonnet 4', value: 'claude-sonnet-4-0' },
      { label: 'Claude 3.7 Sonnet', value: 'claude-3-7-sonnet-20250219' },
      { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
      { label: 'Claude 3.5 Haiku', value: 'claude-3-5-haiku-20241022' },
      { label: 'Claude 3 Opus', value: 'claude-3-opus-20240229' },
    ]
  },
  {
    provider: 'gemini',
    label: 'Google Gemini',
    keyName: 'geminiKey',
    models: [
      { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro-preview-05-06' },
      { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash-preview-05-20' },
      { label: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash' },
      { label: 'Gemini 2.0 Flash Lite', value: 'gemini-2.0-flash-lite' },
      { label: 'Gemini 2.0 Flash Thinking', value: 'gemini-2.0-flash-thinking-exp' },
      { label: 'Gemini 1.5 Pro', value: 'gemini-1.5-pro' },
      { label: 'Gemini 1.5 Flash', value: 'gemini-1.5-flash' },
      { label: 'Gemini 1.5 Flash-8B', value: 'gemini-1.5-flash-8b' },
    ]
  },
  {
    provider: 'groq',
    label: 'Groq',
    keyName: 'groqKey',
    models: [
      { label: 'Llama 3.3 70B', value: 'llama-3.3-70b-versatile' },
      { label: 'Llama 3.1 70B', value: 'llama-3.1-70b-versatile' },
      { label: 'Llama 3.1 8B (Instant)', value: 'llama-3.1-8b-instant' },
      { label: 'Llama 3 70B', value: 'llama3-70b-8192' },
      { label: 'Llama 3 8B', value: 'llama3-8b-8192' },
      { label: 'Mixtral 8x7B', value: 'mixtral-8x7b-32768' },
      { label: 'Gemma 2 9B', value: 'gemma2-9b-it' },
      { label: 'DeepSeek R1 Distill Llama 70B', value: 'deepseek-r1-distill-llama-70b' },
    ]
  },
  {
    provider: 'cerebras',
    label: 'Cerebras',
    keyName: 'cerebrasKey',
    models: [
      { label: 'Llama 3.3 70B (Cerebras)', value: 'llama-3.3-70b' },
      { label: 'Llama 3.1 70B (Cerebras)', value: 'llama-3.1-70b' },
      { label: 'Llama 3.1 8B (Cerebras)', value: 'llama3.1-8b' },
    ]
  },
  {
    provider: 'fireworks',
    label: 'Fireworks AI',
    keyName: 'fireworksKey',
    models: [
      { label: 'Llama 3.1 405B', value: 'accounts/fireworks/models/llama-v3p1-405b-instruct' },
      { label: 'Llama 3.1 70B', value: 'accounts/fireworks/models/llama-v3p1-70b-instruct' },
      { label: 'Llama 3.1 8B', value: 'accounts/fireworks/models/llama-v3p1-8b-instruct' },
      { label: 'DeepSeek V3 (Fireworks)', value: 'accounts/fireworks/models/deepseek-v3' },
      { label: 'DeepSeek R1 (Fireworks)', value: 'accounts/fireworks/models/deepseek-r1' },
      { label: 'Qwen 2.5 72B (Fireworks)', value: 'accounts/fireworks/models/qwen2p5-72b-instruct' },
      { label: 'Qwen 2.5 Coder 32B (Fireworks)', value: 'accounts/fireworks/models/qwen2p5-coder-32b-instruct' },
      { label: 'Mixtral 8x22B (Fireworks)', value: 'accounts/fireworks/models/mixtral-8x22b-instruct' },
    ]
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    keyName: 'deepseekKey',
    models: [
      { label: 'DeepSeek V3', value: 'deepseek-chat' },
      { label: 'DeepSeek R1', value: 'deepseek-reasoner' },
    ]
  },
  {
    provider: 'moonshot',
    label: 'Moonshot (Kimi)',
    keyName: 'moonshotKey',
    models: [
      { label: 'Kimi K2', value: 'moonshot-v1-128k' },
      { label: 'Moonshot 32K', value: 'moonshot-v1-32k' },
      { label: 'Moonshot 8K', value: 'moonshot-v1-8k' },
    ]
  },
  {
    provider: 'qwen',
    label: 'Qwen',
    keyName: 'qwenKey',
    models: [
      { label: 'Qwen Max', value: 'qwen-max' },
      { label: 'Qwen Max Latest', value: 'qwen-max-latest' },
      { label: 'Qwen Plus', value: 'qwen-plus' },
      { label: 'Qwen Turbo', value: 'qwen-turbo' },
      { label: 'Qwen 2.5 72B', value: 'qwen2.5-72b-instruct' },
      { label: 'Qwen 2.5 32B', value: 'qwen2.5-32b-instruct' },
      { label: 'Qwen Coder Plus', value: 'qwen-coder-plus' },
      { label: 'Qwen Coder Turbo', value: 'qwen-coder-turbo' },
    ]
  },
  {
    provider: 'mistral',
    label: 'Mistral',
    keyName: 'mistralKey',
    models: [
      { label: 'Mistral Large', value: 'mistral-large-latest' },
      { label: 'Mistral Medium', value: 'mistral-medium-latest' },
      { label: 'Mistral Small', value: 'mistral-small-latest' },
      { label: 'Codestral', value: 'codestral-latest' },
      { label: 'Pixtral Large', value: 'pixtral-large-latest' },
      { label: 'Mistral Nemo', value: 'open-mistral-nemo' },
    ]
  },
  {
    provider: 'xai',
    label: 'xAI (Grok)',
    keyName: 'xaiKey',
    models: [
      { label: 'Grok 3', value: 'grok-3-latest' },
      { label: 'Grok 3 Mini', value: 'grok-3-mini-latest' },
      { label: 'Grok 2', value: 'grok-2-latest' },
      { label: 'Grok 2 Vision', value: 'grok-2-vision-latest' },
      { label: 'Grok Beta', value: 'grok-beta' },
    ]
  },
  {
    provider: 'openrouter',
    label: 'OpenRouter',
    keyName: 'openrouterKey',
    models: [
      { label: 'Auto (best for prompt)', value: 'openrouter/auto' },
      { label: 'Claude Sonnet 4.5', value: 'anthropic/claude-sonnet-4-5' },
      { label: 'Claude 3.5 Sonnet', value: 'anthropic/claude-3.5-sonnet' },
      { label: 'GPT-4o (via OpenRouter)', value: 'openai/gpt-4o' },
      { label: 'GPT-4.1 (via OpenRouter)', value: 'openai/gpt-4.1' },
      { label: 'Gemini 2.0 Flash (via OpenRouter)', value: 'google/gemini-2.0-flash-001' },
      { label: 'DeepSeek V3 (via OpenRouter)', value: 'deepseek/deepseek-chat-v3-0324' },
      { label: 'Llama 3.3 70B (via OpenRouter)', value: 'meta-llama/llama-3.3-70b-instruct' },
    ]
  }
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Find which provider group a model belongs to */
function findProviderForModel(model: string, groups: DirectModelGroup[]): string | null {
  for (const g of groups) {
    if (g.models.some((m) => m.value === model)) return g.provider
  }
  return null
}

export function providerForModel(model: string): Provider {
  if (model.startsWith('claude') || model.includes('anthropic/')) return 'anthropic'
  if (model.startsWith('gemini') || model.includes('google/')) return 'gemini'
  return 'openai'
}

// ─── Component ────────────────────────────────────────────────────────────────

interface TopBarProps {
  chat: Chat | null
  onTitleChange: (title: string) => void
  onMetaChange: (provider: Provider, model: string) => void
}

export function TopBar({ chat, onTitleChange, onMetaChange }: TopBarProps) {
  const {
    connectionMode,
    directConfig,
    defaultModel,
    setDefaultModel,
    availableModels,
    modelsLoading,
    modelsError,
    setAvailableModels,
    setModelsLoading,
    setModelsError,
    directModels,
    directModelsLoading,
    setDirectModels,
    setDirectModelsLoading,
  } = useAppStore()

  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(chat?.title ?? 'New Chat')
  const [model, setModel] = useState(chat?.model ?? defaultModel)
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customModelInput, setCustomModelInput] = useState('')

  // ── Direct mode: active provider groups (only those with saved keys) ─────
  const activeGroups = useMemo(() => {
    if (connectionMode !== 'direct') return []
    return DIRECT_MODEL_GROUPS.filter((g) => Boolean(directConfig[g.keyName]?.trim()))
  }, [connectionMode, directConfig])

  // Which provider is currently selected?
  const [selectedProvider, setSelectedProvider] = useState<string>(() => {
    if (activeGroups.length === 0) return ''
    const found = findProviderForModel(model, activeGroups)
    return found ?? activeGroups[0]?.provider ?? ''
  })

  // Per-group: use live-fetched models if available, else static list
  const resolvedGroups = useMemo(
    () =>
      activeGroups.map((g) => {
        const live = directModels[g.provider]
        if (live && live.length > 0) {
          return { ...g, models: live.map((id) => ({ label: id, value: id })) }
        }
        return g
      }),
    [activeGroups, directModels]
  )

  // The provider group currently selected
  const currentGroup = useMemo(
    () => resolvedGroups.find((g) => g.provider === selectedProvider) ?? null,
    [resolvedGroups, selectedProvider]
  )

  // All available model IDs across all active providers (for fallback)
  const allDirectModels = useMemo(
    () => resolvedGroups.flatMap((g) => g.models.map((m) => m.value)),
    [resolvedGroups]
  )

  const anyDirectLoading = useMemo(
    () => activeGroups.some((g) => directModelsLoading[g.provider]),
    [activeGroups, directModelsLoading]
  )

  // Sync title and model when chat changes
  useEffect(() => {
    setTitle(chat?.title ?? 'New Chat')
    setModel(chat?.model ?? defaultModel)
  }, [chat?.id, chat?.model, chat?.title, defaultModel])

  // Sync selected provider when model or activeGroups change
  useEffect(() => {
    if (connectionMode !== 'direct' || activeGroups.length === 0) return
    const found = findProviderForModel(model, resolvedGroups)
    if (found && found !== selectedProvider) {
      setSelectedProvider(found)
    } else if (!found && !selectedProvider && activeGroups.length > 0) {
      setSelectedProvider(activeGroups[0].provider)
    }
  }, [model, resolvedGroups, connectionMode, activeGroups, selectedProvider])

  // ── Title editing ────────────────────────────────────────────────────────
  const commitTitle = (): void => {
    setEditing(false)
    const cleanTitle = title.trim() || 'New Chat'
    setTitle(cleanTitle)
    if (chat && cleanTitle !== chat.title) onTitleChange(cleanTitle)
  }

  // ── Model selection ──────────────────────────────────────────────────────
  const applyModel = useCallback(
    (nextModel: string): void => {
      if (!chat) return
      setModel(nextModel)
      setDefaultModel(nextModel)
      void window.api?.settings.set('default_model', nextModel)
      onMetaChange(providerForModel(nextModel), nextModel)
      setShowCustomInput(false)
    },
    [chat, onMetaChange, setDefaultModel]
  )

  const selectModel = (nextModel: string): void => {
    if (nextModel === '__custom__') {
      setShowCustomInput(true)
      return
    }
    applyModel(nextModel)
  }

  const commitCustomModel = (): void => {
    const trimmed = customModelInput.trim()
    if (!trimmed || !chat) return
    applyModel(trimmed)
    setCustomModelInput('')
  }

  // ── Provider change ──────────────────────────────────────────────────────
  const changeProvider = (provider: string): void => {
    setSelectedProvider(provider)
    setShowCustomInput(false)
    // Auto-select the first model of the new provider
    const group = resolvedGroups.find((g) => g.provider === provider)
    if (group && group.models.length > 0) {
      applyModel(group.models[0].value)
    }
  }

  // ── Live fetch ───────────────────────────────────────────────────────────
  const fetchDirectModels = (): void => {
    const { directConfig: cfg } = useAppStore.getState()
    activeGroups.forEach((g) => {
      const key = cfg[g.keyName]?.trim()
      if (!key) return
      setDirectModelsLoading(g.provider, true)
      window.api?.direct.fetchModels(g.provider, key).then((res) => {
        if (res.success && res.models.length > 0) {
          setDirectModels(g.provider, res.models)
        }
        setDirectModelsLoading(g.provider, false)
      })
    })
  }

  const retryFetchCustomModels = (): void => {
    const { customEndpointConfig } = useAppStore.getState()
    if (!customEndpointConfig.endpointUrl) return
    setModelsLoading(true)
    setModelsError(null)
    window.api?.endpoint.fetchModels(customEndpointConfig.endpointUrl, customEndpointConfig.apiKey || '').then((res) => {
      if (res.success && res.models.length > 0) {
        setAvailableModels(res.models)
        setModelsError(null)
      } else {
        setAvailableModels([])
        setModelsError(res.error || 'No models found')
      }
      setModelsLoading(false)
    })
  }

  // ── Derived flags ────────────────────────────────────────────────────────
  const isNoDirectKeys = connectionMode === 'direct' && activeGroups.length === 0
  const isCustomFetchFailed =
    connectionMode === 'custom' && !modelsLoading && (modelsError || availableModels.length === 0)

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <header className="top-bar drag-region">
      <div className="title-area">
        {editing ? (
          <input
            className="title-input"
            autoFocus
            value={title}
            onBlur={commitTitle}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitTitle()
              if (event.key === 'Escape') {
                setTitle(chat?.title ?? 'New Chat')
                setEditing(false)
              }
            }}
          />
        ) : (
          <button className="title-button" type="button" onClick={() => setEditing(true)} disabled={!chat}>
            {chat?.title ?? 'New Chat'}
          </button>
        )}
      </div>

      <div className="model-controls">
        <span className={`mode-badge ${connectionMode}`}>{connectionMode === 'custom' ? 'Custom' : 'Direct'}</span>

        {/* ── DIRECT API MODE: Provider → Model two-step ────────────────── */}
        {connectionMode === 'direct' && (
          <>
            {isNoDirectKeys ? (
              <span className="model-select-wrap">
                <select disabled>
                  <option>Add API keys in Settings</option>
                </select>
                <ChevronDown size={14} />
              </span>
            ) : showCustomInput ? (
              <div className="custom-model-input-wrap">
                <div className="custom-model-input-row">
                  <input
                    className="custom-model-input"
                    placeholder="Enter model name e.g. gpt-5..."
                    value={customModelInput}
                    autoFocus
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitCustomModel()
                      if (e.key === 'Escape') setShowCustomInput(false)
                    }}
                  />
                  <button type="button" className="secondary-action inline-action" onClick={commitCustomModel}>
                    Use
                  </button>
                  <button type="button" className="secondary-action inline-action" onClick={() => setShowCustomInput(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Provider selector */}
                <label className="model-select-wrap provider-select" aria-label="Provider selector">
                  <select
                    value={selectedProvider}
                    onChange={(e) => changeProvider(e.target.value)}
                    disabled={!chat}
                  >
                    {activeGroups.map((g) => (
                      <option value={g.provider} key={g.provider}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </label>

                {/* Model selector for selected provider */}
                <label className="model-select-wrap" aria-label="Model selector">
                  <select
                    value={currentGroup?.models.some((m) => m.value === model) ? model : ''}
                    onChange={(e) => selectModel(e.target.value)}
                    disabled={!chat || !currentGroup}
                  >
                    {currentGroup?.models.map((item) => (
                      <option value={item.value} key={item.value}>
                        {item.label}
                      </option>
                    ))}
                    <option value="__custom__">✏ Custom model…</option>
                  </select>
                  {!anyDirectLoading && <ChevronDown size={14} />}
                  {anyDirectLoading && <RefreshCw size={14} className="spin" />}
                </label>

                {/* Refresh button */}
                <button
                  type="button"
                  className="topbar-refresh-btn"
                  title="Fetch live model list from provider API"
                  aria-label="Refresh models"
                  onClick={fetchDirectModels}
                  disabled={anyDirectLoading}
                >
                  <RefreshCw size={13} className={anyDirectLoading ? 'spin' : ''} />
                </button>
              </>
            )}
          </>
        )}

        {/* ── CUSTOM ENDPOINT MODE ──────────────────────────────────────── */}
        {connectionMode === 'custom' && (
          <>
            {showCustomInput || isCustomFetchFailed ? (
              <div className="custom-model-input-wrap">
                {isCustomFetchFailed && !showCustomInput && (
                  <span className="model-fetch-error">
                    {modelsError ?? 'No models'} —{' '}
                    <button type="button" className="inline-text-btn" onClick={retryFetchCustomModels}>
                      Retry
                    </button>{' '}
                    or type manually:
                  </span>
                )}
                <div className="custom-model-input-row">
                  <input
                    className="custom-model-input"
                    placeholder="Enter model name e.g. llama3..."
                    value={customModelInput}
                    autoFocus
                    onChange={(e) => setCustomModelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitCustomModel()
                      if (e.key === 'Escape') setShowCustomInput(false)
                    }}
                  />
                  <button type="button" className="secondary-action inline-action" onClick={commitCustomModel}>
                    Use
                  </button>
                  {!isCustomFetchFailed && (
                    <button type="button" className="secondary-action inline-action" onClick={() => setShowCustomInput(false)}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <label className="model-select-wrap" aria-label="Model selector">
                {modelsLoading ? (
                  <select disabled>
                    <option>Loading models…</option>
                  </select>
                ) : (
                  <select
                    value={availableModels.includes(model) ? model : ''}
                    disabled={!chat}
                    onChange={(e) => selectModel(e.target.value)}
                  >
                    {availableModels.map((m) => (
                      <option value={m} key={m}>
                        {m}
                      </option>
                    ))}
                    <option value="__custom__">✏ Custom model…</option>
                  </select>
                )}
                {!modelsLoading && <ChevronDown size={14} />}
                {modelsLoading && <RefreshCw size={14} className="spin" />}
              </label>
            )}
          </>
        )}
      </div>
    </header>
  )
}
