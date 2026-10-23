// eventstorming/v1: the evaluator Role (19-adapter-roles.md) over the event storming grammar (24-eventstorming.md).
// `evaluate` runs `check` on `artifacts.model.content`, and `checkSubdomains` beside an `artifacts.prd`, and answers a
// ValidationResult (10-ports.md); with an
// `artifacts.domainModel` it runs `checkDerived` instead, and `checkGlossary` beside an `artifacts.glossary` (26-domain-discovery.md). No Engine callbacks.
import { createInterface } from 'node:readline'
import { check, checkBoundedContext, checkDerived, checkGlossary, checkSubdomains, levelRank } from '../../tools/eventstorming/grammar/index.mjs'

const describe = {
  adapterId: 'eventstorming/v1',
  protocol: 'persimmon.adapter/v1',
  roles: ['evaluator'],
  configurationSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      level: { enum: ['big-picture', 'process', 'design'] },
      failOnWarning: { type: 'boolean' },
    },
  },
}

const invalid = (message) => Object.assign(new Error(message), { code: 'invalid_input' })

function evaluate(payload) {
  const model = payload?.artifacts?.model
  if (!model || !('content' in model)) throw invalid('artifacts.model is required')
  const domainModel = payload.artifacts.domainModel
  if (domainModel) {
    const context = payload.inputs?.context?.value
    if (typeof context !== 'string' || !context) throw invalid('inputs.context is required beside artifacts.domainModel')
    // a broken model cannot be compared, so its errors come first and the comparison is read under them
    const derived = [
      ...check(model.content).filter((f) => f.severity === 'error'),
      ...checkDerived(model.content, domainModel.content, context),
      // with the derived BoundedContext beside it: its subdomain, capabilities and map (34-subdomains.md)
      ...(payload.artifacts.boundedContext ? checkBoundedContext(model.content, payload.artifacts.boundedContext.content, context, payload.artifacts.prd?.content) : []),
      // with the derived Glossary beside it: every term a label of the context (26-domain-discovery.md)
      ...(payload.artifacts.glossary ? checkGlossary(model.content, domainModel.content, payload.artifacts.glossary.content, context) : []),
    ]
    return { passed: !derived.some((f) => f.severity === 'error'), findings: derived, evidence: [] }
  }
  const configuration = payload.validator?.configuration ?? {}
  const findings = [...check(model.content)] // content that is not a model is a not-a-model finding, never an Adapter error
  // beside the Prd it storms, its contexts name the Prd's subdomains (34-subdomains.md)
  const prd = payload.artifacts.prd
  if (prd && !findings.some((f) => f.code === 'not-a-model')) findings.push(...checkSubdomains(model.content, prd.content))
  const want = payload.inputs?.level?.value ?? configuration.level // the Validator's own input, else its configuration
  const level = model.content?.meta?.level
  if (want !== undefined && !(levelRank[level] >= levelRank[want])) {
    findings.push({ severity: 'error', code: 'below-level', message: `level ${level} is below the required ${want}` })
  }
  const fails = (f) => f.severity === 'error' || (configuration.failOnWarning === true && f.severity === 'warning')
  // the payload carries the model as {content, provenance}: no RevisionRef of the model itself, so no evidence (19-adapter-roles.md)
  return { passed: !findings.some(fails), findings, evidence: [] }
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
