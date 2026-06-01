import { Check, Copy, Square, Volume2 } from 'lucide-react'
import React, { Children, isValidElement, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import type { Message } from '../types'

interface MessageBubbleProps {
  message: Message
  modelName: string
  isPlaying?: boolean
  onTogglePlay?: (id: string, content: string) => void
}

export const MessageBubble = React.memo(function MessageBubble({ message, modelName, isPlaying, onTogglePlay }: MessageBubbleProps) {
  const label = message.role === 'user' ? 'You' : modelName

  return (
    <article className={`message-row ${message.role} ${message.isError ? 'error' : ''}`}>
      {message.role === 'assistant' && (
        <div className="message-meta assistant-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <span>{message.isError ? 'Error' : label}</span>
          {!message.isError && onTogglePlay && (
            <button 
              type="button" 
              onClick={() => onTogglePlay(message.id, message.content)}
              className="tts-btn"
              style={{ background: 'transparent', border: 0, color: isPlaying ? '#d97757' : '#625e5a', cursor: 'pointer', padding: 0 }}
              title={isPlaying ? 'Stop' : 'Read aloud'}
            >
              {isPlaying ? <Square size={13} /> : <Volume2 size={13} />}
            </button>
          )}
        </div>
      )}
      <div className="message-content">
        {message.role === 'user' && <div className="message-meta user-label">{label}</div>}
        <ReactMarkdown rehypePlugins={[rehypeHighlight]} components={markdownComponents}>
          {message.content || ' '}
        </ReactMarkdown>
        {message.isStreaming && <span className="stream-cursor" />}
      </div>
    </article>
  )
})

const markdownComponents: Components = {
  code(props) {
    const { children, className, ...rest } = props
    const inline = !className
    const text = extractText(children)

    if (inline) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      )
    }

    return (
      <CodeBlock code={text} className={className}>
        {children}
      </CodeBlock>
    )
  }
}

function CodeBlock({ children, code, className }: { children: React.ReactNode; code: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="code-block-wrap">
      <button className="copy-code" type="button" onClick={copy}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  )
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement<{ children?: React.ReactNode }>(node)) return extractText(node.props.children)
  return Children.toArray(node).map(extractText).join('')
}
