// sdd/v1: the evaluator Role (19-adapter-roles.md) over the AI Native pack (23-pack-ai-native.md), in two modes.
// Given a Spec, `evaluate` runs `checkSpec` on it and the Prd, DomainModel, Architecture and BusinessRules it cites;
// given a Prd, it runs `checkPrd` on it and the BusinessRules of its context. It answers a ValidationResult
// (10-ports.md). No Engine callbacks.
import { createInterface } from 'node:readline'
import { checkPrd, checkSpec } from './check.mjs'

const describe = {
  adapterId: 'sdd/v1',
  protocol: 'persimmon.adapter/v1',
  roles: ['evaluator'],
  configurationSchema: { type: 'object', additionalProperties: false, properties: {} },
}

const invalid = (message) => Object.assign(new Error(message), { code: 'invalid_input' })
const required = (artifacts, name) => {
  const artifact = artifacts[name]
  if (!artifact || !('content' in artifact)) throw invalid(`artifacts.${name} is required`)
  return artifact.content
}

function evaluate(payload) {
  const artifacts = payload?.artifacts ?? {}
  // the artifact under evaluation is artifacts.spec; the conformance suite names it artifacts.model (22-conformance.md)
  if (!(artifacts.spec ?? artifacts.model)) {
    if (!artifacts.prd) throw invalid('artifacts.spec or artifacts.prd is required')
    const prd = required(artifacts, 'prd')
    // same stance as not-a-spec: content that is not a Prd is a finding, before the rules are required
    const notAPrd = checkPrd({ prd }).filter((f) => f.code === 'not-a-prd')
    if (notAPrd.length) return { passed: false, findings: notAPrd, evidence: [] }
    const findings = checkPrd({ prd, rules: required(artifacts, 'rules') })
    return { passed: findings.length === 0, findings, evidence: [] }
  }
  const spec = required({ spec: artifacts.spec ?? artifacts.model }, 'spec')
  // content that is not a Spec is a not-a-spec finding, never an Adapter error; nothing it cites can be read off it
  const notASpec = checkSpec({ spec }).filter((f) => f.code === 'not-a-spec')
  if (notASpec.length) return { passed: false, findings: notASpec, evidence: [] }
  const findings = checkSpec({
    spec,
    prd: required(artifacts, 'prd'),
    domainModel: required(artifacts, 'domainModel'),
    architecture: required(artifacts, 'architecture'),
    rules: required(artifacts, 'rules'),
  })
  // the payload carries each artifact as {content, provenance}: no RevisionRef, so no evidence (19-adapter-roles.md)
  return { passed: findings.length === 0, findings, evidence: [] }
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
