// The SDLC pack inputs the Rewrite pack needs (40-pack-rewrite.md, 26-domain-discovery.md, 31-architecture-process.md): an
// inventory handed to every storming phase, a base for the first phase and for the architect, all optional, so a product
// from an idea runs as before. The pack's admission is cli.test.ts's `validate`; here, that each input is wired through.
import { readFileSync } from 'node:fs'
import { parseAllDocuments } from 'yaml'
import { describe, expect, it } from 'vitest'

const docs = (f: string) => parseAllDocuments(readFileSync(`packs/sdlc/global/${f}.yaml`, 'utf8')).map((d) => d.toJS())
const all = [...docs('50-tasks'), ...docs('80-workflows')]
const named = (kind: string, name: string) => all.find((d) => d.kind === kind && d.metadata.name === name).spec

describe('the SDLC pack takes a Rewrite pack inventory and base, optionally', () => {
  it('event-storm takes the inventory as an optional value naming no other pack\'s kind', () => {
    const storm = named('Task', 'event-storm')
    expect(storm.inputs.inventory).toMatchObject({ type: { kind: 'value', schema: { type: 'object' } }, required: false })
    expect(storm.action.instructions).toMatch(/With `inventory` bound/)
  })

  it('every storming loop hands the inventory to produce; the big-picture loop also takes a base', () => {
    for (const loop of ['storm-big-picture', 'storm-process', 'storm-design']) {
      const spec = named('ReviewLoop', loop)
      expect({ loop, input: spec.inputs.inventory.required, bound: spec.produce.inputs.inventory }).toEqual({ loop, input: false, bound: { fromInput: 'inventory' } })
    }
    const big = named('ReviewLoop', 'storm-big-picture')
    expect([big.inputs.base.required, big.produce.inputs.base]).toEqual([false, { fromInput: 'base' }])
  })

  it('domain-discovery hands the inventory to every storming phase and its base to the first', () => {
    const pipeline = named('Pipeline', 'domain-discovery')
    expect([pipeline.inputs.inventory.required, pipeline.inputs.base.required]).toEqual([false, false])
    const phase = (id: string) => pipeline.phases.find((p: { id: string }) => p.id === id).inputs
    // a Pipeline's phases are its steps verbatim (21-composition.md), so an optional input it may lack is omitted here, not by expansion
    for (const id of ['big-picture', 'process', 'design']) expect({ id, inventory: phase(id).inventory }).toEqual({ id, inventory: { fromInput: 'inventory', onMissing: 'omit' } })
    expect(phase('big-picture').base).toEqual({ fromInput: 'base', onMissing: 'omit' })
    expect(phase('process').base).toEqual({ fromStep: { stepRef: 'big-picture', output: 'model' } }) // the later phases still start from the one before
  })

  it('write-architecture and architect take the product\'s last Architecture and Adrs as an optional base', () => {
    const task = named('Task', 'write-architecture')
    expect([task.inputs.base.required, task.inputs.baseAdrs.required]).toEqual([false, false])
    expect(task.action.context).toEqual(expect.arrayContaining([{ kind: 'artifact', input: 'base' }, { kind: 'artifact', input: 'baseAdrs' }]))
    const loop = named('ReviewLoop', 'architect')
    expect([loop.produce.inputs.base, loop.produce.inputs.baseAdrs]).toEqual([{ fromInput: 'base' }, { fromInput: 'baseAdrs' }])
  })
})
