import { Check, KeyRound, Server } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DEFAULT_ENDPOINT_URL, EMPTY_DIRECT_CONFIG, type ConnectionMode, type DirectConfig } from '../../../shared/config'
import { ModeCards } from './ModeCards'

interface OnboardingModalProps {
  onComplete: () => void
}

type EndpointStatus = 'checking' | 'online' | 'offline'

type KeyField = {
  key: keyof DirectConfig
  setting: string
  label: string
  placeholder: string
}

// Show just the 3 major providers in onboarding; extras are in Settings
const KEY_FIELDS: KeyField[] = [
  { key: 'openaiKey',    setting: 'api_key_openai',    label: 'OpenAI API Key',    placeholder: 'sk-...'    },
  { key: 'anthropicKey', setting: 'api_key_anthropic', label: 'Anthropic API Key', placeholder: 'sk-ant-...' },
  { key: 'geminiKey',    setting: 'api_key_gemini',    label: 'Google Gemini Key', placeholder: 'AIza...'   },
  { key: 'groqKey',      setting: 'api_key_groq',      label: 'Groq API Key',      placeholder: 'gsk_...'   },
  { key: 'openrouterKey',setting: 'api_key_openrouter',label: 'OpenRouter Key',    placeholder: 'sk-or-...' }
]

export function OnboardingModal({ onComplete }: OnboardingModalProps) {
  const [step, setStep] = useState<'choose' | 'direct' | 'custom'>('choose')
  const [selectedMode, setSelectedMode] = useState<ConnectionMode | null>(null)
  const [directConfig, setDirectConfig] = useState<DirectConfig>({ ...EMPTY_DIRECT_CONFIG })
  const [endpointUrl, setEndpointUrl] = useState(DEFAULT_ENDPOINT_URL)
  const [endpointStatus, setEndpointStatus] = useState<EndpointStatus>('checking')

  useEffect(() => {
    if (step !== 'custom') return
    void checkEndpoint(setEndpointStatus, endpointUrl)
  }, [endpointUrl, step])

  const confirmMode = async (): Promise<void> => {
    if (!selectedMode || !window.api) return
    await window.api.settings.set('connection_mode', selectedMode)
    if (selectedMode === 'direct') setStep('direct')
    if (selectedMode === 'custom') {
      await window.api.settings.set('custom_endpoint_url', endpointUrl)
      setStep('custom')
    }
  }

  const finishDirect = async (): Promise<void> => {
    if (!window.api) return
    await Promise.all(KEY_FIELDS.map((field) => window.api.settings.set(field.setting, directConfig[field.key])))
    await finish()
  }

  const finishCustom = async (): Promise<void> => {
    if (!window.api) return
    await window.api.settings.set('custom_endpoint_url', endpointUrl.trim() || DEFAULT_ENDPOINT_URL)
    await finish()
  }

  const finish = async (): Promise<void> => {
    if (!window.api) return
    await window.api.settings.set('onboarding_complete', 'true')
    onComplete()
  }

  return (
    <div className="onboarding-screen">
      <div className="onboarding-card">
        <div className="onboarding-brand">
          <div className="prism-mark">◈</div>
          <div>
            <h1>Welcome to Prism</h1>
            <p>Every model. One interface.</p>
          </div>
        </div>

        {step === 'choose' && (
          <>
            <ModeCards selectedMode={selectedMode} onSelect={setSelectedMode} size="large" />
            <button className="primary-action" type="button" disabled={!selectedMode} onClick={() => void confirmMode()}>
              Get Started
            </button>
          </>
        )}

        {step === 'direct' && (
          <div className="onboarding-step">
            <div className="step-heading">
              <KeyRound size={22} />
              <div>
                <h2>Add API keys</h2>
                <p>Add at least one API key to get started, or skip and add keys later in Settings.</p>
              </div>
            </div>
            <div className="key-grid compact">
              {KEY_FIELDS.map((field) => (
                <label className="setting-field" key={field.key}>
                  <span>{field.label}</span>
                  <input
                    type="password"
                    value={directConfig[field.key]}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setDirectConfig((current: DirectConfig) => ({ ...current, [field.key]: event.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="onboarding-actions">
              <button className="secondary-action" type="button" onClick={() => void finish()}>
                Skip for now
              </button>
              <button className="primary-action" type="button" onClick={() => void finishDirect()}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'custom' && (
          <div className="onboarding-step">
            <div className="step-heading">
              <Server size={22} />
              <div>
                <h2>Custom Endpoint</h2>
                <p>Point Prism at any OpenAI-compatible server. Models are auto-detected.</p>
              </div>
            </div>
            <label className="setting-field">
              <span>Endpoint URL</span>
              <input
                value={endpointUrl}
                onChange={(event) => setEndpointUrl(event.target.value)}
                placeholder={DEFAULT_ENDPOINT_URL}
              />
            </label>
            <p className="muted" style={{ fontSize: '0.75rem', marginTop: '4px' }}>
              Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1
            </p>
            <div className={`endpoint-status-row ${endpointStatus}`}>
              {endpointStatus === 'checking' && 'Checking endpoint status...'}
              {endpointStatus === 'online' && (
                <>
                  <Check size={16} /> Endpoint Online
                </>
              )}
              {endpointStatus === 'offline' && 'Endpoint offline — start your local server'}
            </div>
            <div className="onboarding-actions">
              <button className="secondary-action" type="button" onClick={() => void checkEndpoint(setEndpointStatus, endpointUrl)}>
                Test Again
              </button>
              <button className="primary-action" type="button" onClick={() => void finishCustom()}>
                Continue
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export async function checkEndpoint(setStatus: (status: EndpointStatus) => void, url = DEFAULT_ENDPOINT_URL): Promise<void> {
  setStatus('checking')
  try {
    const response = await fetch(url, { method: 'GET' })
    setStatus(response.ok || response.status < 500 ? 'online' : 'offline')
  } catch {
    setStatus('offline')
  }
}
