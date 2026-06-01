import { ArrowUp, Loader, Mic, MicOff, Radio, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageBubble } from './MessageBubble'
import { useVoiceInput } from '../hooks/useVoiceInput'
import { useTTS } from '../hooks/useTTS'
import type { Chat, Message } from '../types'

interface ChatWindowProps {
  chat: Chat | null
  messages: Message[]
  isStreaming: boolean
  goalIteration: { current: number; max: number } | null
  onSend: (content: string) => void
}

const SUGGESTIONS = ['Explain something complex', 'Help me write or edit', 'Think through a problem', 'Write some code']

export function ChatWindow({ chat, messages, isStreaming, goalIteration, onSend }: ChatWindowProps) {
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const [autoRead, setAutoRead] = useState(false)
  const [isConversationalMode, setIsConversationalMode] = useState(false)
  const tts = useTTS()

  const conversationalRef = useRef(isConversationalMode)
  useEffect(() => { conversationalRef.current = isConversationalMode }, [isConversationalMode])

  const onSendRef = useRef(onSend)
  useEffect(() => { onSendRef.current = onSend }, [onSend])

  const ttsRef = useRef(tts)
  useEffect(() => { ttsRef.current = tts }, [tts])

  // Load auto-read setting
  useEffect(() => {
    if (window.api) {
      window.api.settings.get('auto_read_responses').then(val => setAutoRead(val === 'true'))
    }
  }, [])

  // ── Voice input (manual mode — appends to draft) ──────────────────────────
  const handleVoiceTranscript = useCallback((text: string) => {
    setDraft((prev) => {
      const separator = prev && !prev.endsWith(' ') ? ' ' : ''
      return prev + separator + text
    })
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
    })
  }, [])

  // ── Voice hook (shared for both manual and conversational) ────────────────
  const voice = useVoiceInput(handleVoiceTranscript, {
    mode: isConversationalMode ? 'conversational' : 'manual',
    isSpeakingTTS: tts.isSpeaking,
    onTurnEnd: (text: string) => {
      // This fires ONLY in conversational mode, with the accumulated transcript.
      // Bypass draft state entirely — send directly.
      if (conversationalRef.current && text.trim()) {
        setDraft('')  // clear any leftover draft display
        onSendRef.current(text.trim())
      }
    }
  })

  // ── Submit (manual mode only) ─────────────────────────────────────────────
  const submit = (): void => {
    const content = draft.trim()
    if (!content || isStreaming || !chat) return
    if (voice.isListening) voice.stopListening()
    setDraft('')
    resetTextarea()
    ttsRef.current.initAudio() // Eagerly initialize AudioContext during user gesture
    onSend(content)
  }

  // ── Concurrent TTS Streaming ──────────────────────────────────────────────
  // Track by index, not id. The store swaps the streaming message (id like
  // "streaming-1234") for the persisted one (db id) once the response is
  // committed; that swap must NOT be treated as a new message.
  const currentMsgSlotRef = useRef<number>(-1)
  const processedLengthRef = useRef<number>(0)
  const hasEnqueuedForSlotRef = useRef<boolean>(false)
  const markedDoneForSlotRef = useRef<boolean>(false)
  
  // Track goalIteration transitions to unlock TTS
  const prevGoalIterationRef = useRef<{ current: number; max: number } | null>(null)
  
  useEffect(() => {
    if (prevGoalIterationRef.current !== null && goalIteration === null) {
      // Goal loop just finished! Reset TTS refs so the final successful output gets read entirely
      processedLengthRef.current = 0
      hasEnqueuedForSlotRef.current = false
      markedDoneForSlotRef.current = false
    }
    prevGoalIterationRef.current = goalIteration
  }, [goalIteration])

  // ── Scroll & Draft Management ────────────────────────────────────────────────
  useEffect(() => {
    if (!messages.length) return
    const lastMsg = messages[messages.length - 1]
    if (!lastMsg || lastMsg.role !== 'assistant') return

    console.log('[EFFECT] streaming effect firing, content length:', lastMsg.content.length)

    // Reset tracking if this is a genuinely new message.
    // We check against the index slot, not ID, because ID changes mid-stream
    // from 'streaming-X' to the SQLite persisted ID.
    const idx = messages.length - 1
    if (idx !== currentMsgSlotRef.current) {
      currentMsgSlotRef.current = idx
      processedLengthRef.current = 0
      hasEnqueuedForSlotRef.current = false
      markedDoneForSlotRef.current = false
    }

    if (lastMsg.role === 'assistant' && !lastMsg.isError && (autoRead || conversationalRef.current)) {
      // Silently ignore all intermediate attempts during a goal loop
      if (goalIteration) return
      
      if (isStreaming) {
        while (true) {
          const unprocessed = lastMsg.content.slice(processedLengthRef.current)
          if (!unprocessed) break
          
          // Markdown-aware streaming chunker
          let inCodeBlock = false
          let boundaryIndex = -1
          let backtickCount = 0
          
          for (let i = 0; i < unprocessed.length; i++) {
            if (unprocessed[i] === '`') {
              backtickCount++
              if (backtickCount === 3) {
                inCodeBlock = !inCodeBlock
                backtickCount = 0
              }
            } else {
              backtickCount = 0
            }

            if (!inCodeBlock) {
              const char = unprocessed[i]
              const nextChar = unprocessed[i+1]
              
              const isPunctuation = (char === '.' || char === '!' || char === '?' || char === ':')
              if (isPunctuation) {
                let foundSpace = false
                let j = 1
                while (j <= 4) { // Look ahead up to 4 characters
                  const lookahead = unprocessed[i + j]
                  if (lookahead === ' ' || lookahead === '\n' || lookahead === undefined) {
                    foundSpace = true
                    boundaryIndex = lookahead === undefined ? i + j : i + j + 1
                    break
                  }
                  // If it's a quote, bracket, or markdown char, skip over it
                  if (lookahead === '"' || lookahead === "'" || lookahead === ')' || lookahead === ']' || lookahead === '*' || lookahead === '_') {
                    j++
                  } else {
                    // Hit a regular character (e.g. 'S' in 'Mr.Smith'), so it's not a sentence boundary
                    break
                  }
                }
                
                if (foundSpace) {
                  break
                }
              }
              
              if (char === '\n') {
                boundaryIndex = i + 1
                break
              }
            }
          }

          if (boundaryIndex !== -1) {
            const chunk = unprocessed.slice(0, boundaryIndex)
            console.log('[TTS-STREAM] streaming chunk:', JSON.stringify(chunk.slice(0, 50)))
            ttsRef.current.enqueue(lastMsg.id, chunk.trim(), {
              fast: conversationalRef.current,
              newSession: !hasEnqueuedForSlotRef.current
            })
            hasEnqueuedForSlotRef.current = true
            processedLengthRef.current += boundaryIndex
          } else {
            break // No more complete chunks in this render cycle
          }
        }
      } else {
        // Stream finished. Drain any remaining text in chunks so we don't send a massive string to TTS
        while (processedLengthRef.current < lastMsg.content.length) {
          const unprocessed = lastMsg.content.slice(processedLengthRef.current)
          
          let inCodeBlock = false
          let boundaryIndex = -1
          let backtickCount = 0
          
          for (let i = 0; i < unprocessed.length; i++) {
            if (unprocessed[i] === '`') {
              backtickCount++
              if (backtickCount === 3) {
                inCodeBlock = !inCodeBlock
                backtickCount = 0
              }
            } else {
              backtickCount = 0
            }

            if (!inCodeBlock) {
              const char = unprocessed[i]
              const nextChar = unprocessed[i+1]
              
              const isPunctuation = (char === '.' || char === '!' || char === '?' || char === ':')
              if (isPunctuation) {
                let foundSpace = false
                let j = 1
                while (j <= 4) { // Look ahead up to 4 characters
                  const lookahead = unprocessed[i + j]
                  if (lookahead === ' ' || lookahead === '\n' || lookahead === undefined) {
                    foundSpace = true
                    boundaryIndex = lookahead === undefined ? i + j : i + j + 1
                    break
                  }
                  // If it's a quote, bracket, or markdown char, skip over it
                  if (lookahead === '"' || lookahead === "'" || lookahead === ')' || lookahead === ']' || lookahead === '*' || lookahead === '_') {
                    j++
                  } else {
                    // Hit a regular character (e.g. 'S' in 'Mr.Smith'), so it's not a sentence boundary
                    break
                  }
                }
                
                if (foundSpace) {
                  break
                }
              }
              
              if (char === '\n') {
                boundaryIndex = i + 1
                break
              }
            }
          }

          if (boundaryIndex !== -1) {
            const chunk = unprocessed.slice(0, boundaryIndex)
            ttsRef.current.enqueue(lastMsg.id, chunk.trim(), {
              fast: conversationalRef.current,
              newSession: !hasEnqueuedForSlotRef.current
            })
            hasEnqueuedForSlotRef.current = true
            processedLengthRef.current += boundaryIndex
          } else {
            // No more boundaries found, just flush whatever is left!
            if (unprocessed.trim()) {
              ttsRef.current.enqueue(lastMsg.id, unprocessed.trim(), {
                fast: conversationalRef.current,
                newSession: !hasEnqueuedForSlotRef.current
              })
              hasEnqueuedForSlotRef.current = true
            }
            processedLengthRef.current = lastMsg.content.length
            break
          }
        }
        
        if (!markedDoneForSlotRef.current) {
          ttsRef.current.markDone()
          markedDoneForSlotRef.current = true
        }
      }
    } else if (lastMsg?.isError && conversationalRef.current) {
      setIsConversationalMode(false)
    }
  }, [messages, isStreaming, autoRead])

  // ── Auto-restart Mic when conversation settles ───────────────────────────
  // Debounced so brief gaps between TTS sentences (where isSpeaking flickers
  // false → true) don't trigger a premature mic restart that gets locked out
  // by isSpeakingTTS suppression on the next sentence.
  const restartTimerRef = useRef<NodeJS.Timeout | null>(null)
  useEffect(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }

    if (!isConversationalMode) return
    if (isStreaming || tts.isBusy) return
    if (voice.isListening) return

    restartTimerRef.current = setTimeout(() => {
      voice.startListening()
      restartTimerRef.current = null
    }, 600)

    return () => {
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current)
        restartTimerRef.current = null
      }
    }
  }, [tts.isBusy, isStreaming, voice.isListening, isConversationalMode, voice])

  // Stop listening when streaming starts or chat is deselected
  useEffect(() => {
    if ((isStreaming || !chat) && voice.isListening) {
      voice.stopListening()
    }
  }, [isStreaming, chat, voice.isListening, voice.stopListening])

  // ── Smart Auto-scroll logic ─────────────────────────────────────────────
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false)
  const lastMessageCountRef = useRef(messages.length)

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    // If we are more than 30px from the bottom, pause auto-scroll
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    setIsAutoScrollPaused(distanceToBottom > 30)
  }

  useEffect(() => {
    // Force scroll to bottom if a brand new message is added
    if (messages.length > lastMessageCountRef.current) {
      setIsAutoScrollPaused(false)
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      })
    } else if (!isAutoScrollPaused) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    lastMessageCountRef.current = messages.length
  }, [messages, isAutoScrollPaused])

  const resetTextarea = (): void => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
  }

  // ── Conversational mode status text ───────────────────────────────────────
  const getStatusText = () => {
    if (!isConversationalMode) {
      if (voice.isListening) return (
        <span className="voice-status">
          <span className="voice-status-dot" />
          Recording — click mic to stop
        </span>
      )
      if (voice.isTranscribing) return (
        <span className="voice-status transcribing">Finishing transcription...</span>
      )
      return 'Shift+Enter for new line'
    }
    // Conversational mode states
    if (tts.speakingId) return (
      <span className="voice-status">
        <span className="voice-status-dot speaking" />
        AI speaking...
      </span>
    )
    if (isStreaming) return (
      <span className="voice-status">
        <span className="voice-status-dot thinking" />
        Thinking...
      </span>
    )
    if (voice.isTranscribing) return (
      <span className="voice-status transcribing">Processing speech...</span>
    )
    if (voice.isListening) return (
      <span className="voice-status">
        <span className="voice-status-dot" />
        Listening — speak freely...
      </span>
    )
    return (
      <span className="voice-status">
        <span className="voice-status-dot waiting" />
        Conversational mode active
      </span>
    )
  }

  const handleTogglePlay = useCallback((messageId: string, content: string) => {
    if (ttsRef.current.speakingId === messageId) ttsRef.current.stop()
    else void ttsRef.current.speak(messageId, content)
  }, [])

  return (
    <section className="chat-window">
      <div className="message-list" onScroll={handleScroll}>
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
            messages.map((message) => (
              <MessageBubble 
                key={message.id} 
                message={message} 
                modelName={chat?.model ?? 'assistant'} 
                isPlaying={tts.speakingId === message.id}
                onTogglePlay={handleTogglePlay}
              />
            ))
          )}
          {isStreaming && !messages.some((message) => message.isStreaming) && (
            <div className="flex gap-2 p-2 bg-base-800/50 rounded-lg w-fit ml-4 mt-2 items-center">
              <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse delay-75" />
              <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse delay-150" />
            </div>
          )}
          <div ref={messagesEndRef} className="h-6 shrink-0" />
        </div>
      </div>

      <div className="composer-wrap relative">
        {goalIteration && (
          <div 
            className="absolute top-0 right-4 -translate-y-[120%] bg-[#0D0C0C]/80 backdrop-blur-md border border-[#D97757]/40 text-[#F0EDE8] text-[10px] uppercase tracking-[0.2em] rounded-md px-4 py-2 flex items-center gap-3 z-10"
            style={{ boxShadow: '0 4px 20px rgba(217, 119, 87, 0.15), inset 0 0 10px rgba(217, 119, 87, 0.05)' }}
          >
            <div className="relative flex items-center justify-center w-2 h-2">
              <div className="absolute w-full h-full rounded-full bg-[#D97757] animate-ping opacity-75" />
              <div className="relative w-1.5 h-1.5 rounded-full bg-[#D97757]" style={{ boxShadow: '0 0 8px #D97757, 0 0 16px #D97757' }} />
            </div>
            <span className="font-bold opacity-90">
              Iteration <span className="text-[#D97757] ml-1">{goalIteration.current}</span> <span className="opacity-40 mx-1">/</span> {goalIteration.max > 1000000 ? '∞' : goalIteration.max}
            </span>
          </div>
        )}
        <div className={`composer${voice.isListening ? ' voice-active' : ''}${isConversationalMode ? ' conversational-active' : ''}`}>
          <textarea
            ref={textareaRef}
            value={draft}
            rows={1}
            disabled={isStreaming || !chat || isConversationalMode}
            placeholder={
              isConversationalMode
                ? 'Conversational mode active — speak freely...'
                : voice.isListening
                  ? 'Listening...'
                  : chat
                    ? 'Message Prism...'
                    : 'Create a chat to begin'
            }
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

          {/* Transcription in progress */}
          {voice.isTranscribing && !isConversationalMode && (
            <div className="voice-interim">
              <Loader size={12} className="spin" />
              Transcribing...
            </div>
          )}

          {/* Voice error inline */}
          {voice.error && (
            <div className="voice-error">{voice.error}</div>
          )}

          <div className="composer-footer">
            <span>{getStatusText()}</span>
            <div className="composer-actions">
              {voice.isSupported && (
                <>
                  <button
                    type="button"
                    className={`voice-btn mode-btn ${isConversationalMode ? 'recording' : ''}`}
                    disabled={(!isConversationalMode && isStreaming) || !chat}
                    onClick={() => {
                      const next = !isConversationalMode
                      setIsConversationalMode(next)
                      if (next) {
                        setDraft('')
                        // Mark current last message as already-spoken so toggling
                        // conversational mode on doesn't replay the previous reply.
                        if (messages.length > 0) {
                          currentMsgSlotRef.current = messages.length - 1
                          processedLengthRef.current = messages[messages.length - 1].content.length
                          hasEnqueuedForSlotRef.current = true
                        }
                        tts.initAudio()
                        voice.startListening()
                      } else {
                        window.api.llm.cancel()
                        voice.stopListening()
                        tts.stop()
                      }
                    }}
                    title="Conversational Mode"
                  >
                    <Radio size={16} />
                  </button>
                  {!isConversationalMode && (
                    <button
                      type="button"
                      className={`voice-btn${voice.isListening ? ' recording' : ''}${!voice.isListening && voice.isTranscribing ? ' transcribing' : ''}`}
                      disabled={isStreaming || !chat || (!voice.isListening && voice.isTranscribing)}
                      onClick={voice.toggleListening}
                      aria-label={voice.isListening ? 'Stop voice input' : 'Start voice input'}
                      title="Dictate message"
                    >
                      {voice.isListening ? <MicOff size={16} /> : voice.isTranscribing ? <Loader size={16} className="spin" /> : <Mic size={16} />}
                    </button>
                  )}
                </>
              )}
              {!isConversationalMode && (
                isStreaming ? (
                  <button type="button" onClick={() => {
                    window.api.llm.cancel()
                    tts.stop()
                  }} aria-label="Stop generating">
                    <Square size={14} fill="currentColor" />
                  </button>
                ) : (
                  <button type="button" disabled={!draft.trim() || !chat} onClick={submit} aria-label="Send message">
                    <ArrowUp size={17} />
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
