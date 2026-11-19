# DoraHacks Submission Draft — GlanceTrade

**Do not submit yet.** This draft is completed during build week (video
link + final screenshots) and submitted by the user before
**29 Nov 2026, 23:59 Dubai time (30 Nov 2026, 02:59 WIB)**.
Hackathon page: https://dorahacks.io/hackathon/even-realities/detail

---

## Project name

**GlanceTrade — Paper Trading on Even Realities G2**

## Track

**02 · Crypto & DeFi**

## Short description (for the listing)

Paper-trade crypto from your glasses. Glance at live prices, trade by
voice, confirm with one tap — with virtual money only. Live CoinGecko
prices, a $10,000 virtual portfolio, voice orders, price alerts, and a
read-only Polymarket odds glance, all on the 576×288 G2 display.
No real money, no wallet, no custody — ever.

## Long description

### The problem

Crypto moves while you are away from your desk. Checking a price means
pulling out your phone, unlocking it, and opening an app — and placing a
trade takes even longer. Paper-trading apps exist, but none are built for
a glance: one thing on screen, a few words, one action.

### Who it is for

Crypto traders and learners who want to follow the market and practise
trading while walking, commuting, or away from a desk — without taking
their phone out, and without risking real money.

### How it works

GlanceTrade is a web app (Vite + TypeScript) running in the Even
Realities app's WebView, rendering on G2 through the Even Hub SDK.

- **Read:** a watchlist (BTC/ETH/SOL) with live CoinGecko prices and 24h
  change; an asset view with 24h range and your paper position; a
  portfolio view with cash, holdings, and session PnL; top Polymarket
  markets (read-only odds).
- **Write:** say *"Buy 0.01 bitcoin"* — the glasses mic captures it, our
  backend transcribes it (Whisper), a deterministic parser fills the
  trade, and a confirm screen shows price, size, and virtual cost.
  **One tap confirms.** Price alerts work the same way by voice
  (*"Alert me if BTC goes above $100k"*).
- **Safety:** the portfolio is 100% virtual ($10,000 paper USD, stored
  locally on the phone). There is no wallet connection, no custody, no
  real order path, and no financial advice anywhere in the app.
  Fills use the live price shown on the confirm screen.
- **Optional Telegram relay:** fired price alerts can also reach your own
  Telegram bot chat (your own bot, your own chat, disabled by default) —
  because a G2 app cannot pop up alerts when it is not on screen.

### What we built during the hackathon (23–29 Nov 2026)

Everything: the glasses UI (6 screens), the input handler, the
paper-trading engine, the voice command parser, the backend proxy
(CoinGecko + Polymarket + Whisper STT + optional Telegram relay), the
headless simulator smoke tests, and the demo video. The app was
scaffolded from the official MIT-licensed `evenhub-templates/asr`
template. Planning documents (design, research notes, build plan) were
prepared before build week and are disclosed as such in the README.

### Tech stack

TypeScript, Vite, Even Hub SDK (`@evenrealities/even_hub_sdk`),
CoinGecko public API (keyless), Polymarket Gamma API (keyless, read-only),
Whisper STT (server-side key only), Vercel serverless backend,
Even Hub simulator (headless automation API for tests).

## Repository

https://github.com/darendrarp/glance-trade-g2 (public, MIT)

## Demo video

[≤ 3 min, recorded in the Even Hub simulator — link added during build week]

## Optional artifact

`.ehpk` packaged build (added during build week if packaging succeeds).

## Notes for the judges

- The demo runs entirely in the Even Hub simulator (no glasses needed,
  as the hackathon allows).
- Every trade in the demo is paper: virtual funds, local storage, no
  real-money path exists in the code.
- If voice input is unavailable in your environment, every flow is also
  completable by tap (preset amounts) — the app never depends on a
  single input path.
