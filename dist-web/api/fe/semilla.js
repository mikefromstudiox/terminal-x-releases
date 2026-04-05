/**
 * GET /fe/autenticacion/api/semilla
 * Returns an unsigned XML seed for DGII to sign and send back.
 */
import crypto from 'crypto'

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const randomValue = crypto.randomBytes(128).toString('base64')
  const date = new Date()
  const offset = -4
  const localDate = new Date(date.getTime() + offset * 3600 * 1000)
  const formattedDate = localDate.toISOString().replace('Z', '-04:00')

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<SemillaModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <valor>${randomValue}</valor>
    <fecha>${formattedDate}</fecha>
</SemillaModel>`

  res.setHeader('Content-Type', 'application/xml')
  res.status(200).send(xml)
}
