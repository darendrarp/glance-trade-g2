# API Notes — CoinGecko + Polymarket (+ Telegram relay)

Researched 19 Nov 2026. Both primary data sources are **keyless public
APIs** — no signup, no key, no fee. That keeps the hackathon demo
frictionless and the "never ship API keys" rule trivially satisfied for
market data.

## 1. CoinGecko — live prices (primary read source)

- Base: `https://api.coingecko.com/api/v3`
- Endpoint (batched, one call for all coins):
  `GET /coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&price_change_percentage=24h`
  — returns `id`, `symbol`, `current_price`, `price_change_percentage_24h_in_currency`,
  `high_24h`, `low_24h`, `market_cap_rank`, etc.
- Lightweight alternative: `GET /simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true`
- **Keyless access: yes** (official CoinGecko docs + free-API guides agree).
  A free Demo API key (free signup) raises limits if needed — decide on
  day 1; key would live in backend env only, never in the app.
- **Rate limits (conflicting reports — design defensively):**
  - Official Demo plan: 30 calls/min, 10,000 calls/month (some CoinGecko
    pages say 100 calls/min on the newer free tier).
  - Independent live tests report keyless throttling as low as ~3 calls/min
    per IP, with HTTP 429 + `Retry-After: 60`.
  - **Design response:** the backend caches prices for **45 s** and serves
    every glasses client from cache; one batched request covers all coins
    (`per_page=250`). Worst case the glasses show a price up to 45 s old
    plus a `cached Xs ago` note — acceptable for a paper-trading demo.
    Backoff + retry on 429; never hammer in a loop.
- No WebSocket on the free tier; polling via the backend cache is the
  intended pattern for this app (the glasses only need fresh data while
  the app is open anyway).

## 2. Polymarket — odds glance (read-only)

- Public Gamma API: `https://gamma-api.polymarket.com/markets?limit=3&active=true&order=volume24hr&ascending=false`
  (keyless, no signup). Returns market question, `outcomePrices` (YES/NO),
  volume. Display the top 3 by 24h volume as one line each.
- Verify the exact response shape on day 1 (build week) — field names
  were not re-verified during preparation. Fallback if Gamma is
  unreachable: hide the odds screen and note it in the README (the app
  must never show stale/fake odds).
- **No betting from the glasses in v1.** The odds screen is read-only,
  which keeps the money-safety story airtight.

## 3. Telegram relay (optional, special-prize angle)

- Uses the Telegram Bot API (`https://api.telegram.org/bot<token>/sendMessage`).
- The user creates their own bot via @BotFather and pastes the token +
  chat id into the phone settings page (or backend env for the demo).
  The backend is a dumb forwarder: it sends only the alert text the
  user's own app generated. No trading on Telegram, no group access.
- Disabled by default; the core app works fully without it.
- Rule note: the track rule says "Use only the apps listed in your track",
  but the special prize ("Best Telegram integration") is explicitly open
  to projects from any track. Telegram here is a secondary notification
  channel for the user's own alerts, not a trading surface. This reasoning
  is stated in the submission draft; if organisers clarify otherwise at
  kickoff (23 Nov), the module is dropped with zero impact on the core app.

## 4. Speech-to-text (bring-your-own, server-side)

- The SDK delivers raw PCM (16 kHz mono s16le); transcription is our job.
- Default plan: OpenAI Whisper API (`/v1/audio/transcriptions`, model
  `whisper-1`) from the backend, key in env only. Cost is cents per demo.
- Free alternative to evaluate on day 1: Groq Whisper API free tier
  (rate-limited) — **not verified during preparation; verify before relying
  on it.**
- The `asr` template already contains the mic-capture pipeline with a
  blank STT stub — we plug the backend call into that stub.
- **Needs from the user (build week):** one STT API key (OpenAI or Groq),
  provided as an env var for the backend deployment — never pasted into
  chat or committed. If no key is available, the demo falls back to tap
  flows + typed commands (the app remains fully demo-able).

## 5. Hyperliquid testnet (stretch goal only)

- Not researched in depth during preparation. If pursued on day 5–6:
  testnet only, read-only quote preview first; execution only after a
  fresh scope check. Not promised for submission.
