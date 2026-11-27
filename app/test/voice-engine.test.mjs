// Unit tests for the voice-command parser (voice.ts) and paper engine
// (engine.ts). Pure logic, no bridge, no network — runs on plain Node.
//
// Run: npm test   (bundles the TS sources with esbuild, runs the asserts)
import { parseCommand } from '/tmp/gt-bundle.mjs'
import { buy, sell, freshPortfolio, sessionPnl } from '/tmp/gt-bundle.mjs'

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
let pass = 0
let fail = 0
function t(name, got, want) {
  if (eq(got, want)) {
    pass++
    console.log('PASS', name)
  } else {
    fail++
    console.log('FAIL', name, 'got', JSON.stringify(got), 'want', JSON.stringify(want))
  }
}

t('digits buy', parseCommand('Buy 0.01 Bitcoin.'), { kind: 'buy', coin: 'bitcoin', qty: 0.01 })
t('spelled buy', parseCommand('Buy zero point zero one bitcoin'), { kind: 'buy', coin: 'bitcoin', qty: 0.01 })
t('spelled 1.5', parseCommand('buy one point five solana'), { kind: 'buy', coin: 'solana', qty: 1.5 })
t('usd buy', parseCommand('buy $500 of eth'), { kind: 'buy', coin: 'ethereum', usd: 500 })
t('sell half', parseCommand('sell half my bitcoin'), { kind: 'sell', coin: 'bitcoin', fraction: 0.5 })
t('sell all', parseCommand('sell all sol'), { kind: 'sell', coin: 'solana', fraction: 1 })
t('price', parseCommand('how much is bitcoin?'), { kind: 'price', coin: 'bitcoin' })
t('portfolio', parseCommand('show my portfolio'), { kind: 'portfolio' })
t('alert', parseCommand('alert me if btc goes above 100k'), {
  kind: 'alert',
  coin: 'bitcoin',
  dir: 'above',
  threshold: 100000,
})
t('odds', parseCommand('what are the odds?'), { kind: 'odds' })
t('unknown', parseCommand('hello there').kind, 'unknown')
t('ambiguous buy no coin', parseCommand('buy 0.01').kind, 'unknown')

const p = freshPortfolio()
const r1 = buy(p, 'bitcoin', 0.01, 60000)
t('buy ok', r1.ok, true)
t('buy msg', r1.message, 'Bought 0.0100 bitcoin @ $60000.00')
t('cash after buy', p.cash, 9400)
const r2 = buy(p, 'bitcoin', 1, 60000)
t('buy over cash rejected', r2.ok, false)
const r3 = sell(p, 'bitcoin', 0.005, 61000)
t('sell ok', r3.ok, true)
t('cash after sell', Math.round(p.cash), 9705)
t('pnl', Math.round(sessionPnl(p, new Map([['bitcoin', 61000]]))), 10)

console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
