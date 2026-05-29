import { Check, KeyRound, Server } from 'lucide-react'
import type { ConnectionMode } from '../../../shared/config'

interface ModeCardsProps {
  selectedMode: ConnectionMode | null
  onSelect: (mode: ConnectionMode) => void
  size?: 'large' | 'compact'
}

const directBullets = ['Provider-native requests', 'Your keys stay local', 'No extra server needed']
const customBullets = ['Any OpenAI-compatible URL', 'Works with Ollama, LM Studio, vLLM', 'Runs through localhost']

export function ModeCards({ selectedMode, onSelect, size = 'large' }: ModeCardsProps) {
  return (
    <div className={`mode-cards ${size}`}>
      <button className={`mode-card ${selectedMode === 'direct' ? 'selected' : ''}`} type="button" onClick={() => onSelect('direct')}>
        <span className="mode-icon">
          <KeyRound size={size === 'large' ? 32 : 22} />
        </span>
        {selectedMode === 'direct' && <Check className="mode-check" size={18} />}
        <h3>Direct API</h3>
        <p>Bring your own API keys and connect directly to any provider.</p>
        <ul>
          {directBullets.map((item) => (
            <li key={item}>
              <Check size={12} />
              {item}
            </li>
          ))}
        </ul>
      </button>

      <button className={`mode-card ${selectedMode === 'custom' ? 'selected' : ''}`} type="button" onClick={() => onSelect('custom')}>
        <span className="mode-icon">
          <Server size={size === 'large' ? 32 : 22} />
        </span>
        {selectedMode === 'custom' && <Check className="mode-check" size={18} />}
        <h3>Custom Endpoint</h3>
        <p>Point Prism at any OpenAI-compatible local or remote server.</p>
        <ul>
          {customBullets.map((item) => (
            <li key={item}>
              <Check size={12} />
              {item}
            </li>
          ))}
        </ul>
      </button>
    </div>
  )
}
