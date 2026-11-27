# server/ — GlanceTrade backend (thin proxy)

Zero-dependency Node.js (18+) server. No database. No user funds.

```bash
npm install   # no deps, just validates package.json
npm run dev   # node --watch server.js on :3001
```

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness + cache state |
| `GET /api/prices?ids=bitcoin,ethereum,solana` | CoinGecko prices, 45 s cache, 429 backoff, stale-serve |
| `GET /api/odds` | Polymarket Gamma top 3 by 24h volume, 5 min cache |
| `POST /api/stt` | Groq Whisper (`whisper-large-v3-turbo`, free tier) — live when `GROQ_API_KEY` is set (env or `.env`); 503 `not_configured` without a key |
| `POST /api/alerts/telegram` | Telegram relay — **stub**: 503 `disabled` by default |

Env: copy `.env.example` to `.env` (never committed). On this VM the key
comes from the Secure Vault: run `python3 start-server.py` (it mints a
surrogate for `custom.groq` and execs `node server.js` with `GROQ_API_KEY`
set — the raw key never leaves the vault). Deploy target:
Vercel serverless (or any Node host); the glasses app's `app.json`
network whitelist must name the deployed origin.
