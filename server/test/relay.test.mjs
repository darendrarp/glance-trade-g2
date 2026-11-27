// Relay unit tests — no real network: global fetch is stubbed.
// Run: node test/relay.test.mjs (from server/)
import assert from 'node:assert/strict'
import { handleTelegram } from '../api/_lib.js'

const realFetch = globalThis.fetch
let calls = []

function stubFetch(response) {
  calls = []
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts })
    return {
      ok: response.ok,
      status: response.status ?? 200,
      json: async () => response.body ?? {},
    }
  }
}

function restoreFetch() {
  globalThis.fetch = realFetch
}

// 1. No env -> 503 disabled, no network call.
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.TELEGRAM_CHAT_ID
stubFetch({ ok: true })
let r = await handleTelegram({ text: 'ALERT BTC > $100,000' })
assert.equal(r.status, 503)
assert.equal(JSON.parse(r.body).error, 'disabled')
assert.equal(calls.length, 0)
console.log('ok 1: disabled without env, no network call')

// 2. Env set -> forwards to api.telegram.org with chat_id + text; token
//    never appears in the response body.
process.env.TELEGRAM_BOT_TOKEN = 'TESTTOKEN123'
process.env.TELEGRAM_CHAT_ID = '987654321'
stubFetch({ ok: true, body: { ok: true, result: { message_id: 7 } } })
r = await handleTelegram({ text: 'ALERT BTC > $100,000 — now $100,500.00' })
assert.equal(r.status, 200)
assert.equal(JSON.parse(r.body).ok, true)
assert.equal(calls.length, 1)
assert.equal(calls[0].url, 'https://api.telegram.org/botTESTTOKEN123/sendMessage')
const sent = JSON.parse(calls[0].opts.body)
assert.equal(sent.chat_id, '987654321')
assert.match(sent.text, /ALERT BTC/)
assert.ok(!r.body.includes('TESTTOKEN123'), 'token must not leak into the response')
console.log('ok 2: forwards to Telegram with chat_id + text, no token leak')

// 3. Telegram rejects (bad token / blocked bot) -> 502 relay_error with
//    the upstream description, token still not leaked.
stubFetch({ ok: false, status: 403, body: { ok: false, description: 'Forbidden: bot was blocked by the user' } })
r = await handleTelegram({ text: 'ALERT BTC > $100,000' })
assert.equal(r.status, 502)
const errBody = JSON.parse(r.body)
assert.equal(errBody.error, 'relay_error')
assert.match(errBody.message, /bot was blocked/)
assert.ok(!r.body.includes('TESTTOKEN123'))
console.log('ok 3: upstream rejection surfaces as 502 relay_error, no token leak')

// 4. Empty text -> 400, no network call.
stubFetch({ ok: true })
r = await handleTelegram({ text: '   ' })
assert.equal(r.status, 400)
assert.equal(calls.length, 0)
console.log('ok 4: empty text rejected with 400')

// 5. Long text is truncated to 500 chars before sending.
stubFetch({ ok: true, body: { ok: true } })
r = await handleTelegram({ text: 'x'.repeat(900) })
assert.equal(r.status, 200)
assert.equal(JSON.parse(calls[0].opts.body).text.length, 500)
console.log('ok 5: text truncated to 500 chars')

restoreFetch()
console.log('relay tests: 5/5 pass')
