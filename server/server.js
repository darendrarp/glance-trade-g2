// GlanceTrade backend — local dev server (plain node:http, zero deps).
// All logic lives in ./api/_lib.js, shared with the Vercel serverless
// functions (api/*.js), so local and deployed behavior stay identical.
//
// Endpoints:
//   GET  /api/health                       -> { ok, pricesCached, oddsCached, sttConfigured, relayConfigured }
//   GET  /api/prices?ids=bitcoin,ethereum,solana
//        -> CoinGecko /coins/markets, one batched call, 45 s cache, 429 backoff.
//   GET  /api/odds                         -> Polymarket Gamma top 3 by 24h volume, 5 min cache.
//   POST /api/stt                          -> Groq Whisper (whisper-large-v3-turbo, free tier).
//        Key from GROQ_API_KEY env (or server/.env, re-read per request).
//        No key -> 503 { error: "not_configured" }; the app falls back to
//        tap + typed commands. User decision 27 Nov 2026 ~09:05: Groq, not
//        OpenAI — OpenAI key is valid but the account holds $0 credits, so
//        its Whisper calls are refused; Groq Whisper verified end-to-end
//        ("Buy 0.01 Bitcoin." in 1.4 s, free tier).
//   POST /api/alerts/telegram              -> forwards a fired-alert line to
//        the user's own Telegram bot chat. DISABLED by default (503) until
//        TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set.
// No database. No user funds. No secrets in code — keys live in env only.
// Run with ./start-server.py (vault Groq key) or `node server.js` (no STT).

import http from 'node:http'
import {
  CORS,
  getTelegramConfig,
  handleHealth,
  handleOdds,
  handlePrices,
  handleStt,
  handleTelegram,
  json,
  readBody,
} from './api/_lib.js'

const PORT = Number(process.env.PORT ?? 3001)

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const send = (r) => {
    res.writeHead(r.status, { ...CORS, ...r.headers })
    res.end(r.body)
  }
  try {
    if (req.method === 'OPTIONS') return send({ status: 204, body: '' })
    if (req.method === 'GET' && url.pathname === '/api/health') return send(handleHealth())
    if (req.method === 'GET' && url.pathname === '/api/prices') return send(await handlePrices(url.searchParams))
    if (req.method === 'GET' && url.pathname === '/api/odds') return send(await handleOdds())
    if (req.method === 'POST' && url.pathname === '/api/stt') {
      let audio
      try {
        audio = await readBody(req)
      } catch (err) {
        if (err.status === 413) return send(json(413, { error: 'too_large', message: 'audio exceeds 5 MB' }))
        throw err
      }
      return send(await handleStt({ contentType: req.headers['content-type'], audio }))
    }
    if (req.method === 'POST' && url.pathname === '/api/alerts/telegram') {
      let raw
      try {
        raw = await readBody(req, 64 * 1024)
      } catch (err) {
        if (err.status === 413) return send(json(413, { error: 'too_large', message: 'body exceeds 64 KB' }))
        throw err
      }
      let body = {}
      try {
        body = JSON.parse(raw.toString('utf8'))
      } catch {
        return send(json(400, { error: 'bad_request', message: 'invalid JSON body' }))
      }
      return send(await handleTelegram(body))
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
  console.log(`  POST /api/stt  (Groq whisper-large-v3-turbo ${process.env.GROQ_API_KEY ? 'LIVE — key configured' : 'stub: not configured'})`)
  console.log(`  POST /api/alerts/telegram  (${getTelegramConfig() ? 'LIVE — relay configured' : 'stub: disabled'})`)
})
