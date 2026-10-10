// persimmon.adapter/v1 stdio Adapter for tests. Reads one request line, answers per op.
import { request } from 'node:http'
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
      if (process.env.FAKE_MODE === 'publish') return publish(req)
      out({ id: req.id, event: 'log', text: 'working' })
      out({ id: req.id, event: 'waiting', reason: 'thinking' })
      return out({ id: req.id, ok: true, result: { echo: req.payload, env: { token: process.env.PERSIMMON_ADAPTER_TOKEN ?? null, cred: process.env.ANTHROPIC_API_KEY ?? null, leaked: process.env.PERSIMMON_CRED_LEAK_TEST ?? null, ...(process.env.FAKE_ECHO_FLAG ? { flag: process.env.PERSIMMON_ADAPTER_CONFORMANCE ?? null } : {}) } } })
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

// publish mode: for every artifact output, putBlob + publishArtifact through the Engine callbacks, then a TaskResult.
async function publish(req) {
  const { engine, task, taskRun } = req.payload
  const call = (name, args) =>
    new Promise((resolve, reject) => {
      const r = request({ socketPath: engine.endpoint.replace(/^unix:\/\//, ''), path: `/callbacks/${name}`, method: 'POST', headers: { authorization: `Bearer ${engine.token}`, 'content-type': 'application/json' } }, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          const body = JSON.parse(data)
          body.error ? reject(new Error(`${name}: ${body.error.message}`)) : resolve(body.result)
        })
      })
      r.on('error', reject)
      r.end(JSON.stringify(args))
    })
  const outputs = {}
  try {
    for (const [port, spec] of Object.entries(task.outputs)) {
      if (spec.type.kind !== 'artifact') {
        outputs[port] = { kind: 'value', value: JSON.parse(process.env.FAKE_VALUES ?? '{}')[port] ?? null }
        continue
      }
      const kind = spec.type.artifactKind
      const content = contentFor(kind.kind, taskRun)
      const blob = await call('putBlob', { bytes: Buffer.from(JSON.stringify(content)).toString('base64'), mediaType: 'application/json' })
      const ref = await call('publishArtifact', { kind, id: `${taskRun.logicalExecutionId.split('/').pop()}-${kind.kind.toLowerCase()}`, content, representations: [{ name: 'json', mediaType: 'application/json', digest: blob.digest }] })
      outputs[port] = { kind: 'artifact', ref }
    }
    await call('log', { text: `published ${Object.keys(outputs).length} artifact(s)` })
    out({ id: req.id, ok: true, result: { protocol: 'persimmon.result/v1', outputs, summary: 'fake agent done' } })
  } catch (e) {
    out({ id: req.id, ok: false, error: { code: 'transient_network', message: e.message, retryable: false } })
  }
}

function contentFor(kind, taskRun) {
  switch (kind) {
    case 'ResearchReport':
      return { title: `Research for ${taskRun.logicalExecutionId}`, findings: [{ id: 'F1', statement: 'Checkout has three steps.', sources: ['https://example.com/analytics'] }] }
    case 'ProductRequirement':
      return { title: 'Checkout v2', problem: 'Cart abandonment at payment step is 38%.', requirements: [{ id: 'R1', statement: 'One-page checkout.' }, { id: 'R2', statement: 'Inline payment errors.' }] }
    case 'ReviewReport':
      return { subject: 'Checkout v2', verdict: 'approve', findings: [] }
    default:
      return { title: process.env.FAKE_TITLE ?? kind }
  }
}
