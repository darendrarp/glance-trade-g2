// Vercel serverless function: GET /api/health
import { CORS, handleHealth } from './_lib.js'

export default async function handler(req, res) {
  const r = handleHealth()
  res.writeHead(r.status, { ...CORS, ...r.headers })
  res.end(r.body)
}
