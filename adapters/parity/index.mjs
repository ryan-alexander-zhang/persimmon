// parity/v1: the evaluator Role (19-adapter-roles.md) over the Rewrite pack (40-pack-rewrite.md), one mode per Validator,
// named in its configuration so a Gate never gets a check by which inputs happen to be bound. `survey`: `checkSurvey` on
// `artifacts.inventory`, the `sourceIndex` value and cut-slices' `decisions` value; `inventory`: `checkInventory` on the
// inventory, the index, the `slice` value, the Survey's cut in `artifacts.ledger` and the second reader's `second` value.
// It answers a ValidationResult (10-ports.md). No Engine callbacks.
import { createInterface } from 'node:readline'
import { checkInventory, checkSurvey } from './check.mjs'

const modes = ['survey', 'inventory']
const describe = {
  adapterId: 'parity/v1',
  protocol: 'persimmon.adapter/v1',
  roles: ['evaluator'],
  configurationSchema: { type: 'object', additionalProperties: false, properties: { mode: { enum: modes, description: 'which of the Rewrite pack checks this Validator runs' } } },
}

const invalid = (message) => Object.assign(new Error(message), { code: 'invalid_input' })
const done = (findings) => ({ passed: !findings.some((f) => f.severity === 'error'), findings, evidence: [] })

function evaluate(payload) {
  const artifacts = payload?.artifacts ?? {}
  const inputs = payload?.inputs ?? {}
  const inventory = artifacts.inventory?.content
  // content that is no inventory is a finding, never an Adapter error, as sdd/v1 answers a document that is no Spec
  if (!inventory?.source || !Array.isArray(inventory.entryPoints)) return done([{ severity: 'error', code: 'not-an-inventory', message: 'artifacts.inventory is no SourceInventory' }])
  const mode = payload.validator?.configuration?.mode
  if (!modes.includes(mode)) throw invalid(`parity/v1 runs one of ${modes.join(', ')}, named by the Validator's configuration.mode; got ${JSON.stringify(mode)}`)
  const index = inputs.sourceIndex?.value
  if (!index?.files) throw invalid('inputs.sourceIndex is required beside artifacts.inventory: the index index-source read')
  if (mode === 'survey') {
    if (!inputs.decisions?.value) throw invalid('mode survey checks the cut: inputs.decisions is required')
    return done(checkSurvey({ inventory, index, decisions: inputs.decisions.value }))
  }
  if (typeof inputs.slice?.value !== 'string') throw invalid('mode inventory checks one Slice: inputs.slice is required')
  return done(checkInventory({ inventory, index, slices: artifacts.ledger?.content?.slices ?? [], slice: inputs.slice.value, second: inputs.second?.value }))
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
