// Deterministic voice-command parser — no LLM in the hot path.
// Grammar (see docs/DESIGN.md §4):
//   "how much is bitcoin / solana?"        -> price query
//   "buy 0.01 bitcoin" / "buy $500 of eth" -> buy (qty or usd)
//   "sell half my bitcoin" / "sell all sol" -> sell (fraction / qty / usd)
//   "show my portfolio"                   -> portfolio
//   "alert me if btc goes above 100k"     -> alert (above/below threshold)
//   "what are the odds?"                   -> odds
// Ambiguous input -> { kind: 'unknown' } with a hint; the UI asks on
// screen and NEVER guesses a trade.

import { coinBySymbolOrName, type CoinId } from './api'

export type Command =
  | { kind: 'price'; coin: CoinId }
  | { kind: 'buy'; coin: CoinId; usd?: number; qty?: number }
  | { kind: 'sell'; coin: CoinId; usd?: number; qty?: number; fraction?: number }
  | { kind: 'portfolio' }
  | { kind: 'alert'; coin: CoinId; dir: 'above' | 'below'; threshold: number }
  | { kind: 'odds' }
  | { kind: 'unknown'; hint: string }

const HINT = "Try 'buy 0.01 bitcoin'"

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

function wordsToInt(words: string[]): number | null {
  if (words.length === 0) return null
  let total = 0
  let current = 0
  let seen = false
  for (const w of words) {
    if (w === 'and') continue
    if (w === 'hundred') {
      if (current === 0) return null
      current *= 100
      seen = true
      continue
    }
    const v = ONES[w] ?? TENS[w]
    if (v === undefined) return null
    current += v
    seen = true
  }
  if (!seen) return null
  return total + current
}

/** "zero point zero one" -> 0.01, "one point five" -> 1.5, "five" -> 5.
 *  Null unless every word is a number word. Whisper usually returns
 *  digits ("Buy 0.01 Bitcoin."), but word forms appear often enough that
 *  the parser should not fail on them. */
function wordsToNumber(s: string): number | null {
  const parts = s.trim().split(/\s+/)
  if (parts.length === 0) return null
  const pointAt = parts.indexOf('point')
  const intWords = pointAt === -1 ? parts : parts.slice(0, pointAt)
  const fracWords = pointAt === -1 ? [] : parts.slice(pointAt + 1)
  const whole = wordsToInt(intWords)
  if (whole === null) return null
  if (fracWords.length === 0) return whole
  let frac = ''
  for (const w of fracWords) {
    const d = ONES[w]
    if (d === undefined || d > 9) return null
    frac += String(d)
  }
  return Number(`${whole}.${frac}`)
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9.$% ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** "100k" -> 100000, "1.5m" -> 1500000, "500" -> 500. */
function parseNumberToken(token: string): number | null {
  const m = token.match(/^(\d+(?:\.\d+)?)([km]?)$/)
  if (!m) return null
  const n = Number(m[1])
  if (m[2] === 'k') return n * 1_000
  if (m[2] === 'm') return n * 1_000_000
  return n
}

function findCoin(text: string): CoinId | null {
  for (const alias of ['bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol']) {
    if (new RegExp(`\\b${alias}\\b`).test(text)) {
      return coinBySymbolOrName(alias)!.id
    }
  }
  return null
}

export function parseCommand(raw: string): Command {
  const text = normalize(raw)
  if (!text) return { kind: 'unknown', hint: HINT }

  // Odds — no coin needed.
  if (/\b(odds|polymarket)\b/.test(text)) return { kind: 'odds' }

  // Portfolio.
  if (/\bportfolio\b/.test(text)) return { kind: 'portfolio' }

  // Alert: "alert btc above 100k" / "alert me if eth goes below 3000".
  if (/\balert\b/.test(text)) {
    const coin = findCoin(text)
    const dir = /\babove\b/.test(text) ? 'above' : /\bbelow\b/.test(text) ? 'below' : null
    const num = text.match(/\$?\s*(\d+(?:\.\d+)?[km]?)\b/)
    const threshold = num ? parseNumberToken(num[1]) : null
    if (coin && dir && threshold !== null) return { kind: 'alert', coin, dir, threshold }
    return { kind: 'unknown', hint: "Try 'alert BTC above 100k'" }
  }

  // Price query: "how much is X" / "price of X" / "what is X worth".
  if (/\b(how much|price|worth|cost)\b/.test(text)) {
    const coin = findCoin(text)
    if (coin) return { kind: 'price', coin }
    return { kind: 'unknown', hint: "Try 'how much is bitcoin?'" }
  }

  // Buy / sell.
  const isBuy = /\bbuy\b/.test(text)
  const isSell = /\bsell\b/.test(text)
  if (isBuy || isSell) {
    const coin = findCoin(text)
    if (!coin) return { kind: 'unknown', hint: HINT }
    // Fraction: "sell half" / "sell all".
    if (isSell) {
      if (/\ball\b/.test(text)) return { kind: 'sell', coin, fraction: 1 }
      if (/\bhalf\b/.test(text)) return { kind: 'sell', coin, fraction: 0.5 }
      if (/\bquarter\b/.test(text)) return { kind: 'sell', coin, fraction: 0.25 }
    }
    // Dollar amount: "$500", "500 dollars", "buy $500 of eth".
    const usd = text.match(/\$\s*(\d+(?:\.\d+)?[km]?)\b/) ?? text.match(/\b(\d+(?:\.\d+)?[km]?)\s*dollars?\b/)
    if (usd) {
      const amount = parseNumberToken(usd[1])
      if (amount !== null && amount > 0) {
        return isBuy ? { kind: 'buy', coin, usd: amount } : { kind: 'sell', coin, usd: amount }
      }
    }
    // Coin quantity: "buy 0.01 bitcoin" — number directly before the coin name.
    const qty = text.match(/\b(\d+(?:\.\d+)?)\s*(?:bitcoin|btc|ethereum|eth|solana|sol)\b/)
    if (qty) {
      const amount = Number(qty[1])
      if (amount > 0) {
        return isBuy ? { kind: 'buy', coin, qty: amount } : { kind: 'sell', coin, qty: amount }
      }
    }
    // Spelled-out quantity: "buy zero point zero one bitcoin".
    const spelled = text.match(
      /\b((?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|point|and)(?:\s+(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|point|and))*)\s*(?:bitcoin|btc|ethereum|eth|solana|sol)\b/,
    )
    if (spelled) {
      const amount = wordsToNumber(spelled[1])
      if (amount !== null && amount > 0) {
        return isBuy ? { kind: 'buy', coin, qty: amount } : { kind: 'sell', coin, qty: amount }
      }
    }
    return { kind: 'unknown', hint: HINT }
  }

  return { kind: 'unknown', hint: HINT }
}
