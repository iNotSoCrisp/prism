import { ArrowUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MessageBubble } from './MessageBubble'
import type { Chat, Message } from '../types'

interface ChatWindowProps {
  chat: Chat | null
  messages: Message[]
  isStreaming: boolean
  onSend: (content: string) => void
}

const SUGGESTIONS = ['Explain something complex', 'Help me write or edit', 'Think through a problem', 'Write some code']

export function ChatWindow({ chat, messages, isStreaming, onSend }: ChatWindowProps) {
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const resetTextarea = (): void => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
  }

  const submit = (): void => {
    const content = draft.trim()
    if (!content || isStreaming || !chat) return
    setDraft('')
    resetTextarea()
    onSend(content)
  }

  return (
    <section className="chat-window">
      <div className="message-list">
        <div className="message-list-inner">
          {messages.length === 0 ? (
            <div className="empty-state">
              <h1>Prism</h1>
              <p>What do you want to explore?</p>
              <div className="suggestion-row">
                {SUGGESTIONS.map((suggestion) => (
                  <button className="suggestion-chip" type="button" key={suggestion} onClick={() => setDraft(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => <MessageBubble key={message.id} message={message} modelName={chat?.model ?? 'assistant'} />)
          )}
          {isStreaming && !messages.some((message) => message.isStreaming) && (
            <div className="thinking">
              <span>Thinking</span>
              <span className="thinking-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="composer-wrap">
        <div className="composer">
          <textarea
            ref={textareaRef}
            value={draft}
            rows={1}
            disabled={isStreaming || !chat}
            placeholder={chat ? 'Message Prism...' : 'Create a chat to begin'}
            onInput={(event) => {
              const target = event.currentTarget
              target.style.height = 'auto'
              target.style.height = `${Math.min(target.scrollHeight, 160)}px`
            }}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (!isStreaming) submit()
              }
            }}
          />
          <div className="composer-footer">
            <span>Shift+Enter for new line</span>
            <button type="button" disabled={!draft.trim() || isStreaming || !chat} onClick={submit} aria-label="Send message">
              <ArrowUp size={17} />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
