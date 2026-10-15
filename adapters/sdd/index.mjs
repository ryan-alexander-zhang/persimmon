// sdd/v1: the evaluator Role (19-adapter-roles.md) over the SDLC pack (23-pack-sdlc.md), in four modes.
// Given a Spec, `evaluate` runs `checkSpec` on it and the Prd, DomainModel, Architecture and BusinessRules it cites;
// given a Prd, it runs `checkPrd` on it and the BusinessRules of its context; given a Design, it runs `checkDesign` on
// it and the Architecture, DomainModel and BusinessRules it cites (a ui Design: the DesignSystem bound and the API Designs
// instead of the DomainModel); given a Plan, it runs `checkPlan` on it, the Spec,
// the Architecture and the Designs (an artifacts port, paired with inputs.designs.refs by position); given an Architecture
// and no Spec, Design or Plan, it runs `checkArchitecture` on it, the Prd, the rules, the contexts, models, glossaries and
// Adrs (artifacts ports, paired the same way). It answers a ValidationResult (10-ports.md). No Engine callbacks.
import { createInterface } from 'node:readline'
import { checkArchitecture, checkDesign, checkPlan, checkPrd, checkSpec } from './check.mjs'

const describe = {
  adapterId: 'sdd/v1',
  protocol: 'persimmon.adapter/v1',
  roles: ['evaluator'],
  configurationSchema: { type: 'object', additionalProperties: false, properties: {} },
}

// a warning rides in the result and fails nothing: passed is no error finding (29-design-process.md)
const passes = (findings) => !findings.some((f) => f.severity === 'error')
const invalid = (message) => Object.assign(new Error(message), { code: 'invalid_input' })
const required = (artifacts, name) => {
  const artifact = artifacts[name]
  if (!artifact || !('content' in artifact)) throw invalid(`artifacts.${name} is required`)
  return artifact.content
}

// the `designs` artifacts port: artifact id → content, paired with inputs.designs.refs by position
const boundDesigns = (payload, artifacts) => {
  const refs = payload.inputs?.designs?.refs ?? []
  return Object.fromEntries((artifacts.designs ?? []).map((d, i) => [refs[i]?.id, d.content]))
}

function evaluate(payload) {
  const artifacts = payload?.artifacts ?? {}
  if (artifacts.plan) {
    const plan = required(artifacts, 'plan')
    const notAPlan = checkPlan({ plan }).filter((f) => f.code === 'not-a-plan')
    if (notAPlan.length) return { passed: false, findings: notAPlan, evidence: [] }
    const designs = boundDesigns(payload, artifacts)
    const ids = { spec: payload.inputs?.spec?.ref?.id, architecture: payload.inputs?.architecture?.ref?.id }
    const findings = checkPlan({ plan, spec: required(artifacts, 'spec'), architecture: required(artifacts, 'architecture'), designs, ids })
    return { passed: passes(findings), findings, evidence: [] }
  }
  const idsOf = (port) => (payload.inputs?.[port]?.refs ?? []).map((r) => r.id)
  // the artifact under evaluation is artifacts.spec; the conformance suite names it artifacts.model (22-conformance.md)
  if (!(artifacts.spec ?? artifacts.model)) {
    if (artifacts.architecture && !artifacts.design) {
      const architecture = required(artifacts, 'architecture')
      const notAnArchitecture = checkArchitecture({ architecture }).filter((f) => f.code === 'not-an-architecture')
      if (notAnArchitecture.length) return { passed: false, findings: notAnArchitecture, evidence: [] }
      const adrs = Object.fromEntries((artifacts.adrs ?? []).map((d, i) => [idsOf('adrs')[i], d.content]))
      const ids = { prd: payload.inputs?.prd?.ref?.id, rules: payload.inputs?.rules?.ref?.id, contexts: idsOf('contexts'), domainModels: idsOf('domainModels'), glossaries: idsOf('glossaries'), adrs: idsOf('adrs') }
      const findings = checkArchitecture({ architecture, prd: required(artifacts, 'prd'), rules: required(artifacts, 'rules'), ids, adrs })
      return { passed: passes(findings), findings, evidence: [] }
    }
    if (!artifacts.prd) {
      if (!artifacts.design) throw invalid('artifacts.spec, artifacts.prd, artifacts.design, artifacts.architecture or artifacts.plan is required')
      const design = required(artifacts, 'design')
      const notADesign = checkDesign({ design }).filter((f) => f.code === 'not-a-design')
      if (notADesign.length) return { passed: false, findings: notADesign, evidence: [] }
      const findings = checkDesign({
        design,
        architecture: required(artifacts, 'architecture'),
        domainModel: artifacts.domainModel?.content,
        rules: required(artifacts, 'rules'),
        designs: boundDesigns(payload, artifacts),
        ids: { designSystem: payload.inputs?.designSystem?.ref?.id, rules: payload.inputs?.rules?.ref?.id },
      })
      return { passed: passes(findings), findings, evidence: [] }
    }
    const prd = required(artifacts, 'prd')
    // same stance as not-a-spec: content that is not a Prd is a finding, before the rules are required
    const notAPrd = checkPrd({ prd }).filter((f) => f.code === 'not-a-prd')
    if (notAPrd.length) return { passed: false, findings: notAPrd, evidence: [] }
    const findings = checkPrd({ prd, rules: required(artifacts, 'rules'), previousRules: artifacts.previousRules?.content, feedback: payload.inputs?.feedback?.value, ids: { rules: payload.inputs?.rules?.ref?.id } })
    return { passed: passes(findings), findings, evidence: [] }
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
    ids: { rules: payload.inputs?.rules?.ref?.id },
  })
  // the payload carries each artifact as {content, provenance}: no RevisionRef, so no evidence (19-adapter-roles.md)
  return { passed: passes(findings), findings, evidence: [] }
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
