// Glasses screen renderers — pure functions, one screen -> one string.
// Constraints (docs/DESIGN.md): 576x288, ~27 px line height -> max ~9-10
// lines per screen, short labels, no styling (one text container).
// Every screen ends with a one-line footer (action hint or status/error).

import { formatChange, formatPrice, formatUsd, type OddsMarket, type Price } from './api'
import { investedValue, sessionPnl, type Portfolio } from './engine'
import { alertLabel, type Alert } from './alerts'

export type ScreenId =
  | 'watchlist'
  | 'asset'
  | 'trade'
  | 'tradeDone'
  | 'portfolio'
  | 'alerts'
  | 'odds'
  | 'confirmReset'
  | 'banner'

export interface TradeDraft {
  coinId: string
  side: 'buy' | 'sell'
  mode: 'usd' | 'qty' | 'fraction'
  usd: number
  qty: number
  fraction: number
  presetIdx: number
}

export interface ScreenCtx {
  screen: ScreenId
  focus: number
  prices: Price[]
  pricesAgeSec: number | null // seconds since backend cachedAt; null = never loaded
  pricesStale: boolean
  offline: boolean
  odds: OddsMarket[]
  oddsAvailable: boolean
  portfolio: Portfolio
  alerts: Alert[]
  trade: TradeDraft | null
  tradeMsg: string | null // result line after a confirmed trade
  bannerText: string | null
  errorLine: string | null // one-line status/error shown on the current screen
  voiceNote: string | null // e.g. "Voice off — tap to trade"
  menuRows: { label: string; target: ScreenId | string }[]
}

const MAX_LINES = 9

function fit(lines: string[]): string {
  return lines.slice(0, MAX_LINES).join('\n')
}

function focusMark(i: number, focus: number): string {
  return i === focus ? '> ' : '  '
}

function ageLine(ctx: ScreenCtx): string {
  if (ctx.offline) return 'OFFLINE — last prices shown'
  if (ctx.pricesAgeSec === null) return 'Loading prices…'
  if (ctx.pricesStale) return `Cached ${ctx.pricesAgeSec}s ago (stale)`
  return `Live · cached ${ctx.pricesAgeSec}s ago`
}

export const TRADE_PRESETS = [100, 500, 1000]

export function renderWatchlist(ctx: ScreenCtx): string {
  const lines: string[] = ['GLANCETRADE — PAPER']
  ctx.prices.forEach((p, i) => {
    const mark = focusMark(i, ctx.focus)
    lines.push(`${mark}${p.symbol}  ${formatPrice(p.price)}  ${formatChange(p.change24h)}`)
  })
  ctx.menuRows.forEach((row, j) => {
    const i = ctx.prices.length + j
    lines.push(`${focusMark(i, ctx.focus)}${row.label}`)
  })
  // 9-line cap: the separator had to go — the age line is functional
  // (freshness/offline state) and the hint line carries the gesture help.
  lines.push(ageLine(ctx))
  if (ctx.errorLine) lines.push(ctx.errorLine)
  else lines.push('Tap: open · Swipe: move')
  return fit(lines)
}

export function renderAsset(ctx: ScreenCtx, coinId: string): string {
  const p = ctx.prices.find((x) => x.id === coinId)
  const pos = ctx.portfolio.positions[coinId]
  const lines: string[] = []
  if (!p) {
    lines.push(coinId.toUpperCase())
    lines.push('No price yet')
    lines.push('Tap: back')
    return fit(lines)
  }
  const value = pos ? pos.qty * p.price : 0
  const pnl = pos ? pos.qty * (p.price - pos.avgCost) : 0
  lines.push(`${p.symbol} — ${coinId.toUpperCase()}`)
  lines.push(`${formatPrice(p.price)}  ${formatChange(p.change24h)}`)
  lines.push(`24h ${formatPrice(p.low24h ?? p.price)} – ${formatPrice(p.high24h ?? p.price)}`)
  lines.push('─────────────────')
  if (pos) {
    lines.push(`PAPER: ${pos.qty.toFixed(4)} ${p.symbol}`)
    lines.push(`Value ${formatUsd(value)}  PnL ${pnl >= 0 ? '+' : ''}${formatUsd(pnl)}`)
  } else {
    lines.push('PAPER: no position')
    lines.push(`Cash ${formatUsd(ctx.portfolio.cash)}`)
  }
  lines.push('─────────────────')
  lines.push('Tap: trade · Dbl-tap: back')
  if (ctx.errorLine) lines.push(ctx.errorLine)
  return fit(lines)
}

export function renderTrade(ctx: ScreenCtx): string {
  const t = ctx.trade
  if (!t) return 'No trade — tap: back'
  const p = ctx.prices.find((x) => x.id === t.coinId)
  const price = p?.price ?? 0
  const cost = t.mode === 'usd' ? t.usd : t.qty * price
  const lines: string[] = [
    `${t.side === 'buy' ? 'BUY' : 'SELL'} ${t.qty.toFixed(4)} ${t.coinId === 'bitcoin' ? 'BTC' : t.coinId === 'ethereum' ? 'ETH' : 'SOL'}`,
    `@ ${formatPrice(price)}`,
    `Cost ${formatUsd(cost)} (paper)`,
    `Cash left ${formatUsd(ctx.portfolio.cash - (t.side === 'buy' ? cost : -cost))}`,
    '─────────────────',
    `Amount: $${t.usd} — swipe to change`,
    'TAP = CONFIRM',
    'Dbl-tap = cancel',
  ]
  if (ctx.errorLine) lines.push(ctx.errorLine)
  return fit(lines)
}

export function renderTradeDone(ctx: ScreenCtx): string {
  const lines: string[] = ['TRADE DONE (paper)']
  if (ctx.tradeMsg) lines.push(ctx.tradeMsg)
  lines.push(`Cash ${formatUsd(ctx.portfolio.cash)}`)
  lines.push('─────────────────')
  lines.push('Tap: portfolio')
  lines.push('Dbl-tap: watchlist')
  return fit(lines)
}

export function renderPortfolio(ctx: ScreenCtx): string {
  const priceMap = new Map(ctx.prices.map((p) => [p.id, p.price]))
  const invested = investedValue(ctx.portfolio, priceMap)
  const pnl = sessionPnl(ctx.portfolio, priceMap)
  const lines: string[] = ['PORTFOLIO (paper)']
  lines.push(`Cash ${formatUsd(ctx.portfolio.cash)}  Invested ${formatUsd(invested)}`)
  lines.push(`Session PnL ${pnl >= 0 ? '+' : ''}${formatUsd(pnl)} (${pnl >= 0 ? '+' : ''}${((pnl / 10_000) * 100).toFixed(1)}%)`)
  lines.push('─────────────────')
  const entries = Object.entries(ctx.portfolio.positions)
  if (entries.length === 0) {
    lines.push('No positions yet')
    lines.push('Tap a coin to trade')
  } else {
    for (const [id, pos] of entries) {
      const price = priceMap.get(id) ?? 0
      const sym = id === 'bitcoin' ? 'BTC' : id === 'ethereum' ? 'ETH' : 'SOL'
      const value = pos.qty * price
      const coinPnl = pos.qty * (price - pos.avgCost)
      lines.push(`${sym} ${pos.qty.toFixed(4)}  ${formatUsd(value)}  ${coinPnl >= 0 ? '+' : ''}${formatUsd(coinPnl)}`)
    }
  }
  lines.push('─────────────────')
  lines.push('Long-press: reset paper')
  lines.push('Tap: watchlist')
  if (ctx.errorLine) lines.push(ctx.errorLine)
  return fit(lines)
}

export function renderAlerts(ctx: ScreenCtx): string {
  const lines: string[] = ['ALERTS']
  ctx.alerts.forEach((a, i) => {
    lines.push(`${focusMark(i, ctx.focus)}${alertLabel(a)}   ${a.enabled ? 'ON' : 'OFF'}`)
  })
  if (ctx.alerts.length === 0) lines.push('No alerts — say')
  lines.push('─────────────────')
  lines.push('Voice: "alert BTC above 100k"')
  lines.push('Tap: on/off · Dbl-tap: back')
  if (ctx.errorLine) lines.push(ctx.errorLine)
  return fit(lines)
}

export function renderOdds(ctx: ScreenCtx): string {
  const lines: string[] = ['POLYMARKET']
  if (!ctx.oddsAvailable || ctx.odds.length === 0) {
    lines.push('Odds unavailable')
    lines.push('Check connection,')
    lines.push('then tap refresh.')
  } else {
    for (const m of ctx.odds) {
      const pct = m.yesPrice === null ? 'n/a' : `${Math.round(m.yesPrice * 100)}%`
      const q = m.question.length > 40 ? m.question.slice(0, 37) + '…' : m.question
      lines.push(q)
      lines.push(`  YES ${pct}`)
    }
  }
  lines.push('─────────────────')
  lines.push('Read-only · Tap: refresh')
  lines.push('Dbl-tap: back')
  if (ctx.errorLine) lines.push(ctx.errorLine)
  return fit(lines)
}

export function renderConfirmReset(): string {
  return fit([
    'RESET PAPER?',
    'Cash back to $10,000',
    'Positions cleared',
    'Alerts kept',
    '─────────────────',
    'TAP = RESET',
    'Dbl-tap = cancel',
  ])
}

export function renderBanner(ctx: ScreenCtx): string {
  return fit([
    'ALERT FIRED',
    ...(ctx.bannerText ? [ctx.bannerText] : []),
    '─────────────────',
    'Tap: dismiss',
  ])
}
