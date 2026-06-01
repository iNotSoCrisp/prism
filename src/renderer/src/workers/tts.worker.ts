/// <reference lib="webworker" />
import { KokoroTTS } from 'kokoro-js'
import { env } from '@huggingface/transformers'

env.backends.onnx.wasm.numThreads = 2
env.backends.onnx.wasm.wasmPaths = '/wasm/'
env.useFS = false
env.allowRemoteModels = false
env.allowLocalModels = true
env.useBrowserCache = false
const MODEL_ID = '/models/kokoro'
const DEFAULT_VOICE = 'af_heart'

let ttsInstance: KokoroTTS | null = null
let initError: string | null = null
const pendingRequests: Array<{ type: 'generate'; id: number; text: string; voice?: string; speed?: number }> = []

self.addEventListener('error', (e) => {
  try {
    self.postMessage({ type: 'worker-error', error: `${e.message} (${e.filename}:${e.lineno})` })
  } catch { /* ignore */ }
})

self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
  try {
    self.postMessage({ type: 'worker-error', error: `Unhandled: ${e.reason?.message || e.reason}` })
  } catch { /* ignore */ }
})

async function handleGenerate(msg: { id: number; text: string; voice?: string; speed?: number }): Promise<void> {
  if (initError) {
    self.postMessage({ type: 'gen-error', id: msg.id, error: initError })
    return
  }
  if (!ttsInstance) {
    self.postMessage({ type: 'gen-error', id: msg.id, error: 'TTS not initialized' })
    return
  }
  try {
    const result = await ttsInstance.generate(msg.text, { 
      voice: (msg.voice || DEFAULT_VOICE) as any,
      speed: msg.speed ?? 1.0
    })
    const pcm = result.audio as Float32Array
    // Copy into a fresh buffer for zero-copy transfer back to main thread
    const transferBuf = new ArrayBuffer(pcm.byteLength)
    new Float32Array(transferBuf).set(pcm)
    self.postMessage({ type: 'log', msg: 'Worker finished generating audio! Sending back to main thread...' })
    self.postMessage(
      { type: 'audio', id: msg.id, audio: transferBuf, rate: result.sampling_rate },
      [transferBuf]
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    self.postMessage({ type: 'gen-error', id: msg.id, error: message })
  }
}

async function init(): Promise<void> {
  try {
    self.postMessage({ type: 'log', msg: 'Loading TTS model in worker...' })
    ttsInstance = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: 'q8',
      device: 'wasm'
    })
    
    self.postMessage({ type: 'log', msg: 'Warming up WASM JIT compiler...' })
    try {
      await ttsInstance.generate('hello', { voice: DEFAULT_VOICE as any })
    } catch (e) {
      console.warn('Warmup failed, ignoring:', e)
    }
    
    self.postMessage({ type: 'ready' })
    // Drain anything that came in while we were loading
    while (pendingRequests.length > 0) {
      const req = pendingRequests.shift()!
      void handleGenerate(req)
    }
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err)
    self.postMessage({ type: 'init-failed', error: initError })
    // Reject anything that was queued
    while (pendingRequests.length > 0) {
      const req = pendingRequests.shift()!
      self.postMessage({ type: 'gen-error', id: req.id, error: initError })
    }
  }
}

void init()

self.onmessage = (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'generate') {
    if (ttsInstance || initError) {
      void handleGenerate(msg)
    } else {
      pendingRequests.push(msg)
    }
  } else if (msg.type === 'clear') {
    pendingRequests.length = 0
  }
}
