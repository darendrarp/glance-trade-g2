// Paper-trading engine — virtual money only, no wallet, no real orders.
// State: $10,000 virtual cash, positions keyed by coin id, fills at the
// latest cached price. Persisted via the SDK local storage (phone), with a
// window.localStorage fallback for plain-browser dev.

export interface Position {
  qty: number
  avgCost: number
}

export interface Portfolio {
  cash: number
  positions: Record<string, Position>
  trades: number // session trade count
}

export const STARTING_CASH = 10_000
export const PORTFOLIO_KEY = 'glancetrade:portfolio:v1'

export function freshPortfolio(): Portfolio {
  return { cash: STARTING_CASH, positions: {}, trades: 0 }
}

export function portfolioValue(p: Portfolio, prices: Map<string, number>): number {
  let total = p.cash
  for (const [id, pos] of Object.entries(p.positions)) {
    const price = prices.get(id)
    if (price !== undefined) total += pos.qty * price
  }
  return total
}

export function investedValue(p: Portfolio, prices: Map<string, number>): number {
  let total = 0
  for (const [id, pos] of Object.entries(p.positions)) {
    const price = prices.get(id)
    if (price !== undefined) total += pos.qty * price
  }
  return total
}

export function sessionPnl(p: Portfolio, prices: Map<string, number>): number {
  return portfolioValue(p, prices) - STARTING_CASH
}

export interface FillResult {
  ok: boolean
  message: string
}

/** Buy `qty` of coin at `price`. Fills at the shown price, no fees. */
export function buy(p: Portfolio, coinId: string, qty: number, price: number): FillResult {
  if (!(qty > 0) || !(price > 0)) return { ok: false, message: 'Bad size or price' }
  const cost = qty * price
  if (cost > p.cash) return { ok: false, message: `Need $${cost.toFixed(2)} — cash $${p.cash.toFixed(2)}` }
  const pos = p.positions[coinId] ?? { qty: 0, avgCost: 0 }
  const newQty = pos.qty + qty
  pos.avgCost = newQty > 0 ? (pos.qty * pos.avgCost + cost) / newQty : price
  pos.qty = newQty
  p.positions[coinId] = pos
  p.cash -= cost
  p.trades += 1
  return { ok: true, message: `Bought ${qty.toFixed(4)} ${coinId} @ $${price.toFixed(2)}` }
}

/** Sell `qty` of coin at `price`. */
export function sell(p: Portfolio, coinId: string, qty: number, price: number): FillResult {
  if (!(qty > 0) || !(price > 0)) return { ok: false, message: 'Bad size or price' }
  const pos = p.positions[coinId]
  if (!pos || pos.qty < qty - 1e-9) {
    return { ok: false, message: `No position — hold ${(pos?.qty ?? 0).toFixed(4)} ${coinId}` }
  }
  pos.qty -= qty
  if (pos.qty <= 1e-9) delete p.positions[coinId]
  p.cash += qty * price
  p.trades += 1
  return { ok: true, message: `Sold ${qty.toFixed(4)} ${coinId} @ $${price.toFixed(2)}` }
}

// --- persistence ------------------------------------------------------------

export interface Storage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

export function windowStorage(): Storage {
  return {
    async get(key) {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    },
    async set(key, value) {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // storage unavailable — portfolio lives in memory this session
      }
    },
  }
}

export async function loadPortfolio(storage: Storage): Promise<Portfolio> {
  try {
    const raw = await storage.get(PORTFOLIO_KEY)
    if (!raw) return freshPortfolio()
    const parsed = JSON.parse(raw) as Portfolio
    if (typeof parsed.cash !== 'number' || !parsed.positions) return freshPortfolio()
    return { cash: parsed.cash, positions: parsed.positions, trades: parsed.trades ?? 0 }
  } catch {
    return freshPortfolio()
  }
}

export async function savePortfolio(storage: Storage, p: Portfolio): Promise<void> {
  await storage.set(PORTFOLIO_KEY, JSON.stringify(p))
}
