// Batch speech-to-text client for the G2 microphone.
//
// The glasses mic emits PCM s16le @ 16 kHz, mono via `bridge.audioControl(true)`.
// Each `audioEvent.audioPcm` delivers ~100 ms (3,200 bytes / 1,600 samples).
// We accumulate PCM while the user talks, then send ONE batch WAV to our own
// backend (`POST /api/stt` -> Groq Whisper `whisper-large-v3-turbo`) when capture stops.
//
// Why batch, not streaming: Whisper's API is file-based; a batch keeps the
// hot path deterministic and lets the app degrade cleanly — if STT fails
// (no key, no credits, backend down) the app falls back to tap +
// typed commands and says so in one line. Voice is never load-bearing.
//
// Error codes (surfaced to the UI, never guessed over):
//   not_configured     — backend has no Groq key (503)
//   insufficient_quota — (legacy OpenAI path) key valid, account out of credits
//   rate_limited       — Groq free tier 429: try again in a moment
//   too_large          — capture exceeded the cap
//   timeout / stt_error — backend or Whisper unreachable / failed

import { transcribeAudio } from '../api'

export type SttErrorCode =
  | 'not_configured'
  | 'insufficient_quota'
  | 'rate_limited'
  | 'too_large'
  | 'timeout'
  | 'stt_error'

export class SttError extends Error {
  code: SttErrorCode
  constructor(code: SttErrorCode, message: string) {
    super(message)
    this.name = 'SttError'
    this.code = code
  }
}

export const STT_SAMPLE_RATE = 16_000
/** Max capture: 15 s of mono s16le = 480 KB, under the backend 5 MB cap. */
export const STT_MAX_SAMPLES = STT_SAMPLE_RATE * 15

export interface SttSession {
  /** Feed one PCM chunk from the bridge (Uint8Array, number[], or base64). */
  sendPcm(chunk: Uint8Array | number[] | string): void
  /** Samples captured so far. */
  readonly samples: number
  /** Encode the capture as WAV and transcribe it. Returns '' on silence. */
  finish(): Promise<string>
  /** Drop the capture without transcribing. */
  close(): void
}

function chunkToBytes(chunk: Uint8Array | number[] | string): Uint8Array {
  if (typeof chunk === 'string') {
    // The bridge may deliver PCM as a base64 string after JSON transport.
    const bin = atob(chunk)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return chunk instanceof Uint8Array ? chunk : Uint8Array.from(chunk)
}

function encodeWav(pcm: Uint8Array): Blob {
  const dataSize = pcm.length
  const buf = new ArrayBuffer(44 + dataSize)
  const v = new DataView(buf)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  v.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  v.setUint32(16, 16, true) // PCM chunk size
  v.setUint16(20, 1, true) // PCM format
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, STT_SAMPLE_RATE, true)
  v.setUint32(28, STT_SAMPLE_RATE * 2, true) // byte rate
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  writeStr(36, 'data')
  v.setUint32(40, dataSize, true)
  new Uint8Array(buf, 44).set(pcm)
  return new Blob([buf], { type: 'audio/wav' })
}

function toSttError(err: unknown): SttError {
  const code = (err as { code?: string })?.code
  const message = err instanceof Error ? err.message : String(err)
  if (code === 'insufficient_quota') {
    return new SttError('insufficient_quota', 'Voice needs OpenAI credits — type a command instead.')
  }
  if (code === 'rate_limited') {
    return new SttError('rate_limited', 'Voice rate-limited — try again in a moment.')
  }
  if (code === 'not_configured') {
    return new SttError('not_configured', 'Voice not configured — type a command instead.')
  }
  if (code === 'too_large') return new SttError('too_large', message)
  if (/timeout/i.test(message)) return new SttError('timeout', 'Voice timed out — type a command instead.')
  return new SttError('stt_error', 'Voice failed — type a command instead.')
}

export function createSttSession(): SttSession {
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let closed = false

  return {
    sendPcm(chunk) {
      if (closed) return
      const bytes = chunkToBytes(chunk)
      // s16le: 2 bytes per sample. Stop growing past the cap; the user can
      // re-trigger capture for a longer phrase.
      const remaining = STT_MAX_SAMPLES * 2 - totalBytes
      if (remaining <= 0) return
      const take = bytes.subarray(0, remaining)
      chunks.push(take)
      totalBytes += take.length
    },
    get samples() {
      return Math.floor(totalBytes / 2)
    },
    async finish(): Promise<string> {
      closed = true
      if (totalBytes < 3200) return '' // <100 ms: silence / accidental tap
      const pcm = new Uint8Array(totalBytes)
      let off = 0
      for (const c of chunks) {
        pcm.set(c, off)
        off += c.length
      }
      try {
        return await transcribeAudio(encodeWav(pcm))
      } catch (err) {
        throw toSttError(err)
      }
    },
    close() {
      closed = true
      chunks.length = 0
      totalBytes = 0
    },
  }
}
