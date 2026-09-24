// persimmon.adapter/v1 stdio Adapter for tests. Reads one request line, answers per op.
import { createInterface } from 'node:readline'

const roles = (process.env.FAKE_ROLES ?? 'executor').split(',')
const executorTypes = (process.env.FAKE_TYPES ?? 'agent,script').split(',')
const executor = roles.includes('executor')
  ? { executorTypes, configurationSchema: { type: 'object' }, parametersSchema: { type: 'object' }, contextKinds: ['file', 'artifact', 'prompt', 'skill'], skillFormats: ['claude-code-skill/v1'], supports: { query: false, cancel: true, complete: executorTypes.includes('human') }, formRenderable: false }
  : { configurationSchema: { type: 'object' } }
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')

createInterface({ input: process.stdin }).once('line', (line) => {
  const req = JSON.parse(line)
  switch (req.op) {
    case 'describe':
      return out({ id: req.id, ok: true, result: { adapterId: process.env.FAKE_ID ?? 'fake/v1', protocol: 'persimmon.adapter/v1', roles, ...executor } })
    case 'execute':
      out({ id: req.id, event: 'log', text: 'working' })
      out({ id: req.id, event: 'waiting', reason: 'thinking' })
      return out({ id: req.id, ok: true, result: { echo: req.payload, env: { token: process.env.PERSIMMON_ADAPTER_TOKEN ?? null, cred: process.env.ANTHROPIC_API_KEY ?? null } } })
    case 'fail':
      return out({ id: req.id, ok: false, error: { code: 'rate_limit', message: '429', retryable: true } })
    case 'hang':
      return setTimeout(() => {}, 60_000)
    case 'garbage':
      return process.stdout.write('not json\n')
    default:
      return process.exit(3)
  }
})
