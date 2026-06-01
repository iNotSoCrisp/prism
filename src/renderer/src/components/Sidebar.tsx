import { Plus, Settings, Trash2, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DEFAULT_ENDPOINT_URL } from '../../../shared/config'
import { useAppStore } from '../store'
import type { Chat } from '../types'
import type { SettingsTab } from './SettingsModal'

interface SidebarProps {
  chats: Chat[]
  activeChatId: string | null
  onNewChat: () => void
  onSelectChat: (chat: Chat) => void
  onDeleteChat: (chat: Chat) => void
  onOpenSettings: (tab?: SettingsTab) => void
}

export function Sidebar({ chats, activeChatId, onNewChat, onSelectChat, onDeleteChat, onOpenSettings }: SidebarProps) {
  const connectionMode = useAppStore((state) => state.connectionMode)
  const endpointUrl = useAppStore((state) => state.customEndpointConfig.endpointUrl)
  const [endpointStatus, setEndpointStatus] = useState<'checking' | 'online' | 'offline'>('checking')

  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Chat[]>([])

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(() => {
      window.api.chats.search(searchQuery.trim()).then(setSearchResults).catch(console.error)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    if (connectionMode !== 'custom') return

    const controller = new AbortController()
    setEndpointStatus('checking')

    fetch(endpointUrl || DEFAULT_ENDPOINT_URL, { method: 'GET', signal: controller.signal })
      .then((response) => setEndpointStatus(response.ok || response.status < 500 ? 'online' : 'offline'))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setEndpointStatus('offline')
      })

    return () => controller.abort()
  }, [endpointUrl, connectionMode])

  return (
    <aside className="sidebar">
      <div className="sidebar-top drag-region">
        <div className="brand-lockup" aria-label="Prism">
          <PrismLogo />
          <span className="text-sm font-semibold tracking-wide text-[#f0ede8]">Prism</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="new-chat-icon bg-transparent border-none p-1 text-[#a09690] hover:text-[#f0ede8] transition-colors cursor-pointer flex items-center justify-center"
            type="button"
            onClick={() => {
              setIsSearchOpen(!isSearchOpen)
              if (isSearchOpen) setSearchQuery('')
            }}
            aria-label="Toggle search"
          >
            <Search size={16} />
          </button>
          <button
            className="new-chat-icon bg-transparent border-none p-1 text-[#a09690] hover:text-[#f0ede8] transition-colors cursor-pointer flex items-center justify-center"
            type="button"
            onClick={onNewChat}
            aria-label="New chat"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      {isSearchOpen && (
        <div className="px-3 pb-3">
          <div className="w-full flex items-center bg-transparent border-b border-[#3f3531] px-2">
            <Search size={14} className="text-[#625e5a] shrink-0" />
            <input
              type="text"
              placeholder="Search chats..."
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent border-none outline-none py-2 pl-2 pr-2 text-[#f0ede8] placeholder:text-[#625e5a] text-sm"
              style={{ color: '#f0ede8' }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="flex items-center justify-center w-5 h-5 bg-transparent border-none p-0 outline-none text-[#a09690] hover:text-[#f0ede8] transition-colors cursor-pointer shrink-0"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="chat-list">
        {(searchQuery.trim() ? searchResults : chats).map((chat) => (
          <button
            className={`chat-list-item group ${chat.id === activeChatId ? 'active' : ''}`}
            key={chat.id}
            type="button"
            onClick={() => onSelectChat(chat)}
          >
            <span className="chat-list-copy">
              <span className="chat-list-title">{chat.title}</span>
              <span className="chat-list-time">{relativeTime(chat.updated_at)}</span>
            </span>
            <span
              className="delete-chat"
              role="button"
              tabIndex={0}
              aria-label={`Delete ${chat.title}`}
              onClick={(event) => {
                event.stopPropagation()
                onDeleteChat(chat)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  onDeleteChat(chat)
                }
              }}
            >
              <Trash2 size={14} />
            </span>
          </button>
        ))}
      </div>

      <div className="sidebar-bottom">
        <button
          className={`connection-pill ${connectionMode} ${connectionMode === 'custom' ? endpointStatus : ''}`}
          type="button"
          onClick={() => onOpenSettings('connection')}
        >
          <span className="connection-dot" />
          <span>{connectionMode === 'custom' ? 'Custom' : 'Direct API'}</span>
        </button>
        <button className="settings-icon" type="button" onClick={() => onOpenSettings('connection')} aria-label="Settings">
          <Settings size={17} />
        </button>
      </div>
    </aside>
  )
}

function PrismLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* Dark filled prism triangle */}
      <polygon points="12,1 23,22 1,22" fill="#1a1918" />
      {/* Subtle gray left edge */}
      <line x1="1" y1="22" x2="12" y2="1" stroke="#4a4543" strokeWidth="1" />
      {/* Bottom edge barely visible */}
      <line x1="1" y1="22" x2="23" y2="22" stroke="#3f3531" strokeWidth="0.5" />
      {/* Prominent orange right edge — the signature accent */}
      <line x1="12" y1="1" x2="23" y2="22" stroke="#D97757" strokeWidth="1.5" />
    </svg>
  )
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}
