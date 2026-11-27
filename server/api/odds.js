// Vercel serverless function: GET /api/odds
import { CORS, handleOdds } from './_lib.js'

export default async function handler(req, res) {
  const r = await handleOdds()
  res.writeHead(r.status, { ...CORS, ...r.headers })
  res.end(r.body)
}
