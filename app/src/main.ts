// GlanceTrade — paper-trading terminal for Even Realities G2 glasses.
//
// Screens: S1 watchlist -> S2 asset -> S3 trade confirm -> S4 portfolio ->
// S5 alerts -> S6 Polymarket odds. Paper money only ($10,000 virtual, local
// ledger, no wallet, no real orders). Voice orders go mic -> batch STT
// (/api/stt, Whisper) -> deterministic parser -> S3 pre-filled; every voice
// failure degrades to tap + typed commands with a one-line reason, never a
// blank screen. Double-tap on the root exits via the system dialog (mode 1).
//
// Input gotcha (protobuf omits zero-value fields): a single tap arrives as
// an envelope with NO eventType, so the CLICK default is resolved INSIDE the
// envelope check, explicit ids are matched first, and CLICK is checked last.
// Audio frames arrive on audioEvent only — never through the tap handler.

import {
  AudioInputSource,
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import {
  BACKEND_URL,
  COINS,
  fetchOdds,
  fetchPrices,
  formatUsd,
  type CoinId,
  type OddsMarket,
  type Price,
} from './api'
import {
  buy,
  freshPortfolio,
  investedValue,
  loadPortfolio,
  savePortfolio,
  sell,
  sessionPnl,
  windowStorage,
  type Portfolio,
  type Storage,
} from './engine'
import {
  ALERTS_KEY,
  alertLabel,
  defaultAlerts,
  evaluateAlerts,
  firedMessage,
  type Alert,
} from './alerts'
import { parseCommand, type Command } from './voice'
import { createSttSession, SttError, type SttSession } from './asr/stt'
import {
  renderAlerts,
  renderAsset,
  renderBanner,
  renderConfirmReset,
  renderOdds,
  renderPortfolio,
  renderTrade,
  renderTradeDone,
  renderWatchlist,
  TRADE_PRESETS,
  type ScreenCtx,
  type ScreenId,
  type TradeDraft,
} from './screens'
import {
  mountUi,
  setBackendChip,
  setCommandHint,
  setGlassesText,
  setMicButton,
  setMirror,
  setVoiceChip,
} from './ui'

const SELL_FRACTIONS = [1, 0.5, 0.25]
const PRICE_POLL_MS = 45_000
const MENU_ROWS: { label: string; target: ScreenId | string }[] = [
  { label: 'Portfolio', target: 'portfolio' },
  { label: 'Alerts', target: 'alerts' },
  { label: 'Odds', target: 'odds' },
]

type VoiceState = 'off' | 'listening' | 'processing' | 'needs-credits' | 'unavailable'

interface State {
  screen: ScreenId
  prevScreen: ScreenId
  focus: number
  selectedCoin: CoinId
  prices: Price[]
  pricesCachedAt: number | null
  pricesStale: boolean
  offline: boolean
  odds: OddsMarket[]
  oddsAvailable: boolean
  portfolio: Portfolio
  alerts: Alert[]
  trade: TradeDraft | null
  tradeMsg: string | null
  bannerText: string | null
  statusLine: string | null
  voice: VoiceState
}

const state: State = {
  screen: 'watchlist',
  prevScreen: 'watchlist',
  focus: 0,
  selectedCoin: 'bitcoin',
  prices: [],
  pricesCachedAt: null,
  pricesStale: false,
  offline: false,
  odds: [],
  oddsAvailable: false,
  portfolio: freshPortfolio(),
  alerts: defaultAlerts(),
  trade: null,
  tradeMsg: null,
  bannerText: null,
  statusLine: null,
  voice: 'off',
}

let bridge: EvenAppBridge | null = null
let browserMode = false
let storage: Storage = windowStorage()
let sttSession: SttSession | null = null
let captureTimer: number | null = null
let unsubscribe: (() => void) | null = null
let priceTimer: number | null = null
let cleanedUp = false
let resetArmedUntil = 0

// --- helpers ---------------------------------------------------------------

function priceOf(coinId: string): number {
  return state.prices.find((p) => p.id === coinId)?.price ?? 0
}

function sdkStorage(b: EvenAppBridge): Storage {
  return {
    async get(key) {
      try {
        const v = await b.getLocalStorage(key)
        return v ? v : null
      } catch {
        return null
      }
    },
    async set(key, value) {
      try {
        await b.setLocalStorage(key, value)
      } catch {
        // storage unavailable — state lives in memory this session
      }
    },
  }
}

async function loadAlerts(s: Storage): Promise<Alert[]> {
  try {
    const raw = await s.get(ALERTS_KEY)
    if (!raw) return defaultAlerts()
    const parsed = JSON.parse(raw) as Alert[]
    if (!Array.isArray(parsed)) return defaultAlerts()
    return parsed
  } catch {
    return defaultAlerts()
  }
}

async function saveAlerts(): Promise<void> {
  await storage.set(ALERTS_KEY, JSON.stringify(state.alerts))
}

async function waitBridge(timeoutMs: number): Promise<EvenAppBridge | null> {
  try {
    return await Promise.race([
      waitForEvenAppBridge(),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
    ])
  } catch {
    return null
  }
}

// --- rendering -------------------------------------------------------------

function buildCtx(): ScreenCtx {
  const trade = state.trade
    ? state.trade.mode === 'usd' && priceOf(state.trade.coinId) > 0
      ? { ...state.trade, qty: state.trade.usd / priceOf(state.trade.coinId) }
      : state.trade
    : null
  return {
    screen: state.screen,
    focus: state.focus,
    prices: state.prices,
    pricesAgeSec:
      state.pricesCachedAt === null ? null : Math.max(0, Math.round((Date.now() - state.pricesCachedAt) / 1000)),
    pricesStale: state.pricesStale,
    offline: state.offline,
    odds: state.odds,
    oddsAvailable: state.oddsAvailable,
    portfolio: state.portfolio,
    alerts: state.alerts,
    trade,
    tradeMsg: state.tradeMsg,
    bannerText: state.bannerText,
    errorLine: state.statusLine,
    voiceNote: null,
    menuRows: MENU_ROWS,
  }
}

function renderText(ctx: ScreenCtx): string {
  switch (ctx.screen) {
    case 'watchlist':
      return renderWatchlist(ctx)
    case 'asset':
      return renderAsset(ctx, state.selectedCoin)
    case 'trade':
      return renderTrade(ctx)
    case 'tradeDone':
      return renderTradeDone(ctx)
    case 'portfolio':
      return renderPortfolio(ctx)
    case 'alerts':
      return renderAlerts(ctx)
    case 'odds':
      return renderOdds(ctx)
    case 'confirmReset':
      return renderConfirmReset()
    case 'banner':
      return renderBanner(ctx)
  }
}

let lastGlassesText = ''
let renderTimer: number | null = null

function render() {
  const ctx = buildCtx()
  const text = renderText(ctx)
  setGlassesText(text)
  updateMirror()
  if (browserMode || !bridge) return
  if (renderTimer !== null) return
  renderTimer = window.setTimeout(() => {
    renderTimer = null
    if (text === lastGlassesText || !bridge) return
    lastGlassesText = text
    void bridge
      .textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'main', content: text }))
      .catch(() => {
        // BLE render queue hiccup — next render retries with fresh text.
        lastGlassesText = ''
      })
  }, 120) // debounce display writes — BLE render queue is slow
}

function updateMirror() {
  const priceMap = new Map(state.prices.map((p) => [p.id, p.price]))
  const invested = investedValue(state.portfolio, priceMap)
  const pnl = sessionPnl(state.portfolio, priceMap)
  const tick = state.prices.map((p) => `${p.symbol} $${p.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`).join(' · ')
  setMirror(
    `Cash ${formatUsd(state.portfolio.cash)} · Invested ${formatUsd(invested)} · Session PnL ${pnl >= 0 ? '+' : ''}${formatUsd(pnl)}` +
      (tick ? `\n${tick}` : ''),
  )
}

function setStatusLine(line: string | null) {
  state.statusLine = line
}

function go(screen: ScreenId) {
  state.screen = screen
  state.statusLine = null
  if (screen === 'watchlist') state.focus = 0
  if (screen === 'alerts') state.focus = 0
  render()
}

function back() {
  switch (state.screen) {
    case 'asset':
    case 'portfolio':
    case 'alerts':
    case 'odds':
    case 'tradeDone':
      go('watchlist')
      break
    case 'trade':
      go('asset')
      break
    case 'confirmReset':
      go('portfolio')
      break
    case 'banner':
      state.screen = state.prevScreen
      state.bannerText = null
      render()
      break
    default:
      go('watchlist')
  }
}

// --- data ------------------------------------------------------------------

async function refreshPrices() {
  try {
    const r = await fetchPrices()
    const firstLoad = state.pricesCachedAt === null
    state.prices = r.prices
    state.pricesCachedAt = r.cachedAt
    state.pricesStale = r.stale
    state.offline = false
    setBackendChip(true)
    const fired = evaluateAlerts(
      state.alerts,
      new Map(state.prices.map((p) => [p.id, { price: p.price, change24h: p.change24h }])),
    )
    // First load: a condition that already holds (e.g. ETH < $3,000 at
    // boot) is not a crossing — arm the fired flags silently so the app
    // opens on the watchlist, and only fresh crossings pop the banner.
    if (fired.length > 0 && !firstLoad) {
      await saveAlerts()
      if (state.screen !== 'banner') {
        state.prevScreen = state.screen
        state.bannerText = fired.map((a) => firedMessage(a, priceOf(a.coin))).join(' | ')
        state.screen = 'banner'
      }
    } else if (fired.length > 0) {
      await saveAlerts()
    }
    render()
  } catch {
    state.offline = true
    setBackendChip(false)
    render()
  }
}

async function refreshOdds() {
  try {
    const r = await fetchOdds()
    state.odds = r.markets
    state.oddsAvailable = r.markets.length > 0
  } catch {
    state.oddsAvailable = false
  }
  render()
}

async function probeVoice() {
  // Key presence only — quota is only provable by a real transcribe, which
  // the app attempts on demand and reports honestly when it fails.
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`)
    const data = (await res.json().catch(() => ({}))) as { sttConfigured?: boolean }
    if (data.sttConfigured === true) {
      if (state.voice === 'off') setVoiceChip('ready')
    } else {
      if (state.voice === 'off') setVoiceChip('off')
    }
  } catch {
    if (state.voice === 'off') setVoiceChip('unavailable')
  }
}

// --- trades ----------------------------------------------------------------

function newBuyDraft(coinId: CoinId, usd = 500): TradeDraft {
  const price = priceOf(coinId)
  const idx = TRADE_PRESETS.indexOf(usd)
  return {
    coinId,
    side: 'buy',
    mode: 'usd',
    usd,
    qty: price > 0 ? usd / price : 0,
    fraction: 0,
    presetIdx: idx >= 0 ? idx : 1,
  }
}

function newSellDraft(coinId: CoinId, fraction = 1): TradeDraft {
  const pos = state.portfolio.positions[coinId]
  return {
    coinId,
    side: 'sell',
    mode: 'fraction',
    usd: 0,
    qty: pos ? pos.qty * fraction : 0,
    fraction,
    presetIdx: 0,
  }
}

function cycleTradePreset() {
  const t = state.trade
  if (!t) return
  if (t.side === 'buy') {
    t.presetIdx = (t.presetIdx + 1) % TRADE_PRESETS.length
    t.usd = TRADE_PRESETS[t.presetIdx]
    const price = priceOf(t.coinId)
    t.qty = price > 0 ? t.usd / price : 0
  } else {
    t.presetIdx = (t.presetIdx + 1) % SELL_FRACTIONS.length
    t.fraction = SELL_FRACTIONS[t.presetIdx]
    const pos = state.portfolio.positions[t.coinId]
    t.qty = pos ? pos.qty * t.fraction : 0
  }
  render()
}

async function confirmTrade() {
  const t = state.trade
  if (!t) return
  const price = priceOf(t.coinId)
  if (!(price > 0)) {
    setStatusLine('No price yet — wait for refresh')
    render()
    return
  }
  let qty = t.qty
  if (t.mode === 'usd') qty = t.usd / price
  else if (t.mode === 'fraction') qty = (state.portfolio.positions[t.coinId]?.qty ?? 0) * t.fraction
  const res = t.side === 'buy' ? buy(state.portfolio, t.coinId, qty, price) : sell(state.portfolio, t.coinId, qty, price)
  if (!res.ok) {
    setStatusLine(res.message)
    render()
    return
  }
  await savePortfolio(storage, state.portfolio)
  state.tradeMsg = res.message
  state.trade = null
  go('tradeDone')
}

async function doReset() {
  state.portfolio = freshPortfolio()
  await savePortfolio(storage, state.portfolio)
  state.tradeMsg = null
  setStatusLine('Paper reset — cash $10,000')
  go('portfolio')
}

// --- commands (voice transcript or typed input — same path) -----------------

function applyCommand(cmd: Command) {
  switch (cmd.kind) {
    case 'price':
      state.selectedCoin = cmd.coin
      go('asset')
      break
    case 'buy': {
      const price = priceOf(cmd.coin)
      const draft = newBuyDraft(cmd.coin, cmd.usd ?? (cmd.qty && price > 0 ? Math.round(cmd.qty * price) : 500))
      if (cmd.qty && !cmd.usd) {
        draft.mode = 'qty'
        draft.qty = cmd.qty
      }
      state.trade = draft
      go('trade')
      break
    }
    case 'sell': {
      const pos = state.portfolio.positions[cmd.coin]
      if (!pos) {
        setStatusLine(`No position — hold 0 ${cmd.coin.toUpperCase()}`)
        render()
        break
      }
      const price = priceOf(cmd.coin)
      const draft = newSellDraft(cmd.coin, cmd.fraction ?? 1)
      if (cmd.qty) {
        draft.mode = 'qty'
        draft.qty = Math.min(cmd.qty, pos.qty)
      } else if (cmd.usd && price > 0) {
        draft.mode = 'qty'
        draft.qty = Math.min(cmd.usd / price, pos.qty)
      }
      state.trade = draft
      go('trade')
      break
    }
    case 'portfolio':
      go('portfolio')
      break
    case 'alert': {
      const a: Alert = {
        id: `a-${cmd.coin}-${cmd.dir}-${cmd.threshold}`,
        coin: cmd.coin,
        dir: cmd.dir,
        threshold: cmd.threshold,
        enabled: true,
        fired: false,
      }
      state.alerts = state.alerts.filter((x) => x.id !== a.id)
      state.alerts.push(a)
      void saveAlerts()
      go('alerts')
      setStatusLine(`Alert set: ${alertLabel(a)}`)
      render()
      break
    }
    case 'odds':
      go('odds')
      void refreshOdds()
      break
    case 'unknown':
      setStatusLine(`Didn't catch that — ${cmd.hint}`)
      render()
      break
  }
}

// --- voice capture ---------------------------------------------------------

async function startCapture() {
  if (state.voice === 'listening' || state.voice === 'processing') return
  sttSession = createSttSession()
  if (bridge) {
    try {
      await bridge.audioControl(true, AudioInputSource.Glasses)
    } catch {
      // Mic unavailable in the simulator — capture stays empty and the
      // session closes silently; typed commands remain the demo path.
    }
  }
  state.voice = 'listening'
  setVoiceChip('listening')
  setMicButton(true)
  setStatusLine('Listening… speak now')
  captureTimer = window.setTimeout(() => void stopCaptureAndTranscribe(), 15_000)
  render()
}

async function stopCaptureAndTranscribe() {
  if (captureTimer !== null) {
    window.clearTimeout(captureTimer)
    captureTimer = null
  }
  if (bridge) {
    try {
      await bridge.audioControl(false)
    } catch {
      // ignore — mic already off
    }
  }
  const session = sttSession
  sttSession = null
  setMicButton(false)
  if (!session || session.samples < 800) {
    // <50 ms of audio: accidental tap, not speech.
    session?.close()
    state.voice = 'off'
    setVoiceChip('off')
    setStatusLine(null)
    render()
    return
  }
  state.voice = 'processing'
  setVoiceChip('processing')
  setStatusLine('Transcribing…')
  render()
  try {
    const text = await session.finish()
    state.voice = 'off'
    setVoiceChip('ready')
    if (!text.trim()) {
      setStatusLine("Didn't catch that — try 'buy 0.01 bitcoin'")
      render()
      return
    }
    setStatusLine(null)
    applyCommand(parseCommand(text))
  } catch (err) {
    if (err instanceof SttError && err.code === 'insufficient_quota') {
      state.voice = 'needs-credits'
      setVoiceChip('needs-credits')
    } else if (err instanceof SttError && err.code === 'not_configured') {
      state.voice = 'off'
      setVoiceChip('off')
    } else {
      state.voice = 'unavailable'
      setVoiceChip('unavailable')
    }
    setStatusLine(err instanceof Error ? err.message : 'Voice failed — type a command instead.')
    render()
  }
}

// --- input handling --------------------------------------------------------

// Reads the event type out of one envelope. CLICK_EVENT is 0, and protobuf
// omits zero-value fields on the wire, so a single tap arrives as an
// envelope whose `eventType` is `undefined`. The default has to be resolved
// INSIDE the envelope check. Writing `event.sysEvent?.eventType ??
// OsEventTypeList.CLICK_EVENT` instead would read CLICK on events that
// carry no `sysEvent` at all — and that means every incoming audio frame
// would fire the tap handler.
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

function onClick() {
  switch (state.screen) {
    case 'banner':
      state.screen = state.prevScreen
      state.bannerText = null
      render()
      break
    case 'watchlist': {
      const row = state.focus
      if (row < COINS.length) {
        state.selectedCoin = COINS[row].id
        go('asset')
      } else {
        const target = MENU_ROWS[row - COINS.length]?.target
        if (target === 'odds') {
          go('odds')
          void refreshOdds()
        } else if (target) {
          go(target as ScreenId)
        }
      }
      break
    }
    case 'asset':
      state.trade = newBuyDraft(state.selectedCoin)
      go('trade')
      break
    case 'trade':
      void confirmTrade()
      break
    case 'tradeDone':
      go('portfolio')
      break
    case 'portfolio':
      go('watchlist')
      break
    case 'alerts': {
      const a = state.alerts[state.focus]
      if (a) {
        a.enabled = !a.enabled
        a.fired = false
        void saveAlerts()
        render()
      }
      break
    }
    case 'odds':
      void refreshOdds()
      break
    case 'confirmReset':
      void doReset()
      break
    default:
      break
  }
}

function onDoubleClick() {
  if (state.screen === 'watchlist') {
    // Root: system exit-confirmation dialog (mode 1 is REQUIRED — silent
    // exit is rejected in QA). The user confirms on the glasses.
    if (bridge) void bridge.shutDownPageContainer(1)
    return
  }
  back()
}

function onLongPress() {
  if (state.screen === 'watchlist') {
    // Hands-free voice trigger on the glasses (mic button on the phone
    // does the same). Second long-press while listening stops + sends.
    if (state.voice === 'listening') void stopCaptureAndTranscribe()
    else void startCapture()
    return
  }
  if (state.screen === 'portfolio') {
    go('confirmReset')
  }
}

function onScroll(dir: -1 | 1) {
  if (state.screen === 'watchlist') {
    const rows = COINS.length + MENU_ROWS.length
    state.focus = (state.focus + dir + rows) % rows
    render()
    return
  }
  if (state.screen === 'alerts' && state.alerts.length > 0) {
    state.focus = (state.focus + dir + state.alerts.length) % state.alerts.length
    render()
    return
  }
  if (state.screen === 'trade') {
    cycleTradePreset()
  }
}

function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  if (captureTimer !== null) window.clearTimeout(captureTimer)
  if (priceTimer !== null) window.clearInterval(priceTimer)
  sttSession?.close()
  sttSession = null
  if (bridge) {
    void bridge.audioControl(false).catch(() => undefined)
  }
  unsubscribe?.()
}

// --- boot ------------------------------------------------------------------

mountUi({
  onCommand: (text) => {
    setCommandHint(`Heard: "${text}"`)
    applyCommand(parseCommand(text))
  },
  onMicToggle: () => {
    if (state.voice === 'listening') void stopCaptureAndTranscribe()
    else void startCapture()
  },
  onRefresh: () => {
    void refreshPrices()
    void refreshOdds()
  },
  onResetRequest: () => {
    // Two-step arm on the phone (the glasses confirm with a tap on S4's
    // long-press screen instead). Second press within 5 s confirms.
    if (Date.now() < resetArmedUntil) {
      resetArmedUntil = 0
      void doReset()
      return
    }
    resetArmedUntil = Date.now() + 5_000
    go('confirmReset')
    setCommandHint('Reset armed — press Reset paper again within 5 s to confirm.')
  },
})

async function boot() {
  bridge = await waitBridge(3_000)
  if (!bridge) {
    // Plain browser (dev / demo video capture): the phone UI is fully
    // functional; glasses rendering is skipped, never a blank screen.
    browserMode = true
    setCommandHint('Browser mode — no glasses bridge; phone UI fully works. Run in the simulator for glasses.')
  } else {
    storage = sdkStorage(bridge)
  }
  state.portfolio = await loadPortfolio(storage)
  state.alerts = await loadAlerts(storage)

  if (bridge) {
    const container = new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      borderWidth: 0,
      borderColor: 5,
      paddingLength: 4,
      containerID: 1,
      containerName: 'main',
      content: 'GlanceTrade — loading prices…',
      isEventCapture: 1,
    })
    const created = await bridge
      .createStartUpPageContainer(new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [container] }))
      .catch(() => -1)
    if (created !== 0) {
      setStatusLine('Glasses container failed — phone UI still works')
    }

    unsubscribe = bridge.onEvenHubEvent((event) => {
      const pcm = event.audioEvent?.audioPcm
      if (pcm && sttSession) sttSession.sendPcm(pcm)

      const sysType = eventTypeOf(event.sysEvent)
      const textType = eventTypeOf(event.textEvent)

      // Explicit ids first, CLICK last. Double-tap is checked on both
      // envelopes because it can arrive on either.
      if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        onDoubleClick()
        return
      }
      if (sysType === OsEventTypeList.LONG_PRESS_EVENT || textType === OsEventTypeList.LONG_PRESS_EVENT) {
        onLongPress()
        return
      }
      if (sysType === OsEventTypeList.LONG_PRESS_RELEASE_EVENT || textType === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) {
        return
      }
      if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
        onScroll(-1)
        return
      }
      if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
        onScroll(1)
        return
      }
      if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
        onClick()
        return
      }
      if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
        cleanup()
      }
    })
  }

  render()
  await refreshPrices()
  await refreshOdds()
  await probeVoice()
  priceTimer = window.setInterval(() => void refreshPrices(), PRICE_POLL_MS)
  window.addEventListener('beforeunload', cleanup)
}

void boot()
