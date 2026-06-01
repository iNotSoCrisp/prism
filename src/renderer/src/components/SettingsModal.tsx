import { Check, ChevronDown, ChevronRight, ExternalLink, Eye, EyeOff, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_ENDPOINT_URL,
  DEFAULT_MODEL,
  EMPTY_DIRECT_CONFIG,
  type ConnectionMode,
  type DirectConfig
} from '../../../shared/config'
import { useAppStore } from '../store'
import { DIRECT_MODEL_GROUPS } from './TopBar'
import { ModeCards } from './ModeCards'
import { checkEndpoint } from './OnboardingModal'
import { useToast } from './Toast'

export type SettingsTab = 'connection' | 'preferences' | 'memory'

interface SettingsModalProps {
  initialTab?: SettingsTab
  onClose: () => void
}

type EndpointStatus = 'idle' | 'checking' | 'online' | 'offline'

// ─── Provider key field definitions ──────────────────────────────────────────

interface KeyField {
  key: keyof DirectConfig
  setting: string
  label: string
  placeholder: string
  docsUrl: string
}

interface ProviderGroup {
  title: string
  defaultOpen: boolean
  fields: KeyField[]
}

const PROVIDER_GROUPS: ProviderGroup[] = [
  {
    title: 'Major Providers',
    defaultOpen: true,
    fields: [
      { key: 'openaiKey',    setting: 'api_key_openai',    label: 'OpenAI',         placeholder: 'sk-...',      docsUrl: 'https://platform.openai.com/api-keys' },
      { key: 'anthropicKey', setting: 'api_key_anthropic', label: 'Anthropic',      placeholder: 'sk-ant-...',  docsUrl: 'https://console.anthropic.com/settings/keys' },
      { key: 'geminiKey',    setting: 'api_key_gemini',    label: 'Google Gemini',  placeholder: 'AIza...',     docsUrl: 'https://aistudio.google.com/apikey' }
    ]
  },
  {
    title: 'Fast Inference',
    defaultOpen: false,
    fields: [
      { key: 'groqKey',      setting: 'api_key_groq',      label: 'Groq',           placeholder: 'gsk_...',     docsUrl: 'https://console.groq.com/keys' },
      { key: 'cerebrasKey',  setting: 'api_key_cerebras',  label: 'Cerebras',       placeholder: 'csk-...',     docsUrl: 'https://cloud.cerebras.ai' },
      { key: 'fireworksKey', setting: 'api_key_fireworks', label: 'Fireworks AI',   placeholder: 'fw-...',      docsUrl: 'https://fireworks.ai/account/api-keys' }
    ]
  },
  {
    title: 'Open Source Providers',
    defaultOpen: false,
    fields: [

      { key: 'deepseekKey',  setting: 'api_key_deepseek',  label: 'DeepSeek',       placeholder: 'sk-...',      docsUrl: 'https://platform.deepseek.com/api_keys' },
      { key: 'moonshotKey',  setting: 'api_key_moonshot',  label: 'Moonshot (Kimi)',placeholder: 'sk-...',      docsUrl: 'https://platform.moonshot.cn/console/api-keys' },
      { key: 'qwenKey',      setting: 'api_key_qwen',      label: 'Qwen',           placeholder: 'sk-...',      docsUrl: 'https://bailian.console.aliyun.com/?apiKey=1' },
      { key: 'mistralKey',   setting: 'api_key_mistral',   label: 'Mistral',        placeholder: 'sk-...',      docsUrl: 'https://console.mistral.ai/api-keys' },
      { key: 'xaiKey',       setting: 'api_key_xai',       label: 'xAI (Grok)',     placeholder: 'xai-...',     docsUrl: 'https://console.x.ai' }
    ]
  },
  {
    title: 'Aggregators',
    defaultOpen: false,
    fields: [
      { key: 'openrouterKey',setting: 'api_key_openrouter',label: 'OpenRouter',     placeholder: 'sk-or-...',   docsUrl: 'https://openrouter.ai/keys' }
    ]
  }
]

const PREFERENCE_MODELS = DIRECT_MODEL_GROUPS.flatMap((g) => g.models.map((m) => m.value))

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsModal({ initialTab = 'connection', onClose }: SettingsModalProps) {
  const {
    connectionMode,
    directConfig,
    customEndpointConfig,
    defaultModel,
    availableModels,
    modelsLoading,
    modelsError,
    setConnectionMode,
    setDirectConfig,
    setCustomEndpointConfig,
    setDefaultModel,
    setAvailableModels,
    setModelsLoading,
    setModelsError
  } = useAppStore()

  const { showToast } = useToast()
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [selectedMode, setSelectedMode] = useState<ConnectionMode>(connectionMode)
  const [keys, setKeys] = useState<DirectConfig>({ ...directConfig })
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    () => Object.fromEntries(PROVIDER_GROUPS.map((g) => [g.title, g.defaultOpen]))
  )
  const [endpointUrl, setEndpointUrl] = useState(customEndpointConfig.endpointUrl || DEFAULT_ENDPOINT_URL)
  const [endpointKey, setEndpointKey] = useState(customEndpointConfig.apiKey || '')
  const [endpointStatus, setEndpointStatus] = useState<EndpointStatus>('idle')
  const [model, setModel] = useState(defaultModel || DEFAULT_MODEL)
  const [showEndpointModels, setShowEndpointModels] = useState(false)
  const [memories, setMemories] = useState<any[]>([])
  const [memoriesLoading, setMemoriesLoading] = useState(false)
  const [autoRead, setAutoRead] = useState(false)
  const [ttsVoice, setTtsVoice] = useState('af_heart')
  const [ttsSpeed, setTtsSpeed] = useState(1.0)

  useEffect(() => {
    if (!window.api) return
    async function load(): Promise<void> {
      if (!window.api) return
      const config = await window.api.settings.getConfig()
      setConnectionMode(config.mode)
      setDirectConfig(config.direct)
      setCustomEndpointConfig(config.customEndpoint)
      setDefaultModel(config.defaultModel)
      setSelectedMode(config.mode)
      setKeys(config.direct)
      setEndpointUrl(config.customEndpoint.endpointUrl || DEFAULT_ENDPOINT_URL)
      setEndpointKey(config.customEndpoint.apiKey || '')
      setModel(config.defaultModel)
      
      const ttsVoiceSaved = await window.api.settings.get('tts_voice')
      if (ttsVoiceSaved) setTtsVoice(ttsVoiceSaved)
      
      const ttsSpeedSaved = await window.api.settings.get('tts_speed')
      if (ttsSpeedSaved) setTtsSpeed(parseFloat(ttsSpeedSaved))
      
      const autoReadSaved = await window.api.settings.get('auto_read_responses')
      setAutoRead(autoReadSaved === 'true')
    }
    void load()
  }, [setConnectionMode, setCustomEndpointConfig, setDefaultModel, setDirectConfig])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const defaultModelOptions = useMemo(() => {
    return [...new Set([...PREFERENCE_MODELS, model])]
  }, [model])

  useEffect(() => {
    if (tab === 'memory') {
      void loadMemories()
    }
  }, [tab])

  const loadMemories = async () => {
    if (!window.api) return
    setMemoriesLoading(true)
    try {
      const mems = await window.api.memories.getAll()
      setMemories(mems)
    } finally {
      setMemoriesLoading(false)
    }
  }

  const deleteMemory = async (id: string) => {
    if (!window.api) return
    await window.api.memories.delete(id)
    await loadMemories()
  }

  const toggleGroup = (title: string): void => {
    setOpenGroups((prev) => ({ ...prev, [title]: !prev[title] }))
  }

  const openExternal = (url: string): void => {
    void window.api?.shell.openExternal(url)
  }

  // ── Mode ──────────────────────────────────────────────────────────────────

  const saveMode = async (nextMode: ConnectionMode): Promise<void> => {
    if (!window.api) return
    await window.api.settings.set('connection_mode', nextMode)
    setConnectionMode(nextMode)
    setSelectedMode(nextMode)
    showToast(`Switched to ${nextMode === 'custom' ? 'Custom Endpoint Mode' : 'Direct API Mode'}`)
  }

  // ── Direct API keys ───────────────────────────────────────────────────────

  const saveKey = async (field: KeyField, value: string): Promise<void> => {
    if (!window.api) return
    await window.api.settings.set(field.setting, value)
    const nextKeys = { ...keys, [field.key]: value }
    setKeys(nextKeys)
    setDirectConfig(nextKeys)
    if (value.trim()) showToast(`${field.label} key saved`)
  }

  const saveAllKeys = async (): Promise<void> => {
    if (!window.api) return
    const allFields = PROVIDER_GROUPS.flatMap((g) => g.fields)
    for (const field of allFields) {
      const value = keys[field.key] ?? ''
      await window.api.settings.set(field.setting, value)
    }
    setDirectConfig({ ...keys })
    showToast('All API keys saved')
  }

  // ── Custom endpoint ───────────────────────────────────────────────────────

  const saveEndpointUrl = async (): Promise<void> => {
    if (!window.api) return
    const nextUrl = endpointUrl.trim() || DEFAULT_ENDPOINT_URL
    await window.api.settings.set('custom_endpoint_url', nextUrl)
    setEndpointUrl(nextUrl)
    setCustomEndpointConfig({ ...customEndpointConfig, endpointUrl: nextUrl })
  }

  const saveEndpointKey = async (): Promise<void> => {
    if (!window.api) return
    await window.api.settings.set('custom_endpoint_key', endpointKey)
    setCustomEndpointConfig({ ...customEndpointConfig, apiKey: endpointKey })
  }

  const testEndpoint = async (): Promise<void> => {
    await saveEndpointUrl()
    setEndpointStatus('checking')
    try {
      const res = await checkEndpoint((s) => setEndpointStatus(s as EndpointStatus), endpointUrl.trim() || DEFAULT_ENDPOINT_URL)
      void res
    } catch {
      setEndpointStatus('offline')
    }
  }

  const fetchEndpointModels = (): void => {
    const url = endpointUrl.trim() || DEFAULT_ENDPOINT_URL
    setModelsLoading(true)
    setModelsError(null)
    window.api?.endpoint.fetchModels(url, endpointKey || '').then((res) => {
      if (res.success && res.models.length > 0) {
        setAvailableModels(res.models)
        setModelsError(null)
        setShowEndpointModels(true)
      } else {
        setAvailableModels([])
        setModelsError(res.error || 'No models found at this endpoint')
      }
      setModelsLoading(false)
    })
  }

  // ── Default model ─────────────────────────────────────────────────────────

  const saveDefaultModel = async (val: string): Promise<void> => {
    setModel(val)
    if (window.api) await window.api.settings.set('default_model', val)
    setDefaultModel(val)
    showToast('Default model saved')
  }

  const saveAutoRead = async (val: boolean): Promise<void> => {
    setAutoRead(val)
    if (window.api) await window.api.settings.set('auto_read_responses', val ? 'true' : 'false')
  }

  const saveTtsVoice = async (val: string): Promise<void> => {
    setTtsVoice(val)
    if (window.api) await window.api.settings.set('tts_voice', val)
  }

  const saveTtsSpeed = async (val: number): Promise<void> => {
    setTtsSpeed(val)
    if (window.api) await window.api.settings.set('tts_speed', val.toString())
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="settings-title">Settings</h2>
            <p className="muted">Manage connection mode, keys, and preferences.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </header>

        <div className="settings-tabs" role="tablist">
          <button className={tab === 'connection' ? 'active' : ''} type="button" onClick={() => setTab('connection')}>
            Connection
          </button>
          <button className={tab === 'preferences' ? 'active' : ''} type="button" onClick={() => setTab('preferences')}>
            Preferences
          </button>
          <button className={tab === 'memory' ? 'active' : ''} type="button" onClick={() => setTab('memory')}>
            Memory
          </button>
        </div>

        {tab === 'connection' && (
          <div className="settings-body">
            {/* ── Mode selector ─────────────────────────────────────────── */}
            <div className="settings-section">
              <div className="section-heading-row">
                <div>
                  <h3>Connection Mode</h3>
                  <p className="muted">
                    Current mode: {connectionMode === 'custom' ? 'Custom Endpoint Mode' : 'Direct API Mode'}
                  </p>
                </div>
                <span className={`mode-badge ${connectionMode}`}>
                  {connectionMode === 'custom' ? 'Custom' : 'Direct'}
                </span>
              </div>
              <ModeCards selectedMode={selectedMode} onSelect={setSelectedMode} size="compact" />
              {selectedMode !== connectionMode && (
                <button className="primary-action compact-action" type="button" onClick={() => void saveMode(selectedMode)}>
                  Switch Mode
                </button>
              )}
            </div>

            {/* ── Direct API Keys ────────────────────────────────────────── */}
            <div className="settings-section">
              <h3>Direct API Keys</h3>
              <p className="muted">Saved keys are stored locally in SQLite and never leave your machine.</p>

              <div className="provider-groups">
                {PROVIDER_GROUPS.map((group) => (
                  <div className="provider-group" key={group.title}>
                    <button
                      type="button"
                      className="provider-group-header"
                      onClick={() => toggleGroup(group.title)}
                      aria-expanded={openGroups[group.title]}
                    >
                      <span className="provider-group-title">
                        {openGroups[group.title] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {group.title}
                      </span>
                      <span className="provider-group-saved-count">
                        {group.fields.filter((f) => keys[f.key]?.trim()).length}/{group.fields.length} saved
                      </span>
                    </button>

                    {openGroups[group.title] && (
                      <div className="key-grid">
                        {group.fields.map((field) => (
                          <div className="key-field-row" key={field.key}>
                            <label className="setting-field key-field">
                              <span className="key-label">
                                {field.label}
                                {keys[field.key]?.trim() && (
                                  <span className="saved-dot" title="Key saved" />
                                )}
                              </span>
                              <span className="secret-input-wrap">
                                <input
                                  id={`key-${field.key}`}
                                  type={visibleKeys[field.key] ? 'text' : 'password'}
                                  value={keys[field.key] ?? ''}
                                  onChange={(event) =>
                                    setKeys((current: DirectConfig) => ({
                                      ...current,
                                      [field.key]: event.target.value
                                    }))
                                  }
                                  onBlur={(event) => void saveKey(field, event.target.value)}
                                  placeholder={field.placeholder}
                                  autoComplete="off"
                                />
                                <button
                                  type="button"
                                  className="toggle-secret"
                                  aria-label={visibleKeys[field.key] ? `Hide ${field.label} key` : `Show ${field.label} key`}
                                  onClick={() =>
                                    setVisibleKeys((current) => ({
                                      ...current,
                                      [field.key]: !current[field.key]
                                    }))
                                  }
                                >
                                  {visibleKeys[field.key] ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                              </span>
                            </label>
                            <button
                              type="button"
                              className="key-docs-link"
                              title={`Get ${field.label} API key`}
                              onClick={() => openExternal(field.docsUrl)}
                              aria-label={`Open ${field.label} API key page`}
                            >
                              <ExternalLink size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button className="primary-action compact-action" type="button" onClick={() => void saveAllKeys()}>
                Save All Keys
              </button>
            </div>

            {/* ── Custom Endpoint ───────────────────────────────────────── */}
            <div className="settings-section">
              <h3>Custom Endpoint</h3>
              <p className="muted">
                Point Prism at any OpenAI-compatible server. Models are auto-detected from <code>/v1/models</code>.
              </p>

              <label className="setting-field">
                <span>Endpoint URL</span>
                <input
                  id="endpoint-url"
                  value={endpointUrl}
                  onChange={(event) => setEndpointUrl(event.target.value)}
                  onBlur={() => void saveEndpointUrl()}
                  placeholder={DEFAULT_ENDPOINT_URL}
                />
              </label>

              <p className="endpoint-examples muted">
                Common endpoints: Ollama <code>http://localhost:11434/v1</code> · LM Studio <code>http://localhost:1234/v1</code> · Jan.ai <code>http://localhost:1337/v1</code> · vLLM <code>http://localhost:8000/v1</code>
              </p>

              <label className="setting-field">
                <span>API Key <span className="muted">(optional for local servers)</span></span>
                <span className="secret-input-wrap">
                  <input
                    id="endpoint-apikey"
                    type={visibleKeys['__endpoint__'] ? 'text' : 'password'}
                    value={endpointKey}
                    onChange={(event) => setEndpointKey(event.target.value)}
                    onBlur={() => void saveEndpointKey()}
                    placeholder="Leave blank for unauthenticated endpoints"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="toggle-secret"
                    aria-label={visibleKeys['__endpoint__'] ? 'Hide endpoint key' : 'Show endpoint key'}
                    onClick={() =>
                      setVisibleKeys((current) => ({
                        ...current,
                        __endpoint__: !current['__endpoint__']
                      }))
                    }
                  >
                    {visibleKeys['__endpoint__'] ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </span>
              </label>

              <div className="endpoint-row">
                <span className={`status-dot ${endpointStatus}`} />
                <span>
                  {endpointStatus === 'idle'
                    ? 'Not tested'
                    : endpointStatus === 'checking'
                      ? 'Checking...'
                      : endpointStatus === 'online'
                        ? 'Endpoint online'
                        : 'Endpoint offline'}
                </span>
                <button className="secondary-action inline-action" type="button" onClick={() => void testEndpoint()}>
                  <RefreshCw size={15} /> Test Connection
                </button>
              </div>

              {/* Available models panel */}
              <div className="endpoint-models-section">
                <div className="endpoint-models-header">
                  <span className="endpoint-models-label">Available Models</span>
                  <button
                    type="button"
                    className="secondary-action inline-action"
                    onClick={fetchEndpointModels}
                    disabled={modelsLoading}
                  >
                    <RefreshCw size={13} className={modelsLoading ? 'spin' : ''} />
                    {modelsLoading ? 'Fetching…' : 'Refresh'}
                  </button>
                </div>

                {modelsLoading && (
                  <p className="muted endpoint-models-status">
                    <RefreshCw size={13} className="spin" /> Fetching models from endpoint…
                  </p>
                )}

                {!modelsLoading && modelsError && (
                  <p className="muted endpoint-models-status warning-text">
                    ⚠ {modelsError}
                  </p>
                )}

                {!modelsLoading && !modelsError && availableModels.length > 0 && (
                  <>
                    <p className="muted endpoint-models-status">
                      {availableModels.length} model{availableModels.length !== 1 ? 's' : ''} detected
                      {' '}
                      <button
                        type="button"
                        className="inline-text-btn"
                        onClick={() => setShowEndpointModels((v) => !v)}
                      >
                        {showEndpointModels ? 'hide' : 'show'}
                      </button>
                    </p>
                    {showEndpointModels && (
                      <div className="endpoint-model-chips">
                        {availableModels.map((m) => (
                          <span className="model-chip" key={m}>{m}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {!modelsLoading && !modelsError && availableModels.length === 0 && (
                  <p className="muted endpoint-models-status">
                    Click Refresh to detect available models.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'preferences' && (
          <div className="settings-body">
            <div className="settings-section">
              <h3>Default Model</h3>
              <p className="muted">New chats start with this model unless changed in the top bar.</p>
              <select value={defaultModelOptions.includes(model) ? model : model} onChange={(event) => void saveDefaultModel(event.target.value)}>
                {defaultModelOptions.map((item) => (
                  <option value={item} key={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-section">
              <h3>Voice</h3>
              <div className="setting-field">
                <label htmlFor="tts-voice">Voice Preference</label>
                <select 
                  id="tts-voice"
                  value={ttsVoice} 
                  onChange={(e) => void saveTtsVoice(e.target.value)}
                >
                  <option value="af_heart">American Female (Heart)</option>
                  <option value="af_bella">American Female (Bella)</option>
                  <option value="af_nicole">American Female (Nicole)</option>
                  <option value="am_michael">American Male (Michael)</option>
                  <option value="am_adam">American Male (Adam)</option>
                  <option value="bf_emma">British Female (Emma)</option>
                  <option value="bm_george">British Male (George)</option>
                </select>
              </div>

              <div className="setting-field" style={{ marginTop: '16px' }}>
                <label htmlFor="tts-speed" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Speech Speed</span>
                  <span className="muted">{ttsSpeed.toFixed(1)}x</span>
                </label>
                <input
                  id="tts-speed"
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={ttsSpeed}
                  onChange={(e) => void saveTtsSpeed(parseFloat(e.target.value))}
                />
              </div>

              <div className="setting-field checkbox-field" style={{ marginTop: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.8125rem' }}>
                  <input type="checkbox" checked={autoRead} onChange={(e) => void saveAutoRead(e.target.checked)} />
                  Read responses aloud automatically
                </label>
              </div>
              <p className="muted" style={{ marginTop: '6px' }}>When enabled, Prism will use OpenAI Text-to-Speech to read messages hands-free.</p>
            </div>

            <div className="settings-section about-section">
              <h3>About</h3>
              <p className="about-name">Prism</p>
              <p className="muted">Version 2.0.9</p>
              <p className="about-copy">
                Every model. One interface.
              </p>
            </div>
          </div>
        )}

        {tab === 'memory' && (
          <div className="settings-body">
            <div className="settings-section">
              <h3>Memory</h3>
              <p className="muted">Prism learns about you to give better answers over time. You can manage what it remembers here.</p>
              
              {memoriesLoading ? (
                <p className="muted"><RefreshCw size={13} className="spin inline-icon" /> Loading memories...</p>
              ) : memories.length === 0 ? (
                <div className="empty-memories">
                  <p className="muted">No memories yet. Prism will automatically extract facts from your conversations.</p>
                </div>
              ) : (
                <div className="memory-list">
                  {memories.map(mem => (
                    <div className="memory-item" key={mem.id}>
                      <p>{mem.content}</p>
                      <button type="button" onClick={() => void deleteMemory(mem.id)} aria-label="Forget memory" title="Forget">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
