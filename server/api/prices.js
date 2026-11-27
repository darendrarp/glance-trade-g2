// Vercel serverless function: GET /api/prices?ids=bitcoin,ethereum,solana
import { CORS, handlePrices } from './_lib.js'

export default async function handler(req, res) {
  const url = new URL(req.url ?? '/api/prices', 'http://localhost')
  const r = await handlePrices(url.searchParams)
  res.writeHead(r.status, { ...CORS, ...r.headers })
  res.end(r.body)
}
