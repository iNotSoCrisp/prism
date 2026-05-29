export type ConnectionMode = 'direct' | 'custom'

export interface DirectConfig {
  openaiKey: string
  anthropicKey: string
  geminiKey: string
  groqKey: string
  openrouterKey: string
  deepseekKey: string
  moonshotKey: string
  qwenKey: string
  mistralKey: string
  xaiKey: string
  cerebrasKey: string
  fireworksKey: string
}

export interface CustomEndpointConfig {
  endpointUrl: string
  apiKey: string
}

export interface AppConfig {
  mode: ConnectionMode
  direct: DirectConfig
  customEndpoint: CustomEndpointConfig
  defaultModel: string
}

export const DEFAULT_ENDPOINT_URL = 'http://localhost:11434/v1'
export const DEFAULT_MODEL = 'gpt-4o'

export const EMPTY_DIRECT_CONFIG: DirectConfig = {
  openaiKey: '',
  anthropicKey: '',
  geminiKey: '',
  groqKey: '',
  openrouterKey: '',
  deepseekKey: '',
  moonshotKey: '',
  qwenKey: '',
  mistralKey: '',
  xaiKey: '',
  cerebrasKey: '',
  fireworksKey: ''
}

export const EMPTY_CUSTOM_ENDPOINT_CONFIG: CustomEndpointConfig = {
  endpointUrl: DEFAULT_ENDPOINT_URL,
  apiKey: ''
}
