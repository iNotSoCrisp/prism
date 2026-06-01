import { useCallback, useEffect, useRef, useState } from 'react'

export interface VoiceInputState {
  isListening: boolean
  isTranscribing: boolean
  isSupported: boolean
  error: string | null
}

export interface VoiceInputActions {
  startListening: () => void
  stopListening: () => void
  toggleListening: () => void
}

// VAD Configuration
const VAD_THRESHOLD = 15;        // Volume threshold to detect speech (0-255 scale)
const SILENCE_DEBOUNCE = 800;    // Wait 0.8s of silence before sending chunk
const CONVERSATIONAL_SILENCE = 1500; // Wait 1.5s before completely ending the turn
const INTERIM_CHUNK_MS = 4000;   // Send a chunk every 4s of continuous speech for live transcription
const DEFAULT_SILENCE_THRESHOLD = 500
const VAD_CHECK_INTERVAL = 100

// Singleton AudioContext to prevent UI freezing on .close()
let sharedAudioContext: AudioContext | null = null

export interface VoiceOptions {
  mode?: 'manual' | 'conversational'
  /** Set to true while TTS is playing to suppress VAD and prevent self-transcription */
  isSpeakingTTS?: boolean
  /** Called when the user's conversational turn ends. Receives the accumulated transcript text. */
  onTurnEnd?: (text: string) => void
}

export function useVoiceInput(
  onTranscript: (text: string) => void,
  options?: VoiceOptions
): VoiceInputState & VoiceInputActions {
  const [isListening, setIsListening] = useState(false)
  const [pendingTranscriptions, setPendingTranscriptions] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Use the shared context if available
  const audioContextRef = useRef<AudioContext | null>(sharedAudioContext)
  const streamRef = useRef<MediaStream | null>(null)
  const vadIntervalRef = useRef<NodeJS.Timeout | null>(null)
  
  // VAD state refs
  const currentRecorderRef = useRef<MediaRecorder | null>(null)
  const isSpeakingRef = useRef(false)
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const chunkStartTimeRef = useRef<number | null>(null)
  const endingTurnRef = useRef(false)

  const listenSessionRef = useRef(0)

  const pendingRef = useRef(0)

  // Accumulates all transcription text during a conversational turn
  const turnTextRef = useRef('')

  const onTranscriptRef = useRef(onTranscript)
  const optionsRef = useRef(options)

  useEffect(() => {
    onTranscriptRef.current = onTranscript
    optionsRef.current = options
  }, [onTranscript, options])

  const isSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined' &&
    typeof window !== 'undefined' &&
    !!(window.AudioContext || (window as any).webkitAudioContext)

  const releaseResources = useCallback(() => {
    if (vadIntervalRef.current) clearInterval(vadIntervalRef.current)
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    
    if (currentRecorderRef.current && currentRecorderRef.current.state !== 'inactive') {
      currentRecorderRef.current.stop()
    }
    
    // We intentionally DO NOT close the AudioContext.
    // Chromium can block the main thread for 1-2s when closing an AudioContext under load.
    // Instead, we just stop the tracks and disconnect.

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    vadIntervalRef.current = null
    silenceTimerRef.current = null
    currentRecorderRef.current = null
    isSpeakingRef.current = false
    chunkStartTimeRef.current = null
  }, [])

  const transcribeAudio = useCallback(async (blob: Blob) => {
    setPendingTranscriptions((prev) => prev + 1)
    pendingRef.current++
    setError(null)

    try {
      const arrayBuffer = await blob.arrayBuffer()
      const result = await window.api.voice.transcribe(
        Array.from(new Uint8Array(arrayBuffer))
      )

      if (result.success && result.text.trim()) {
        const text = result.text.trim()
        onTranscriptRef.current(text)

        // Accumulate text for conversational turn
        if (optionsRef.current?.mode === 'conversational') {
          turnTextRef.current += (turnTextRef.current ? ' ' : '') + text
        }
      } else if (!result.success) {
        setError(result.error ?? 'Transcription failed.')
      }
    } catch (err: any) {
      setError(err.message ?? 'Transcription failed.')
    } finally {
      setPendingTranscriptions((prev) => Math.max(0, prev - 1))
      pendingRef.current = Math.max(0, pendingRef.current - 1)
      
      if (pendingRef.current === 0 && endingTurnRef.current) {
        const accumulated = turnTextRef.current.trim()
        endingTurnRef.current = false
        turnTextRef.current = ''
        setIsListening(false)
        releaseResources()
        if (accumulated) {
          optionsRef.current?.onTurnEnd?.(accumulated)
        }
      }
    }
  }, [releaseResources])

  const startListening = useCallback(async () => {
    if (!isSupported) {
      setError('Microphone is not available in this environment.')
      return
    }

    setError(null)
    endingTurnRef.current = false
    turnTextRef.current = ''
    releaseResources()

    const mySession = ++listenSessionRef.current

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      })

      if (listenSessionRef.current !== mySession) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }

      streamRef.current = stream

      if (!sharedAudioContext) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        sharedAudioContext = new AudioContextClass()
      }
      const audioContext = sharedAudioContext
      audioContextRef.current = audioContext
      
      // If the context is suspended, resume it
      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }

      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.3
      source.connect(analyser)

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''

      const startRecordingChunk = () => {
        if (currentRecorderRef.current && currentRecorderRef.current.state === 'recording') return

        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        const chunks: Blob[] = []

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data)
        }

        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          if (blob.size > 4096) {
            void transcribeAudio(blob)
          }
        }

        currentRecorderRef.current = recorder
        recorder.start(200)
        chunkStartTimeRef.current = Date.now()
      }

      const stopRecordingAndSend = () => {
        if (currentRecorderRef.current && currentRecorderRef.current.state === 'recording') {
          currentRecorderRef.current.stop() // Triggers ondataavailable -> onstop
        }
        currentRecorderRef.current = null
        chunkStartTimeRef.current = null
      }

      const volumeBuffer = new Uint8Array(analyser.frequencyBinCount)

      vadIntervalRef.current = setInterval(() => {
        // Suppress VAD entirely while TTS is playing to prevent self-transcription
        if (optionsRef.current?.isSpeakingTTS) return

        analyser.getByteFrequencyData(volumeBuffer)
        let sum = 0
        for (let i = 0; i < volumeBuffer.length; i++) sum += volumeBuffer[i]
        const avgVolume = sum / volumeBuffer.length

        const speechDetected = avgVolume > VAD_THRESHOLD

        if (speechDetected) {
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true
            startRecordingChunk()
          }

          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = null
          }

          if (chunkStartTimeRef.current && (Date.now() - chunkStartTimeRef.current) >= INTERIM_CHUNK_MS) {
            stopRecordingAndSend()
            startRecordingChunk()
          }
        } else {
          if (isSpeakingRef.current && !silenceTimerRef.current) {
            const isConversational = optionsRef.current?.mode === 'conversational'
            const timeout = isConversational ? CONVERSATIONAL_SILENCE : SILENCE_DEBOUNCE

            silenceTimerRef.current = setTimeout(() => {
              isSpeakingRef.current = false
              stopRecordingAndSend()
              silenceTimerRef.current = null
              
              if (isConversational) {
                // In conversational mode, this silence ends the entire turn
                if (vadIntervalRef.current) clearInterval(vadIntervalRef.current)
                vadIntervalRef.current = null
                endingTurnRef.current = true
              }
            }, timeout)
          }
        }
      }, VAD_CHECK_INTERVAL)

      setIsListening(true)
    } catch (err: any) {
      releaseResources()
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Microphone access denied. Allow it in System Settings → Privacy & Security → Microphone.')
      } else if (err.name === 'NotFoundError') {
        setError('No microphone found. Check your audio input devices.')
      } else {
        setError(err.message ?? 'Could not start recording.')
      }
    }
  }, [isSupported, releaseResources, transcribeAudio])

  const stopListening = useCallback(() => {
    listenSessionRef.current++
    // If speaking and recording, finish the current chunk
    if (isSpeakingRef.current && currentRecorderRef.current && currentRecorderRef.current.state === 'recording') {
      currentRecorderRef.current.stop()
    }
    
    endingTurnRef.current = false
    turnTextRef.current = ''
    releaseResources()
    setIsListening(false)
  }, [releaseResources])

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening()
    } else {
      void startListening()
    }
  }, [isListening, startListening, stopListening])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      releaseResources()
    }
  }, [releaseResources])

  return {
    isListening,
    isTranscribing: pendingTranscriptions > 0,
    isSupported,
    error,
    startListening,
    stopListening,
    toggleListening
  }
}
