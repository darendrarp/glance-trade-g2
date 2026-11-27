// GlanceTrade backend — shared logic.
//
// Used by BOTH entry points, so there is exactly one implementation:
//   - the local dev server (../server.js, plain node:http)
//   - the Vercel serverless functions (api/*.js in this folder)
//
// Every handler is framework-agnostic: it takes plain inputs and returns
// { status, body: string, headers? }. No handler logs a secret; keys live
// in env only (GROQ_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).
//
// Endpoints:
//   GET  /api/health            -> { ok, pricesCached, oddsCached, sttConfigured, relayConfigured }
//   GET  /api/prices?ids=...    -> CoinGecko, one batched call, 45 s cache, 429 backoff
//   GET  /api/odds              -> Polymarket Gamma top 3 by 24h volume, 5 min cache
//   POST /api/stt               -> Groq Whisper (whisper-large-v3-turbo, free tier)
//   POST /api/alerts/telegram   -> forwards a fired-alert line to the user's
//        own Telegram bot chat. DISABLED by default: without
//        TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID it answers 503 { error:
//        "disabled" }. Allowed by the hackathon rules — the "Best Telegram
//        integration" special prize is explicitly open to projects from any
//        track (DoraHacks page, verified 27 Nov 2026).

import { readFileSync } from 'node:fs'

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3'
const GAMMA_BASE = 'https://gamma-api.polymarket.com'
const PRICES_TTL_MS = 45_000
const ODDS_TTL_MS = 300_000
// Vercel Hobby functions die at 10 s, so the deployed backend runs with
// tighter upstream timeouts via env (UPSTREAM_TIMEOUT_MS=9000,
// STT_TIMEOUT_MS=9000). Local dev keeps the roomier defaults.
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 15_000)
const STT_TIMEOUT_MS = Number(process.env.STT_TIMEOUT_MS ?? 30_000)
const TELEGRAM_TIMEOUT_MS = 10_000
const MAX_AUDIO_BYTES = 5 * 1024 * 1024
const MAX_RELAY_CHARS = 500

// --- tiny cache with stale-serve + backoff ---------------------------------
function makeCache(ttlMs) {
  return {
    ttlMs,
    data: null, // { value, fetchedAt }
    backoffUntil: 0,
    get() {
      return this.data
    },
    set(value) {
      this.data = { value, fetchedAt: Date.now() }
      this.backoffUntil = 0
    },
    fresh() {
      return this.data && Date.now() - this.data.fetchedAt < this.ttlMs
    },
    inBackoff() {
      return Date.now() < this.backoffUntil
    },
    backoff(seconds) {
      // Honor Retry-After, but never back off less than 30 s or more than 5 min.
      const s = Math.min(300, Math.max(30, seconds || 60))
      this.backoffUntil = Date.now() + s * 1000
    },
  }
}

export const pricesCache = makeCache(PRICES_TTL_MS)
export const oddsCache = makeCache(ODDS_TTL_MS)

async function fetchJson(url, { signal } = {}) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'GlanceTrade/0.1 (+https://github.com/darendrarp/glance-trade-g2)' },
    signal,
  })
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? 60)
    const err = new Error(`upstream 429 (Retry-After: ${retryAfter}s)`)
    err.status = 429
    err.retryAfter = retryAfter
    throw err
  }
  if (!res.ok) {
    const err = new Error(`upstream ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

function withTimeout(ms) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return { signal: ctrl.signal, done: () => clearTimeout(t) }
}

export function json(status, obj) {
  return { status, body: JSON.stringify(obj), headers: { 'Content-Type': 'application/json' } }
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Read a request body as a Buffer, capped at maxBytes (0 = no cap).
// Works for both the local node:http server and Vercel Node functions,
// where req is an IncomingMessage stream.
export async function readBody(req, maxBytes = MAX_AUDIO_BYTES) {
  // Vercel/Next-style runtimes sometimes pre-parse the body.
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.isBuffer(req.body)) return req.body
    if (typeof req.body === 'string') return Buffer.from(req.body)
    return Buffer.from(JSON.stringify(req.body))
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (maxBytes > 0 && size > maxBytes) {
      const err = new Error('body too large')
      err.status = 413
      throw err
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

// --- config (env only; .env is a local-dev fallback, never committed) ------

function readDotEnv(name) {
  try {
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    for (const line of env.split('\n')) {
      const m = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`))
      if (m) {
        const v = m[1].trim().replace(/^["']|["']$/g, '')
        if (v) return v
      }
    }
  } catch {
    // no .env file — the value simply isn't configured
  }
  return ''
}

function getGroqKey() {
  return process.env.GROQ_API_KEY || readDotEnv('GROQ_API_KEY')
}

export function getTelegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN || readDotEnv('TELEGRAM_BOT_TOKEN')
  const chatId = process.env.TELEGRAM_CHAT_ID || readDotEnv('TELEGRAM_CHAT_ID')
  if (!token || !chatId) return null
  return { token, chatId }
}

// --- handlers ---------------------------------------------------------------

export function handleHealth() {
  // sttConfigured / relayConfigured say only whether a key is present.
  // Quota / rate limits only show on a real transcribe or send.
  return json(200, {
    ok: true,
    pricesCached: Boolean(pricesCache.get()),
    oddsCached: Boolean(oddsCache.get()),
    sttConfigured: Boolean(getGroqKey()),
    relayConfigured: Boolean(getTelegramConfig()),
  })
}

export async function handlePrices(searchParams) {
  const idsParam = searchParams.get('ids') ?? 'bitcoin,ethereum,solana'
  const ids = idsParam.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 20)
  if (ids.length === 0) return json(400, { error: 'bad_request', message: 'ids required' })

  if (pricesCache.fresh()) {
    const { value, fetchedAt } = pricesCache.get()
    return json(200, { prices: value.filter((p) => ids.includes(p.id)), cachedAt: fetchedAt, stale: false })
  }
  if (pricesCache.inBackoff()) {
    const cached = pricesCache.get()
    if (cached) {
      return json(200, {
        prices: cached.value.filter((p) => ids.includes(p.id)),
        cachedAt: cached.fetchedAt,
        stale: true,
        note: 'rate-limited upstream; serving cached prices',
      })
    }
    return json(503, { error: 'upstream_rate_limited', message: 'CoinGecko rate-limited; try again shortly' })
  }

  const { signal, done } = withTimeout(UPSTREAM_TIMEOUT_MS)
  try {
    const markets = await fetchJson(
      `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&price_change_percentage=24h`,
      { signal },
    )
    const prices = markets.map((m) => ({
      id: m.id,
      symbol: (m.symbol ?? '').toUpperCase(),
      price: m.current_price,
      change24h: m.price_change_percentage_24h_in_currency ?? null,
      high24h: m.high_24h ?? null,
      low24h: m.low_24h ?? null,
    }))
    pricesCache.set(prices)
    return json(200, { prices: prices.filter((p) => ids.includes(p.id)), cachedAt: Date.now(), stale: false })
  } catch (err) {
    if (err.status === 429) pricesCache.backoff(err.retryAfter)
    const cached = pricesCache.get()
    if (cached) {
      return json(200, {
        prices: cached.value.filter((p) => ids.includes(p.id)),
        cachedAt: cached.fetchedAt,
        stale: true,
        note: `upstream error (${err.message}); serving cached prices`,
      })
    }
    const status = err.name === 'AbortError' ? 504 : 502
    return json(status, { error: 'upstream_error', message: `CoinGecko unreachable: ${err.message}` })
  } finally {
    done()
  }
}

export async function handleOdds() {
  if (oddsCache.fresh()) {
    const { value, fetchedAt } = oddsCache.get()
    return json(200, { markets: value, cachedAt: fetchedAt, stale: false })
  }
  if (oddsCache.inBackoff()) {
    const cached = oddsCache.get()
    if (cached) {
      return json(200, { markets: cached.value, cachedAt: cached.fetchedAt, stale: true, note: 'rate-limited upstream; serving cached odds' })
    }
    return json(503, { error: 'upstream_rate_limited', message: 'Polymarket Gamma rate-limited; try again shortly' })
  }

  const { signal, done } = withTimeout(UPSTREAM_TIMEOUT_MS)
  try {
    const markets = await fetchJson(
      `${GAMMA_BASE}/markets?limit=3&active=true&order=volume24hr&ascending=false`,
      { signal },
    )
    const parsed = markets.map((m) => {
      // Gamma returns outcomePrices as a JSON *string* ("[\"0.605\", \"0.395\"]").
      let raw = m.outcomePrices
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw) } catch { raw = [] }
      }
      const prices = Array.isArray(raw) ? raw.map(Number) : []
      return {
        question: m.question ?? 'Unknown market',
        yesPrice: Number.isFinite(prices[0]) ? prices[0] : null,
        volume24h: Number(m.volume24hr ?? m.volume ?? 0) || 0,
      }
    })
    oddsCache.set(parsed)
    return json(200, { markets: parsed, cachedAt: Date.now(), stale: false })
  } catch (err) {
    if (err.status === 429) oddsCache.backoff(err.retryAfter)
    const cached = oddsCache.get()
    if (cached) {
      return json(200, { markets: cached.value, cachedAt: cached.fetchedAt, stale: true, note: `upstream error (${err.message}); serving cached odds` })
    }
    const status = err.name === 'AbortError' ? 504 : 502
    return json(status, { error: 'upstream_error', message: `Polymarket Gamma unreachable: ${err.message}` })
  } finally {
    done()
  }
}

// --- speech-to-text (Groq Whisper, model whisper-large-v3-turbo) -----------
// Key source: GROQ_API_KEY env var first; if unset, server/.env is re-read
// on every request, so a key added after startup works without a restart.
// No key -> 503 not_configured (the app falls back to tap + typed commands).
// User decision 27 Nov 2026 ~09:05: Groq, not OpenAI — OpenAI key is valid
// but the account holds $0 credits, so its Whisper calls are refused; Groq
// Whisper verified end-to-end ("Buy 0.01 Bitcoin." in 1.4 s, free tier).
// The key is never logged, never returned, never committed. Locally the key
// arrives as a vault surrogate (start-server.py mints it from authd);
// Sentinel swaps it for the real key on outbound requests to api.groq.com.
export async function handleStt({ contentType, audio }) {
  const key = getGroqKey()
  if (!key) {
    return json(503, {
      error: 'not_configured',
      message: 'STT not configured — voice transcription unavailable; use tap or typed commands.',
    })
  }
  if (!audio || audio.length < 100) {
    return json(400, { error: 'bad_request', message: 'empty audio body' })
  }
  // Groq (like OpenAI) sniffs the audio format from the multipart filename,
  // so name the part after the request's Content-Type: the app sends WAV,
  // the test clip is MP3, other callers may send m4a/webm/ogg.
  const ctype = (contentType ?? 'audio/wav').split(';')[0].trim().toLowerCase()
  const AUDIO_FORMATS = {
    'audio/wav': ['audio.wav', 'audio/wav'],
    'audio/x-wav': ['audio.wav', 'audio/wav'],
    'audio/mpeg': ['audio.mp3', 'audio/mpeg'],
    'audio/mp3': ['audio.mp3', 'audio/mpeg'],
    'audio/mp4': ['audio.m4a', 'audio/mp4'],
    'audio/x-m4a': ['audio.m4a', 'audio/mp4'],
    'audio/webm': ['audio.webm', 'audio/webm'],
    'audio/ogg': ['audio.ogg', 'audio/ogg'],
    'audio/flac': ['audio.flac', 'audio/flac'],
  }
  const [filename, mime] = AUDIO_FORMATS[ctype] ?? ['audio.wav', 'audio/wav']
  const form = new FormData()
  form.append('file', new Blob([audio], { type: mime }), filename)
  form.append('model', 'whisper-large-v3-turbo')
  const { signal, done } = withTimeout(STT_TIMEOUT_MS)
  try {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = data?.error?.message ?? `Whisper HTTP ${res.status}`
      // Groq free tier: 429 is a rate limit (too many requests / audio too
      // long), NOT a billing block. Surface it distinctly so the app can
      // say "try again in a moment" instead of a generic STT error.
      return json(502, {
        error: 'stt_error',
        ...(res.status === 429 ? { code: 'rate_limited' } : {}),
        message: msg,
      })
    }
    return json(200, { text: String(data.text ?? '').trim(), language: data.language ?? null })
  } catch (err) {
    const status = err.name === 'AbortError' ? 504 : 502
    return json(status, { error: 'stt_error', message: `Whisper unreachable: ${err.message}` })
  } finally {
    done()
  }
}

// --- Telegram relay (optional, disabled by default) ------------------------
// Forwards one fired-alert line to the user's OWN bot chat (their bot,
// their chat — a notification channel only, no trading on Telegram).
// Enabled only when TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set in env
// (Vercel dashboard or server/.env for local dev). The token travels in
// the Bot API URL path over HTTPS to api.telegram.org — that is how the
// Bot API authenticates — and is never logged or returned.
export async function handleTelegram(body) {
  const cfg = getTelegramConfig()
  if (!cfg) {
    return json(503, { error: 'disabled', message: 'Telegram relay is disabled.' })
  }
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) {
    return json(400, { error: 'bad_request', message: 'text required' })
  }
  const { signal, done } = withTimeout(TELEGRAM_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cfg.chatId,
        text: text.slice(0, MAX_RELAY_CHARS),
        disable_web_page_preview: true,
      }),
      signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Do not echo the token or the raw upstream body; Telegram's
      // description is enough to diagnose a bad token / chat id.
      return json(502, {
        error: 'relay_error',
        message: `Telegram rejected the message: ${data?.description ?? `HTTP ${res.status}`}`,
      })
    }
    return json(200, { ok: true })
  } catch (err) {
    const status = err.name === 'AbortError' ? 504 : 502
    return json(status, { error: 'relay_error', message: `Telegram unreachable: ${err.message}` })
  } finally {
    done()
  }
}
