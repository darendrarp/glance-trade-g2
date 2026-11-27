// GlanceTrade backend — thin proxy, zero dependencies (Node 18+).
// Endpoints:
//   GET  /api/health                       -> { ok: true }
//   GET  /api/prices?ids=bitcoin,ethereum,solana
//        -> { prices: [{id, symbol, price, change24h, high24h, low24h}], cachedAt, stale }
//        CoinGecko /coins/markets, one batched call, 45 s cache, 429 backoff.
//   GET  /api/odds                         -> { markets: [{question, yesPrice, volume24h}], cachedAt, stale }
//        Polymarket Gamma top 3 by 24h volume, 5 min cache.
//   POST /api/stt                          -> Whisper transcription (Groq, model whisper-large-v3-turbo, FREE tier).
//        Key from GROQ_API_KEY env (or server/.env, re-read per request so a
//        key added after startup works without a restart). No key -> 503
//        { error: "not_configured" } and the app falls back to tap + typed
//        commands. User decision 27 Nov 2026 ~09:05: Groq, not OpenAI —
//        OpenAI key is valid but the account holds $0 credits, so its
//        Whisper calls are refused; Groq Whisper verified end-to-end
//        ("Buy 0.01 Bitcoin." in 1.4 s, free tier).
//   POST /api/alerts/telegram              -> 503 { error: "disabled" } (relay disabled by default).
// No database. No user funds. No secrets in code — keys live in env only.

import http from 'node:http'
import { readFileSync } from 'node:fs'

const PORT = Number(process.env.PORT ?? 3001)
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3'
const GAMMA_BASE = 'https://gamma-api.polymarket.com'
const PRICES_TTL_MS = 45_000
const ODDS_TTL_MS = 300_000
const UPSTREAM_TIMEOUT_MS = 15_000

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

const pricesCache = makeCache(PRICES_TTL_MS)
const oddsCache = makeCache(ODDS_TTL_MS)

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

// --- handlers ---------------------------------------------------------------

async function handlePrices(url) {
  const idsParam = url.searchParams.get('ids') ?? 'bitcoin,ethereum,solana'
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

async function handleOdds() {
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
// The key is never logged, never returned, never committed. In production the
// key arrives as a vault surrogate (start-server.py mints it from authd);
// Sentinel swaps it for the real key on outbound requests to api.groq.com.
function getGroqKey() {
  if (process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY
  try {
    const env = readFileSync(new URL('./.env', import.meta.url), 'utf8')
    for (const line of env.split('\n')) {
      const m = line.match(/^\s*GROQ_API_KEY\s*=\s*(.+?)\s*$/)
      if (m) {
        const v = m[1].trim().replace(/^["']|["']$/g, '')
        if (v) return v
      }
    }
  } catch {
    // no .env file — key simply isn't configured yet
  }
  return ''
}

async function handleStt(req) {
  const key = getGroqKey()
  if (!key) {
    return json(503, {
      error: 'not_configured',
      message: 'STT not configured — voice transcription unavailable; use tap or typed commands.',
    })
  }
  // Read the audio body (WAV from the app, max 5 MB).
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 5 * 1024 * 1024) {
      return json(413, { error: 'too_large', message: 'audio exceeds 5 MB' })
    }
    chunks.push(chunk)
  }
  const audio = Buffer.concat(chunks)
  if (audio.length < 100) {
    return json(400, { error: 'bad_request', message: 'empty audio body' })
  }
  // Groq (like OpenAI) sniffs the audio format from the multipart filename,
  // so name the part after the request's Content-Type: the app sends WAV,
  // the test clip is MP3, other callers may send m4a/webm/ogg.
  const ctype = (req.headers['content-type'] ?? 'audio/wav').split(';')[0].trim().toLowerCase()
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
  const { signal, done } = withTimeout(30_000)
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

// --- http plumbing ----------------------------------------------------------

function json(status, obj) {
  return { status, body: JSON.stringify(obj), headers: { 'Content-Type': 'application/json' } }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const send = (r) => {
    res.writeHead(r.status, { ...CORS, ...r.headers })
    res.end(r.body)
  }
  try {
    if (req.method === 'OPTIONS') return send({ status: 204, body: '' })
    if (req.method === 'GET' && url.pathname === '/api/health') {
      // sttConfigured = a Groq key is present (env or .env). It says
      // nothing about rate limits — those only show on a real transcribe.
      return send(json(200, { ok: true, pricesCached: Boolean(pricesCache.get()), oddsCached: Boolean(oddsCache.get()), sttConfigured: Boolean(getGroqKey()) }))
    }
    if (req.method === 'GET' && url.pathname === '/api/prices') return send(await handlePrices(url))
    if (req.method === 'GET' && url.pathname === '/api/odds') return send(await handleOdds())
    if (req.method === 'POST' && url.pathname === '/api/stt') return send(await handleStt(req))
    if (req.method === 'POST' && url.pathname === '/api/alerts/telegram') {
      // Relay is disabled by default; it only forwards when the user has
      // paired their own bot (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID) and
      // the app opts in. Wiring lands with the relay module (Day 4).
      return send(json(503, { error: 'disabled', message: 'Telegram relay is disabled.' }))
    }
    return send(json(404, { error: 'not_found', message: `no route ${req.method} ${url.pathname}` }))
  } catch (err) {
    console.error('handler error:', err)
    return send(json(500, { error: 'internal', message: String(err?.message ?? err) }))
  }
})

server.listen(PORT, () => {
  console.log(`GlanceTrade backend listening on http://localhost:${PORT}`)
  console.log(`  GET  /api/prices?ids=bitcoin,ethereum,solana`)
  console.log(`  GET  /api/odds`)
  console.log(`  POST /api/stt  (Groq whisper-large-v3-turbo ${getGroqKey() ? 'LIVE — key configured' : 'stub: not configured'})`)
  console.log(`  POST /api/alerts/telegram  (stub: disabled)`)
})
