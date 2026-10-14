// designmd/v1: the evaluator Role (19-adapter-roles.md) over a DesignSystem's DESIGN.md (32-ui-design-process.md).
// `evaluate` runs the official linter (`@google/design.md`) on `artifacts.designSystem.content.document.content` and
// answers a ValidationResult (10-ports.md): an error fails, a warning too when `configuration.failOnWarning`, an info
// passes through. No Engine callbacks. The only shipped Adapter with an npm dependency; nothing in src/ imports it.
import { createInterface } from 'node:readline'
import { lint } from '@google/design.md/linter'

const describe = {
  adapterId: 'designmd/v1',
  protocol: 'persimmon.adapter/v1',
  roles: ['evaluator'],
  configurationSchema: { type: 'object', additionalProperties: false, properties: { failOnWarning: { type: 'boolean' } } },
}

const invalid = (message) => Object.assign(new Error(message), { code: 'invalid_input' })

function evaluate(payload) {
  const artifact = payload?.artifacts?.designSystem ?? payload?.artifacts?.model // the conformance suite names it model (22-conformance.md)
  if (!artifact || !('content' in artifact)) throw invalid('artifacts.designSystem is required')
  const text = artifact.content?.document?.content
  // content that is not a DesignSystem is a finding, never an Adapter error
  if (typeof text !== 'string') return { passed: false, findings: [{ severity: 'error', code: 'not-a-design-system', message: 'content is not a DesignSystem: it has no document.content' }], evidence: [] }
  const findings = lint(text).findings.map((f) => ({ severity: f.severity, code: f.rule, message: f.path ? `${f.path}: ${f.message}` : f.message }))
  const fail = payload.validator?.configuration?.failOnWarning ? ['error', 'warning'] : ['error']
  return { passed: !findings.some((f) => fail.includes(f.severity)), findings, evidence: [] }
}

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
createInterface({ input: process.stdin }).once('line', (line) => {
  let id
  try {
    const request = JSON.parse(line)
    id = request.id
    if (request.op === 'describe') return out({ id, ok: true, result: describe })
    if (request.op !== 'evaluate') throw invalid(`unknown op ${request.op}`)
    out({ id, ok: true, result: evaluate(request.payload) })
  } catch (e) {
    out({ id, ok: false, error: { code: e.code ?? 'evaluation_failed', message: e.message, retryable: false } })
  }
})
