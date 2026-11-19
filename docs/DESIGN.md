# GlanceTrade — Design Document

**Hackathon:** Heads Up: Even Realities Hackathon · **Track:** 02 Crypto & DeFi
**Status:** design frozen 19 Nov 2026 (preparation phase — no code before 23 Nov)
**Principle:** *design for a glance.* One thing on screen, a few words,
one action by tap, ring, or a short phrase. (Hackathon brief.)

## 1. Concept

**GlanceTrade** is a paper-trading terminal for Even Realities G2 glasses.

- **Who it is for:** crypto traders and learners who want to follow the
  market and practise trading while walking, commuting, or away from a desk
  — without pulling out their phone, and without risking real money.
- **The moment it solves:** *"BTC is moving — is my paper position green?
  Should I practise selling here?"* Answer in one glance, act in one tap.
- **What makes it a G2 app, not a phone app shrunk down:** every flow is
  completable without looking at the phone: voice order → confirm on the
  lens → tap. The phone stays in the pocket for the whole session.

## 2. Platform constraints (shape every decision)

| Constraint | Design consequence |
|---|---|
| Display 576 × 288, monochrome green, 4-bit greyscale (16 shades), line height ~27 px → **~10 lines max** | Max ~9 lines per screen; short labels; no dashboards |
| No camera, no speaker | All feedback is visual; no audio confirmations |
| One app on screen at a time; no pop-ups when switched away | Live data only while open; Telegram relay is the out-of-app alert path |
| No access to other apps' notifications | Talk to CoinGecko / Polymarket APIs directly via our backend |
| SDK gives raw mic audio only (PCM 16 kHz mono) | STT is our own backend service (Whisper); tap fallback always available |
| External calls must be whitelisted in `app.json` + pass CORS | All API calls go through our backend; never ship keys in the app |
| Google sign-in does not work in the WebView | No sign-in at all: paper portfolio is local; Telegram pairing via code typed on phone settings page |
| No font control, no text alignment, no background colours, no animations, greyscale images only | Text-first UI; hierarchy via brightness levels (`textColor` 0–4) and spacing, not styling |
| `CLICK_EVENT` = 0 is omitted by protobuf → tap arrives with `eventType: undefined` | Event handler must resolve the default **inside** the envelope check (see SDK notes); check explicit ids first, click last |

## 3. Screens (576 × 288, text containers)

### S1 — Watchlist (home)
```
BTC  $97,432  +2.4%
ETH  $3,412   -0.8%
SOL  $214.60  +5.1%
─────────────────
Tap: open · Swipe: move
```
- Focus item shown brightest; swipe up/down moves focus; tap opens S2.
- Prices refresh every 45 s while open (backend cache window).

### S2 — Asset detail
```
BITCOIN  BTC
$97,432  +2.4% 24h
24h $94,810 – $98,205
─────────────────
PAPER: 0.0500 BTC
Value $4,872  PnL +$132
─────────────────
Tap: trade · Dbl-tap: back
```
- No sparkline image in v1 (glyph coverage for block chars is unverified;
  test in simulator on day 2 — if `▁▃▅▇` renders, add a 1-line sparkline).

### S3 — Trade confirm (the "write" moment)
```
BUY 0.01 BTC
@ $97,432
Cost $974.32 (paper)
Cash left $5,128
─────────────────
TAP = CONFIRM
Dbl-tap = cancel
```
- One tap confirms; double-tap cancels. No typing, no sliders on glasses.
- Amount comes from voice ("buy 0.01 bitcoin") or from tap presets
  ($100 / $500 / $1,000) on a pre-confirm step.

### S4 — Portfolio
```
PORTFOLIO (paper)
Cash $5,128  Invested $4,872
Session PnL +$132 (+1.3%)
─────────────────
BTC 0.05  $4,872  +2.7%
ETH 0.00  $0
─────────────────
Long-press: reset paper
```
- Reset (back to $10,000 virtual) requires long-press + confirm, so it
  can never happen by accident.

### S5 — Alerts
```
ALERTS
BTC > $100,000   ON
ETH < $3,000     ON
SOL +10% 24h     OFF
─────────────────
Voice: "alert BTC above 100k"
```
- Firing alert replaces the current screen with a 2-line banner until
  dismissed by tap. Out-of-app delivery via optional Telegram relay.

### S6 — Polymarket odds (read-only)
```
POLYMARKET
Fed cut in Dec?  YES 68%
BTC > $100k Dec? YES 54%
ETH ETF inflow?  YES 71%
─────────────────
Read-only · Tap: refresh
```
- Top 3 markets by volume from the public Gamma API. No betting from the
  glasses in v1 (keeps the money-safety story airtight).

### Phone settings page (WebView, not on glasses)
- Watchlist picker (add/remove coins), Telegram bot pairing code,
  paper-portfolio reset, STT status. Plain HTML — only used for setup.

## 4. Voice commands (v1 grammar)

| Phrase (examples) | Action |
|---|---|
| "How much is bitcoin / Solana?" | Open S2 for that asset |
| "Buy 0.01 bitcoin" / "Buy $500 of ETH" | Open S3 pre-filled |
| "Sell half my bitcoin" / "Sell all SOL" | Open S3 pre-filled (sell) |
| "Show my portfolio" | Open S4 |
| "Alert me if BTC goes above 100k" | Create alert, confirm on S5 |
| "What are the odds?" | Open S6 |

Parsing: small deterministic parser (amount + asset + direction keywords)
over the STT transcript — no LLM call in the hot path (fast, free,
predictable). Unrecognised input → glasses show *"Didn't catch that —
try 'buy 0.01 bitcoin'"* and fall back to tap flow. Never guess a trade:
if amount or asset is ambiguous, ask on screen instead of filling S3.

## 5. Paper-trading engine (client-side, local)

- Starting balance: **$10,000 virtual USD**.
- Fills at the latest cached CoinGecko price (shown on the confirm
  screen, so the user always sees the fill price before confirming).
- No fees, no slippage model in v1 (documented as a simplification).
- State in SDK local storage on the phone; survives app restarts.
- No wallet, no keys, no network call carries anything of value.
  The engine cannot lose real money because it never touches any.

## 6. Backend (thin proxy, `server/`)

| Endpoint | Purpose | Upstream |
|---|---|---|
| `GET /api/prices?ids=bitcoin,ethereum,solana` | Batched prices + 24h change, cached 45 s | CoinGecko `/coins/markets` (keyless) |
| `GET /api/odds` | Top 3 Polymarket markets by volume, cached 5 min | Polymarket Gamma API (keyless) |
| `POST /api/stt` (audio PCM → text) | Speech-to-text | Whisper (key in env only) |
| `POST /api/alerts/telegram` | Forward a fired alert to the user's own bot chat (opt-in) | Telegram Bot API (user's own token, env/config only) |

- Hosted on Vercel serverless (free tier) or equivalent; single-region,
  no database (alerts are evaluated client-side while the app is open;
  the Telegram relay is a dumb forwarder).
- `app.json` network whitelist contains exactly one origin: the backend
  URL. Nothing else is fetched from the glasses app.

## 7. Judging-criteria mapping

| Criterion (weight) | How GlanceTrade scores |
|---|---|
| Usefulness on G2 · 30% | A real moment (market moving while walking), solved hands-free |
| Read and write · 25% | Read: prices, PnL, odds. Write: voice order + one-tap confirm, voice alerts — the fastest possible write path |
| Technical execution · 20% | End-to-end in simulator: SDK bridge, mic→STT→parser→confirm→local ledger; headless simulator automation tests |
| UX for display & voice · 15% | ≤9 lines/screen, brightness hierarchy, natural short phrases, tap fallback everywhere |
| Business potential & safety · 10% | Paper trading is a proven onboarding funnel for brokerages/exchanges; zero custody, zero real funds, no advice |

## 8. Out of scope (deliberate)

- Real trading, wallet connection, custody — forbidden by the rules.
- Hyperliquid testnet execution — stretch goal only (see README).
- Kalshi, Gram Wallet, Trust Wallet — not needed for this concept.
- Charts/images on glasses in v1 — text only, until glyph/image behaviour
  is verified in the simulator.
- Multi-language UI — English only for the hackathon.
