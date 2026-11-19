# server/ — GlanceTrade backend (thin proxy)

**Empty on purpose.** Per the hackathon rule *"Build during the
hackathon"*, this directory is built on **23–24 Nov 2026** (build week).

Planned endpoints (see `../docs/DESIGN.md` §6 and `../docs/API_NOTES.md`):

| Endpoint | Purpose |
|---|---|
| `GET /api/prices` | CoinGecko prices, cached 45 s |
| `GET /api/odds` | Polymarket top markets, cached 5 min |
| `POST /api/stt` | Whisper speech-to-text (key in env only) |
| `POST /api/alerts/telegram` | Optional Telegram alert relay (opt-in) |

No database. No user funds. No secrets committed — keys live in
environment variables only (`.env`, git-ignored).
