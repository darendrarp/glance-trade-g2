// Vercel serverless function: POST /api/stt (Groq Whisper)
import { CORS, handleStt, json, readBody } from './_lib.js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end('')
    return
  }
  let r
  try {
    const audio = await readBody(req)
    r = await handleStt({ contentType: req.headers['content-type'], audio })
  } catch (err) {
    r = err.status === 413
      ? json(413, { error: 'too_large', message: 'audio exceeds 5 MB' })
      : json(500, { error: 'internal', message: String(err?.message ?? err) })
  }
  res.writeHead(r.status, { ...CORS, ...r.headers })
  res.end(r.body)
}
