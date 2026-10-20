import { createServer } from 'node:http'
import { draftClaim, claimComplete } from './claim.js'

const page = `<!doctype html><title>Claims</title><form id="f"><input id="amount" value="30"><select id="category"><option>meals</option><option>per-diem</option></select><button>Check</button></form><p id="out"></p>
<script>document.getElementById('f').onsubmit = async (e) => { e.preventDefault(); const r = await fetch('/claims', { method: 'POST', body: JSON.stringify({ employee: 'e1', lines: [{ amount: Number(amount.value), category: category.value }] }) }); out.textContent = (await r.json()).complete ? 'complete' : 'incomplete' }</script>`

export const server = createServer((req, res) => {
  if (req.method === 'GET') return res.end(page)
  let body = ''
  req.on('data', (c) => (body += c)).on('end', () => {
    const { employee, lines } = JSON.parse(body)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ complete: claimComplete(draftClaim(employee, lines)) }))
  })
})
if (process.argv[2]) server.listen(Number(process.argv[2]))
