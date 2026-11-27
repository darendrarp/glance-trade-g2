// Local server smoke test — starts server.js on a scratch port and hits
// every endpoint. No keys in env, so STT + relay must answer 503.
// Run: node test/smoke.mjs (from server/)
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const PORT = 3199
const BASE = `http://127.0.0.1:${PORT}`

const server = spawn('node', ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), GROQ_API_KEY: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' },
  stdio: 'ignore',
})

async function waitUp(tries = 30) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('server did not come up')
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`)
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

async function post(path, body, ctype = 'application/json') {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': ctype },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

let code = 0
try {
  await waitUp()
  console.log('ok: server up on', PORT)

  let r = await get('/api/health')
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.sttConfigured, false)
  assert.equal(r.body.relayConfigured, false)
  console.log('ok: /api/health (stt + relay unconfigured)')

  r = await get('/api/prices?ids=bitcoin,ethereum,solana')
  assert.equal(r.status, 200)
  assert.equal(r.body.prices.length, 3)
  assert.ok(r.body.prices.every((p) => p.price > 0))
  console.log('ok: /api/prices live —', r.body.prices.map((p) => `${p.symbol} $${p.price}`).join(', '))

  r = await get('/api/odds')
  assert.equal(r.status, 200)
  assert.ok(Array.isArray(r.body.markets))
  console.log(`ok: /api/odds live — ${r.body.markets.length} markets`)

  r = await post('/api/stt', Buffer.from('x'.repeat(200)), 'audio/wav')
  assert.equal(r.status, 503)
  assert.equal(r.body.error, 'not_configured')
  console.log('ok: /api/stt 503 not_configured without key')

  r = await post('/api/alerts/telegram', { text: 'ALERT BTC > $100,000' })
  assert.equal(r.status, 503)
  assert.equal(r.body.error, 'disabled')
  console.log('ok: /api/alerts/telegram 503 disabled without env')

  r = await get('/api/nope')
  assert.equal(r.status, 404)
  console.log('ok: unknown route 404')

  console.log('smoke: all checks pass')
} catch (err) {
  console.error('smoke FAILED:', err.message)
  code = 1
} finally {
  server.kill('SIGTERM')
  setTimeout(() => server.kill('SIGKILL'), 2000)
}
process.exit(code)
