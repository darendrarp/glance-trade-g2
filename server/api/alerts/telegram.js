// Vercel serverless function: POST /api/alerts/telegram
// Disabled by default (503) until TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
// are set on the project. See ../api/_lib.js for the forwarder.
import { CORS, handleTelegram, json, readBody } from '../_lib.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end('')
    return
  }
  let r
  try {
    const raw = await readBody(req, 64 * 1024)
    let body = {}
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      r = json(400, { error: 'bad_request', message: 'invalid JSON body' })
    }
    if (!r) r = await handleTelegram(body)
  } catch (err) {
    r = err.status === 413
      ? json(413, { error: 'too_large', message: 'body exceeds 64 KB' })
      : json(500, { error: 'internal', message: String(err?.message ?? err) })
  }
  res.writeHead(r.status, { ...CORS, ...r.headers })
  res.end(r.body)
}
