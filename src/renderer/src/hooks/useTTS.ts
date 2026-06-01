import { useCallback, useEffect, useRef, useState } from 'react'
import { KokoroTTS } from 'kokoro-js'
import ttsWorkletSource from '../workers/tts-playback.worklet.js?raw'

interface AudioResult {
  audio: Float32Array
  rate: number
}

interface QueueItem {
  id: string
  text: string
  audioPromise: Promise<AudioResult>
}

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const DEFAULT_VOICE = 'af_heart'

// === Web Worker Pool (Parallel TTS Generation) ===
type WorkerStatus = 'loading' | 'ready' | 'failed'

interface TTSWorker {
  id: number
  instance: Worker
  status: WorkerStatus
  error: string | null
  activeReqId: number | null
}

const WORKER_COUNT = 2
const workers: TTSWorker[] = []
let globalWorkerStatus: WorkerStatus = 'loading'
let nextWorkerReqId = 1
const workerPending = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void; workerId: number }>()

// Queue to hold generate requests if all workers are currently busy
const pendingGenerateQueue: Array<{ text: string, voice: string, speed: number, resolve: (res: any) => void, reject: (err: any) => void }> = []

function pumpGenerateQueue() {
  if (pendingGenerateQueue.length === 0) return
  
  // Find a completely idle worker
  const idleWorker = workers.find(w => w.status === 'ready' && w.activeReqId === null)
  if (!idleWorker) return // All workers busy, we'll try again when one finishes

  const req = pendingGenerateQueue.shift()!
  
  const id = nextWorkerReqId++
  idleWorker.activeReqId = id
  workerPending.set(id, { resolve: req.resolve, reject: req.reject, workerId: idleWorker.id })
  idleWorker.instance.postMessage({ type: 'generate', id, text: req.text, voice: req.voice, speed: req.speed })
}

function ensureWorkers(): void {
  if (workers.length >= WORKER_COUNT) return

  globalWorkerStatus = 'loading'

  for (let i = workers.length; i < WORKER_COUNT; i++) {
    try {
      const w: TTSWorker = {
        id: i,
        instance: new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' }),
        status: 'loading',
        error: null,
        activeReqId: null
      }
      
      w.instance.onmessage = (e: MessageEvent) => {
        const msg = e.data
        if (msg.type === 'ready') {
          w.status = 'ready'
          if (globalWorkerStatus === 'loading') globalWorkerStatus = 'ready'
          console.log(`[TTS] Worker ${i} ready`)
          pumpGenerateQueue()
        } else if (msg.type === 'init-failed' || msg.type === 'worker-error') {
          w.status = 'failed'
          w.error = msg.error
          console.error(`[TTS] Worker ${i} failed:`, msg.error)
          if (workers.every(wk => wk.status === 'failed')) globalWorkerStatus = 'failed'
          
          for (const [reqId, p] of workerPending) {
            if (p.workerId === i) {
              p.reject(new Error(msg.error))
              workerPending.delete(reqId)
            }
          }
        } else if (msg.type === 'log') {
          console.log(`[TTS Worker ${i}]`, msg.msg)
        } else if (msg.type === 'audio' || msg.type === 'gen-error') {
          w.activeReqId = null
          const p = workerPending.get(msg.id)
          if (p) {
            workerPending.delete(msg.id)
            if (msg.type === 'audio') {
              p.resolve({ audio: new Float32Array(msg.audio), rate: msg.rate })
            } else {
              p.reject(new Error(msg.error))
            }
          }
          pumpGenerateQueue()
        }
      }
      
      w.instance.onerror = (e) => {
        console.error(`[TTS] Worker ${i} error event:`, e)
        w.status = 'failed'
        w.error = (e as ErrorEvent).message || 'Worker crashed'
        if (workers.every(wk => wk.status === 'failed')) globalWorkerStatus = 'failed'
        
        for (const [reqId, p] of workerPending) {
            if (p.workerId === i) {
              p.reject(new Error(w.error!))
              workerPending.delete(reqId)
            }
        }
      }
      
      workers.push(w)
    } catch (err) {
      console.error(`[TTS] Worker ${i} creation failed:`, err)
      globalWorkerStatus = 'failed'
    }
  }
}

ensureWorkers()

function generateViaWorker(text: string, voice: string, speed: number): Promise<AudioResult> {
  return new Promise((resolve, reject) => {
    if (globalWorkerStatus === 'failed') {
      reject(new Error(workers.find(w => w.status === 'failed')?.error || 'Workers unavailable'))
      return
    }

    pendingGenerateQueue.push({ text, voice, speed, resolve, reject })
    pumpGenerateQueue()
  })
}


async function generateSpeech(text: string, voice: string = DEFAULT_VOICE, speed: number = 1.0): Promise<AudioResult> {
  if (globalWorkerStatus === 'loading') {
    const start = Date.now()
    while (globalWorkerStatus === 'loading' && Date.now() - start < 20000) {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  if (globalWorkerStatus === 'ready') {
    try {
      return await generateViaWorker(text, voice, speed)
    } catch (err: any) {
      if (err instanceof Error && err.message === 'Stopped') {
        throw err
      }
      console.error('[TTS] Worker generate failed:', err)
      throw err // We now throw instead of falling back to the main thread
    }
  }

  throw new Error('TTS workers failed to initialize or are unavailable')
}

const cleanMarkdown = (text: string): string =>
  text
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`{3}[\s\S]*?`{3}/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/#/g, '')
    .trim()

export function useTTS() {
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  const audioContextRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const workletRegisteredRef = useRef(false)
  const sessionDoneRef = useRef(false)

  const queueRef = useRef<QueueItem[]>([])
  const processingRef = useRef(false)
  const activeSessionRef = useRef<string | null>(null)
  const sessionCounterRef = useRef(0)
  const hasGeneratedFirstRef = useRef(false)
  
  const voiceSettingsRef = useRef({ voice: DEFAULT_VOICE, speed: 1.0 })
  const settingsPromiseRef = useRef<Promise<void> | null>(null)

  const getCtx = useCallback(async () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate: 22050 })
      // @ts-ignore
      window.debugAudioCtx = audioContextRef.current
    }
    const ctx = audioContextRef.current
    if (ctx.state === 'suspended') await ctx.resume()
    return ctx
  }, [])

  const ensureWorklet = useCallback(async (ctx: AudioContext): Promise<AudioWorkletNode> => {
    if (!workletRegisteredRef.current) {
      const blob = new Blob([ttsWorkletSource], { type: 'application/javascript' })
      const url = URL.createObjectURL(blob)
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      workletRegisteredRef.current = true
    }
    if (!workletNodeRef.current) {
      const node = new AudioWorkletNode(ctx, 'tts-playback')
      node.connect(ctx.destination)
      node.port.onmessage = (e) => {
        if (e.data.type === 'playing') {
          setIsSpeaking(true)
        } else if (e.data.type === 'ended') {
          setIsSpeaking(false)
          setSpeakingId(null)
          // Do NOT disconnect or null the node here. Keep it persistent.
          if (sessionDoneRef.current && queueRef.current.length === 0 && !processingRef.current) {
            setIsBusy(false)
          }
        }
      }
      workletNodeRef.current = node
    }
    return workletNodeRef.current
  }, [])

  const initAudio = useCallback(async () => {
    try {
      let ctx = await getCtx()
      if (ctx.state !== 'running') {
        console.warn('[TTS] AudioContext still suspended after resume(), trying fallback')
        audioContextRef.current = new AudioContext({ sampleRate: 22050 })
        // @ts-ignore
        window.debugAudioCtx = audioContextRef.current
        ctx = audioContextRef.current
        await ctx.resume()
      }
      await ensureWorklet(ctx)
    } catch (err) {
      console.warn('[TTS] Failed to eager init audio context:', err)
    }
  }, [getCtx, ensureWorklet])

  const stop = useCallback(() => {
    sessionCounterRef.current++
    activeSessionRef.current = null
    queueRef.current = []
    processingRef.current = false
    sessionDoneRef.current = false
    hasGeneratedFirstRef.current = false

    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: 'clear' })
    }

    // Abort strategy: Leave workers running to finish their current inference.
    // Do NOT call w.instance.terminate() (freezes Chromium on WASM teardown).
    // Do NOT clear w.activeReqId (we need it to stay busy until it actually finishes).
    
    for (const [, p] of workerPending) p.reject(new Error('Stopped'))
    workerPending.clear()
    pendingGenerateQueue.length = 0

    setSpeakingId(null)
    setIsSpeaking(false)
    setIsBusy(false)
  }, [])

  const processQueue = useCallback(async () => {
    if (processingRef.current) return
    const mySession = sessionCounterRef.current
    processingRef.current = true

    while (queueRef.current.length > 0 && sessionCounterRef.current === mySession) {
      // Parallel Multi-Worker Generation:
      // We grab ONE item at a time. The audioPromise is already running in the background on the worker pool!
      // This while loop simply awaits the promises in the exact correct order and pushes them to the ring buffer.
      const item = queueRef.current.shift()!
      setSpeakingId(activeSessionRef.current ?? item.id)

      try {
        console.log('[TTS-PERF]', performance.now(), 'Waiting for audioPromise for id:', item.id)
        const result = await item.audioPromise
        console.log('[TTS-PERF]', performance.now(), 'audioPromise resolved for id:', item.id)
        if (sessionCounterRef.current !== mySession) break

        console.log('[TTS-PERF]', performance.now(), 'Waiting for getCtx()')
        const ctx = await getCtx()
        console.log('[TTS-PERF]', performance.now(), 'getCtx() resolved, state:', ctx.state)

        console.log('[TTS-PERF]', performance.now(), 'Waiting for ensureWorklet()')
        const worklet = await ensureWorklet(ctx)
        console.log('[TTS-PERF]', performance.now(), 'ensureWorklet() resolved')

        const pcm = result.audio
        const transfer = pcm.buffer.slice(0)
        console.log('[TTS-PERF]', performance.now(), 'Posting to worklet')
        worklet.port.postMessage({ type: 'push', samples: transfer }, [transfer])
      } catch (err) {
        console.error('[TTS] generation error:', err)
      }
    }

    if (sessionCounterRef.current === mySession) {
      processingRef.current = false
      if (sessionDoneRef.current && queueRef.current.length === 0 && workletNodeRef.current) {
        workletNodeRef.current.port.postMessage({ type: 'done' })
      }
    }
  }, [getCtx, ensureWorklet])

  const markDone = useCallback(() => {
    sessionDoneRef.current = true
    if (!processingRef.current) {
      if (queueRef.current.length === 0 && !isSpeaking) {
        setIsBusy(false)
      }
      if (queueRef.current.length > 0) {
        void processQueue()
      } else if (workletNodeRef.current) {
        workletNodeRef.current.port.postMessage({ type: 'done' })
      }
    }
  }, [processQueue, isSpeaking])

  const enqueue = useCallback(
    (id: string, text: string, opts?: { fast?: boolean; newSession?: boolean }) => {
      const cleanText = cleanMarkdown(text)
      
      // If the chunk doesn't contain at least one letter or number, 
      // do not send it to Kokoro (prevents solitary "." from generating glitchy noise)
      if (!cleanText || !/[a-zA-Z0-9]/.test(cleanText)) return

      setIsBusy(true)

      const startFresh =
        opts?.newSession === true ||
        (opts?.newSession !== false && activeSessionRef.current !== id)

      if (startFresh) {
        stop()
        activeSessionRef.current = id
        
        if (window.api) {
          settingsPromiseRef.current = (async () => {
            const savedVoice = await window.api.settings.get('tts_voice')
            if (savedVoice) {
              const validKokoro = ['af_heart', 'af_bella', 'af_nicole', 'am_michael', 'am_adam', 'bf_emma', 'bm_george']
              voiceSettingsRef.current.voice = validKokoro.includes(savedVoice) ? savedVoice : DEFAULT_VOICE
            }
            const savedSpeed = await window.api.settings.get('tts_speed')
            voiceSettingsRef.current.speed = savedSpeed ? parseFloat(savedSpeed) : 1.0
          })()
        }
      } else if (activeSessionRef.current !== id) {
        activeSessionRef.current = id
      }

      // Start generating IMMEDIATELY. The worker pool will route this to an idle worker in the background.
      const audioPromise = (async () => {
        if (settingsPromiseRef.current) {
          await settingsPromiseRef.current
        }
        return generateSpeech(cleanText, voiceSettingsRef.current.voice, voiceSettingsRef.current.speed)
      })()
      audioPromise.catch(() => { /* surfaced in processQueue */ })

      queueRef.current.push({ id, text: cleanText, audioPromise })
      void processQueue()
    },
    [stop, processQueue]
  )

  const speak = useCallback(
    (id: string, text: string, opts?: { fast?: boolean }): Promise<void> => {
      return new Promise((resolve) => {
        // Chunk the text before enqueuing so it uses the parallel workers effectively
        // and starts playing instantly instead of taking 30s to generate a massive block.
        let processedLength = 0
        let hasEnqueuedFirst = false
        
        while (processedLength < text.length) {
          const unprocessed = text.slice(processedLength)
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
            enqueue(id, chunk.trim(), { ...opts, newSession: !hasEnqueuedFirst })
            hasEnqueuedFirst = true
            processedLength += boundaryIndex
          } else {
            if (unprocessed.trim()) {
              enqueue(id, unprocessed.trim(), { ...opts, newSession: !hasEnqueuedFirst })
            }
            break
          }
        }
        
        markDone()
        const interval = setInterval(() => {
          if (!processingRef.current || activeSessionRef.current !== id) {
            clearInterval(interval)
            resolve()
          }
        }, 100)
      })
    },
    [enqueue, markDone]
  )

  useEffect(() => {
    return () => stop()
  }, [stop])

  return { enqueue, speak, stop, speakingId, isSpeaking, isBusy, markDone, initAudio }
}

// ─── DEBUG DUMP UTILITY ──────────────────────────────────────────────────
function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i))
    }
  }

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 1 channel
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeString(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

async function downloadWav(blob: Blob, filename: string) {
  try {
    const buffer = await blob.arrayBuffer()
    await window.api.debug.saveFile(filename, buffer)
  } catch (e) {
    console.error(`Failed to save ${filename}:`, e)
  }
}

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  ;(window as any).debugTTSDump = async () => {
    console.log('[DEBUG] Starting TTS dump...')
    try {
      const s1 = 'Hello, this is the first test sentence.'
      const s2 = 'Now here comes the second sentence after a pause.'
      const s3 = 'And finally the third sentence to finish the test.'

      const r1 = await generateSpeech(s1)
      console.log('[DEBUG] Clip 1 generated')
      const r2 = await generateSpeech(s2)
      console.log('[DEBUG] Clip 2 generated')
      const r3 = await generateSpeech(s3)
      console.log('[DEBUG] Clip 3 generated')

      await downloadWav(encodeWAV(r1.audio, r1.rate), 'clip1.wav')
      await downloadWav(encodeWAV(r2.audio, r2.rate), 'clip2.wav')
      await downloadWav(encodeWAV(r3.audio, r3.rate), 'clip3.wav')

      const concatLen = r1.audio.length + r2.audio.length + r3.audio.length
      const concatArr = new Float32Array(concatLen)
      concatArr.set(r1.audio, 0)
      concatArr.set(r2.audio, r1.audio.length)
      concatArr.set(r3.audio, r1.audio.length + r2.audio.length)

      await downloadWav(encodeWAV(concatArr, r1.rate), 'concat_raw.wav')
      console.log('[DEBUG] TTS dump complete. 4 files downloaded.')
    } catch (e) {
      console.error('[DEBUG] TTS dump failed:', e)
    }
  }
}
