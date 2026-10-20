// The Rewrite pack's wiring holds the design's rules (40-pack-rewrite.md). Its admission is cli.test.ts's `init --pack rewrite`;
// here, the rules no type check sees: the second reader is blind, only characterize measures the source, every Gate is pure.
import { readdirSync, readFileSync } from 'node:fs'
import { parseAllDocuments } from 'yaml'
import { describe, expect, it } from 'vitest'

const dir = 'packs/rewrite/global'
const all = readdirSync(dir).flatMap((f) => parseAllDocuments(readFileSync(`${dir}/${f}`, 'utf8')).map((d) => d.toJS()))
const named = (kind: string, name: string) => all.find((d) => d.kind === kind && d.metadata.name === name).spec
const steps = (workflow: string) => named('Workflow', workflow).steps as { id: string; uses: { name: string }; inputs: Record<string, unknown> }[]

describe('the Rewrite pack', () => {
  it('the second reader is blind: no previous round, nothing the first reader answered', () => {
    const reread = steps('inventory-work').find((s) => s.uses.name === 'reread-source')!
    expect(Object.keys(reread.inputs).sort()).toEqual(['base', 'brief', 'ledger', 'slice', 'source'])
    expect(named('Task', 'reread-source').action.context).not.toContainEqual({ kind: 'artifact', input: 'previous' })
  })

  it('only characterize measures the source; parity alone binds the rewrite\'s runs', () => {
    const ledgerSteps = Object.fromEntries(['survey-work', 'characterize-work', 'recover-work', 'parity-work'].map((w) => [w, steps(w).filter((s) => s.uses.name === 'compute-ledger').map((s) => Object.keys(s.inputs).sort())]))
    const measuring = ['coverage', 'mutantResults', 'runs', 'written']
    for (const [w, bound] of Object.entries(ledgerSteps)) for (const b of bound) expect({ w, measures: measuring.filter((p) => b.includes(p)) }).toEqual({ w, measures: w === 'characterize-work' ? measuring : [] })
    for (const [w, bound] of Object.entries(ledgerSteps)) for (const b of bound) expect({ w, rewrite: b.includes('rewriteRuns') }).toEqual({ w, rewrite: w === 'parity-work' })
  })

  it('every Gate is pure: its Validators are parity/v1 checks or cel, no agent and no human', () => {
    const validators = all.filter((d) => d.kind === 'Gate').flatMap((g) => g.spec.validators.map((v: { ref: { name: string } }) => v.ref.name))
    for (const name of new Set(validators)) {
      const v = all.find((d) => d.kind === 'Validator' && d.metadata.name === name)?.spec
      if (!v) continue // the SDLC pack's, by name: prd-consistency (sdd/v1) and acceptance-audited (cel)
      expect({ name, type: v.evaluator.type }).toEqual({ name, type: v.evaluator.type === 'cel' ? 'cel' : 'adapter' })
      if (v.evaluator.type === 'adapter') expect(v.evaluator.adapter).toBe('parity/v1')
    }
  })

  it('a human decides in produce, through a typed value the gate reads, and every Slice step reads the source only', () => {
    for (const t of ['cut-slices', 'decide-recovery', 'review-parity']) {
      const task = named('Task', t)
      expect({ t, executor: task.executorRef.name, required: task.outputs.decisions.type.schema.required.slice(0, 2) }).toEqual({ t, executor: 'local-reviewer', required: ['approved', 'findings'] })
    }
    const onSource = all.filter((d) => d.kind === 'Task' && d.spec.action.workspace?.input === 'source')
    expect(onSource.map((t) => t.metadata.name).sort()).toEqual(['audit-inventory', 'audit-mutants', 'index-source', 'inventory-source', 'reread-source', 'survey-source'])
    for (const t of onSource) expect({ t: t.metadata.name, sideEffects: t.spec.sideEffects }).toEqual({ t: t.metadata.name, sideEffects: t.metadata.name === 'index-source' ? 'idempotent' : 'none' })
  })
})
