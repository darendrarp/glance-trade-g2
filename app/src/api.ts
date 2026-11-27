// Backend client — all glasses data flows through our own server.
// Never ships keys; the backend holds the upstream keys (if any).
// Every failure returns a typed error the UI turns into a one-line message.

export interface Price {
  id: string
  symbol: string
  price: number
  change24h: number | null
  high24h: number | null
  low24h: number | null
}

export interface PricesResult {
  prices: Price[]
  cachedAt: number
  stale: boolean
  note?: string
}

export interface OddsMarket {
  question: string
  yesPrice: number | null
  volume24h: number
}

export interface OddsResult {
  markets: OddsMarket[]
  cachedAt: number
  stale: boolean
  note?: string
}

export const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:3001'

export const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'BITCOIN', qtyDecimals: 4 },
  { id: 'ethereum', symbol: 'ETH', name: 'ETHEREUM', qtyDecimals: 4 },
  { id: 'solana', symbol: 'SOL', name: 'SOLANA', qtyDecimals: 2 },
] as const

export type CoinId = (typeof COINS)[number]['id']

export function coinById(id: string) {
  return COINS.find((c) => c.id === id)
}

export function coinBySymbolOrName(token: string) {
  const t = token.toLowerCase()
  return COINS.find(
    (c) => c.symbol.toLowerCase() === t || c.name.toLowerCase() === t || c.id === t,
  )
}

async function fetchJson(path: string, init?: RequestInit, timeoutMs = 15_000): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, { ...init, signal: ctrl.signal })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error((body as { message?: string }).message ?? `backend ${res.status}`)
      ;(err as { status?: number }).status = res.status
      // Prefer the backend's machine-readable code (e.g. insufficient_quota)
      // so the UI can tell "no credits" apart from a generic STT failure.
      ;(err as { code?: string }).code =
        (body as { code?: string }).code ?? (body as { error?: string }).error ?? 'backend_error'
      throw err
    }
    return body
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('backend timeout')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchPrices(ids: string[] = COINS.map((c) => c.id)): Promise<PricesResult> {
  const data = (await fetchJson(`/api/prices?ids=${ids.join(',')}`)) as PricesResult
  return data
}

export async function fetchOdds(): Promise<OddsResult> {
  return (await fetchJson('/api/odds')) as OddsResult
}

export async function transcribeAudio(wav: Blob): Promise<string> {
  const data = (await fetchJson('/api/stt', { method: 'POST', body: wav }, 30_000)) as { text: string }
  return data.text ?? ''
}

export function formatPrice(price: number): string {
  return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatChange(change24h: number | null): string {
  if (change24h === null || change24h === undefined || Number.isNaN(change24h)) return 'n/a'
  return `${change24h >= 0 ? '+' : ''}${change24h.toFixed(1)}%`
}

export function formatUsd(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}
