class TTSPlaybackWorklet extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunks = []
    this.chunkOffset = 0
    this.isDone = false
    this.hasStartedPlaying = false
    this.port.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'push') {
        this.chunks.push(new Float32Array(msg.samples))
      } else if (msg.type === 'done') {
        this.isDone = true
      } else if (msg.type === 'clear') {
        this.chunks = []
        this.chunkOffset = 0
        this.isDone = false
        this.hasStartedPlaying = false
      }
    }
  }

  process(_inputs, outputs, _parameters) {
    const output = outputs[0]
    const channel = output[0]
    if (!channel) return true

    let outOffset = 0

    while (outOffset < channel.length) {
      if (this.chunks.length === 0) {
        break // Starved or done
      }

      const currentChunk = this.chunks[0]
      const remainingInChunk = currentChunk.length - this.chunkOffset
      const neededForOutput = channel.length - outOffset
      const toCopy = Math.min(remainingInChunk, neededForOutput)

      channel.set(currentChunk.subarray(this.chunkOffset, this.chunkOffset + toCopy), outOffset)
      outOffset += toCopy
      this.chunkOffset += toCopy

      if (!this.hasStartedPlaying && toCopy > 0) {
        this.hasStartedPlaying = true
        this.port.postMessage({ type: 'playing' })
      }

      if (this.chunkOffset >= currentChunk.length) {
        this.chunks.shift()
        this.chunkOffset = 0
      }
    }

    // Fill remainder with silence if we ran out of data
    if (outOffset < channel.length) {
      channel.fill(0, outOffset)
    }

    if (this.chunks.length === 0 && this.isDone) {
      this.port.postMessage({ type: 'ended' })
      this.isDone = false // Reset state so it doesn't repeatedly fire ended
      this.hasStartedPlaying = false
    }

    return true // Keep alive forever
  }
}

registerProcessor('tts-playback', TTSPlaybackWorklet)
