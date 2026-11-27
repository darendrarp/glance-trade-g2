# GlanceTrade — Paper Trading on Even Realities G2

> **Heads Up: Even Realities Hackathon** · Track 02 · Crypto & DeFi
> Glance at the price. Trade by voice. Confirm with one tap. **No real money, ever.**

GlanceTrade is a web app (Vite + TypeScript) that runs in a WebView inside the
Even Realities app and renders on **Even Realities G2** smart glasses
(576 × 288 monochrome green display). It turns the glasses into a
**paper-trading terminal**: live crypto prices, a virtual $10,000 portfolio,
voice orders with one-tap confirmation, price alerts, and a read-only glance
at Polymarket odds — all while you walk, without taking your phone out.

## Status

🚧 **Preparation phase (19 Nov 2026).** Per the hackathon rules
(*"Build during the hackathon"*), **all application code is written during
build week, 23–29 Nov 2026**. This repository currently contains only
planning, design, and research documents. The app scaffold, backend, and
demo video land during build week — see
[`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md).

### What existed before 23 Nov 2026 (rule disclosure)

As required by the rules, this is everything that existed before build week:

- This README, the design doc, the build plan, the SDK research notes, the
  API notes, the submission draft, and the video script (all in `docs/`).
- The repository skeleton itself (`.gitignore`, `LICENSE`, placeholder
  READMEs in `app/` and `server/`).
- **No application code.** No `package.json`, no `src/`, no `app.json`
  manifest, no backend code. The app is scaffolded from the official
  MIT-licensed `even-realities/evenhub-templates` (`asr` template) on
  23 Nov, and every line of GlanceTrade code is written during build week.
- Open-source libraries used during build week (Even Hub SDK, Vite,
  the official template) are listed in `docs/BUILD_PLAN.md`.

## The problem

Crypto moves while you are away from your desk. Checking prices means
pulling out your phone, unlocking it, opening an app, and losing the moment
you were in. Placing a trade takes even longer. Paper-trading apps exist,
but none of them are built for a **glance**: one thing on screen, a few
words, one action.

## How it works

| Moment | On the glasses |
|---|---|
| **Glance** | Watchlist: BTC / ETH / SOL with live price + 24h change. One asset in focus, swipe to move. |
| **Ask** | *"How much is Solana?"* — voice in, answer on the lens in seconds. |
| **Trade (paper)** | *"Buy 0.01 bitcoin"* → confirm screen shows price, size, and virtual cost → **one tap to confirm**. Fills at the live CoinGecko price against a virtual $10,000 portfolio stored on the phone. |
| **Track** | Portfolio screen: cash, holdings, session PnL. |
| **Alert** | *"Alert me if BTC goes above $100k"* — alert fires on the lens; optionally also via your own Telegram bot. |
| **Odds** | Top Polymarket markets, read-only, one line each. |

Full screen-by-screen design: [`docs/DESIGN.md`](docs/DESIGN.md).

## Track compliance

- **Track 02 · Crypto & DeFi.** Integrations used: **CoinGecko**
  (live prices), **Polymarket** (odds, read-only). Both have open public
  APIs; no API key is shipped in the app.
- **Money safety (rule):** the demo uses **paper trading only** — virtual
  funds, local storage, no wallet connection, no custody, no real orders.
  No financial advice is given anywhere in the app. No API keys or secrets
  are committed; server-side keys live in environment variables only.
- **Telegram (optional, special-prize angle):** an opt-in, disabled-by-
  default relay that forwards *your own* price alerts to *your own*
  Telegram bot chat. It is a notification channel only — no trading
  happens on Telegram. The special prize ("Best Telegram integration") is
  explicitly open to projects from any track, which is why this optional
  module exists; the core app works fully without it.
- **Stretch goal (only if time permits on day 5–6):** Hyperliquid
  testnet order preview (read-only quote, no execution without explicit
  re-scope). Not promised for the submission.

## Architecture

```
G2 glasses ──BLE── Even Realities app (WebView) ──HTTPS── GlanceTrade backend
   576×288       app/ : Vite + TS + Even Hub SDK            server/ : thin proxy
   mic/touch     - glasses UI (text containers)             - /api/prices  (CoinGecko, cached 45s)
   R1 ring       - voice capture (PCM 16 kHz)               - /api/odds    (Polymarket Gamma)
                 - paper engine (local storage)             - /api/stt     (Whisper, key server-side)
                 - no secrets in the app                    - /api/alerts  (optional Telegram relay)
```

- **External calls are whitelisted** in `app.json` and routed through our
  own backend (per the hackathon brief: never ship API keys inside the app).
- **Speech-to-text is bring-your-own:** the SDK hands us raw microphone
  audio; the backend transcribes it (Whisper). If STT is unavailable, the
  app still works fully by tap (preset amounts) — the demo never depends
  on a single fragile path.
- **No background alerts:** while the app is open it can show live data;
  when the user switches away it cannot pop up anything (platform limit).
  That is why Telegram relay exists as the out-of-app alert path.

## Setup (during build week)

Prerequisites: Node.js 18+, the Even Hub CLI + simulator:

```bash
npm install -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator
```

Run the app (from `app/`):

```bash
npm install
npm run dev          # Terminal 1 — Vite dev server on :5173
evenhub-simulator http://localhost:5173   # Terminal 2 — G2 simulator
```

Run the backend (from `server/`, needs `GROQ_API_KEY` in `.env` — never committed — or run `python3 start-server.py` to use the vault key):

```bash
npm install
npm run dev
```

Package for distribution:

```bash
cd app && npx evenhub pack   # produces .ehpk
```

Verified toolchain (19 Nov 2026): SDK `@evenrealities/even_hub_sdk`
`0.0.16`, CLI `0.2.0`, simulator `0.9.5`. Full environment notes,
including the headless-Linux simulator setup, are in
[`docs/SDK_NOTES.md`](docs/SDK_NOTES.md).

## Demo video

≤ 3 minutes, recorded in the Even Hub simulator. Script + shot list:
[`docs/VIDEO_SCRIPT.md`](docs/VIDEO_SCRIPT.md). (Recorded during build
week; this file is updated with the video link before submission.)

## Submission

- Hackathon: [Heads Up: Even Realities Hackathon](https://dorahacks.io/hackathon/even-realities/detail)
- Build week: 23–29 Nov 2026 · Submission deadline: **29 Nov 2026, 23:59
  Dubai time (30 Nov 2026, 02:59 WIB)**
- Demo Day: 3 Dec 2026, Daos Hub Dubai (finalists may demo remotely)
- Submission draft: [`docs/SUBMISSION_DRAFT.md`](docs/SUBMISSION_DRAFT.md)

## License

MIT. The official Even Hub templates this project is scaffolded from are
also MIT-licensed (© Even Realities).
