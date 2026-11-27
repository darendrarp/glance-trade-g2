// Price alerts — evaluated client-side while the app is open (the
// platform cannot pop up alerts when the app is not on screen; the
// optional Telegram relay is the out-of-app path).
// Edge-triggered: an alert fires once per crossing and re-arms when the
// condition stops holding.

import type { CoinId } from './api'

export interface Alert {
  id: string
  coin: CoinId
  dir: 'above' | 'below' | 'change'
  threshold: number // price for above/below; % for change (e.g. 10 = +10% 24h)
  enabled: boolean
  fired: boolean
}

export const ALERTS_KEY = 'glancetrade:alerts:v1'

export function defaultAlerts(): Alert[] {
  return [
    { id: 'a-btc-100k', coin: 'bitcoin', dir: 'above', threshold: 100_000, enabled: true, fired: false },
    { id: 'a-eth-3k', coin: 'ethereum', dir: 'below', threshold: 3_000, enabled: true, fired: false },
    { id: 'a-sol-10', coin: 'solana', dir: 'change', threshold: 10, enabled: false, fired: false },
  ]
}

export function alertLabel(a: Alert): string {
  const sym = a.coin === 'bitcoin' ? 'BTC' : a.coin === 'ethereum' ? 'ETH' : 'SOL'
  if (a.dir === 'above') return `${sym} > $${a.threshold.toLocaleString('en-US')}`
  if (a.dir === 'below') return `${sym} < $${a.threshold.toLocaleString('en-US')}`
  return `${sym} +${a.threshold}% 24h`
}

/** Returns the alerts that fire on this price snapshot. */
export function evaluateAlerts(
  alerts: Alert[],
  prices: Map<string, { price: number; change24h: number | null }>,
): Alert[] {
  const fired: Alert[] = []
  for (const a of alerts) {
    if (!a.enabled) continue
    const p = prices.get(a.coin)
    if (!p) continue
    let holding = false
    if (a.dir === 'above') holding = p.price > a.threshold
    else if (a.dir === 'below') holding = p.price < a.threshold
    else if (a.dir === 'change') holding = (p.change24h ?? 0) >= a.threshold
    if (holding && !a.fired) {
      a.fired = true
      fired.push(a)
    } else if (!holding) {
      a.fired = false // re-arm when the condition clears
    }
  }
  return fired
}

export function firedMessage(a: Alert, price: number): string {
  const sym = a.coin === 'bitcoin' ? 'BTC' : a.coin === 'ethereum' ? 'ETH' : 'SOL'
  return `ALERT ${sym} ${a.dir === 'above' ? '>' : a.dir === 'below' ? '<' : '+'} $${a.threshold.toLocaleString('en-US')} — now $${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}
