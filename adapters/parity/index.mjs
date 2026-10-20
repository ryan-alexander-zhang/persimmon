// parity/v1: the evaluator Role (19-adapter-roles.md) over the Rewrite pack (40-pack-rewrite.md), one mode per Validator,
// named in its configuration so a Gate never gets a check by which inputs happen to be bound. `survey`: `checkSurvey` on
// `artifacts.inventory`, the `sourceIndex` value and cut-slices' `decisions` value; `inventory`: `checkInventory` on the
// inventory, the index, the `slice` value, the Survey's cut in `artifacts.ledger` and the second reader's `second` value.
// It answers a ValidationResult (10-ports.md). No Engine callbacks.
// `closure` (characterize-gate): `checkClosure` on the computed `artifacts.ledger`, the inventory, the index, the `coverage`
// and `runs` values and the `slice`; `recovery` (recover-gate): `checkRecovery` on `artifacts.prd`, `rules`, `inventory`,
// `ledger`, `lastPrd`, the `decisions` and the `slice`; `parity` (parity-gate): `checkParity` on the ledger, the `slice`, the
// rewrite's `driver` value and `artifacts.prd`.
import { createInterface } from 'node:readline'
import { checkClosure, checkInventory, checkParity, checkRecovery, checkSurvey } from './check.mjs'

const modes = ['survey', 'inventory', 'closure', 'recovery', 'parity']
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
  const mode = payload?.validator?.configuration?.mode
  const content = (name) => artifacts[name]?.content
  const value = (name) => inputs[name]?.value
  const inventory = content('inventory')
  // content that is no inventory is a finding, never an Adapter error, as sdd/v1 answers a document that is no Spec
  if (mode !== 'parity' && (!inventory?.source || !Array.isArray(inventory.entryPoints))) return done([{ severity: 'error', code: 'not-an-inventory', message: 'artifacts.inventory is no SourceInventory' }])
  if (!modes.includes(mode)) throw invalid(`parity/v1 runs one of ${modes.join(', ')}, named by the Validator's configuration.mode; got ${JSON.stringify(mode)}`)
  const need = (what, ok) => {
    if (!ok) throw invalid(`mode ${mode} needs ${what}`)
  }
  const slice = value('slice')
  if (mode !== 'survey') need('inputs.slice, the Slice it checks', typeof slice === 'string')
  if (mode === 'survey' || mode === 'inventory' || mode === 'closure') need('inputs.sourceIndex, the index index-source read', value('sourceIndex')?.files)
  if (mode === 'closure' || mode === 'recovery' || mode === 'parity') {
    need('artifacts.ledger, the ledger compute-ledger answered', content('ledger')?.items)
    need(`a ledger revision of ${slice}, not of ${content('ledger').slice ?? 'the Survey'}`, content('ledger').slice === slice)
  }
  if (mode === 'closure') need('inputs.coverage and inputs.runs, what run-source answered', value('coverage') && Array.isArray(value('runs')))
  switch (mode) {
    case 'survey':
      need('inputs.decisions, the cut', value('decisions'))
      return done(checkSurvey({ inventory, index: value('sourceIndex'), decisions: value('decisions') }))
    case 'inventory':
      return done(checkInventory({ inventory, index: value('sourceIndex'), slices: content('ledger')?.slices ?? [], slice, second: value('second') }))
    case 'closure':
      return done(checkClosure({ ledger: content('ledger'), inventory, index: value('sourceIndex'), coverage: value('coverage'), runs: value('runs'), slice }))
    case 'recovery':
      need('artifacts.prd and artifacts.rules, the recovered pair', content('prd') && content('rules'))
      return done(checkRecovery({ prd: content('prd'), rules: content('rules'), inventory, ledger: content('ledger'), decisions: value('decisions') ?? {}, lastPrd: content('lastPrd'), slice }))
    default:
      return done(checkParity({ ledger: content('ledger'), slice, driver: value('driver'), prd: content('prd') }))
  }
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
