// Static checker (02-handler.md write path): schema plus the Handler's validate, without storing.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseConfig } from '../config.js'
import { Engine } from '../engine.js'
import { validateEnvelope } from '../resource/envelope.js'
import type { Finding } from '../handler/types.js'
import type { Resource } from '../resource/types.js'
import { memoryBlobs } from '../store/memory-blobs.js'

export interface Checked {
  resource: Resource
  findings: Finding[]
}

/** Checks a batch together: every document is applied to a throwaway in-memory Engine, so files may reference each other. */
export async function checkBatch(docs: unknown[], base?: Engine): Promise<Checked[]> {
  const engine = new Engine({ config: parseConfig(base ? { defaultNamespace: base.dispatch.defaultNamespace } : {}), storePath: ':memory:', blobs: memoryBlobs(), cwd: mkdtempSync(join(tmpdir(), 'persimmon-check-')) })
  try {
    await engine.start()
    if (base) for (const kind of ['KindDefinition', 'Handler', 'Adapter']) for (const r of base.store.resources.list(kind)) copy(engine, r)
    // definitions, so a Workflow sees its Tasks; revisions, so a changed revisioned kind is checked against them (01-kind-definition.md)
    if (base) for (const kd of engine.kinds.definitions()) if (kd.spec.snapshot === 'Definition' || kd.spec.revisioned) for (const r of base.store.resources.list(kd.spec.names.kind)) copy(engine, r)
    const out = new Map<unknown, Checked>()
    const check = async (doc: unknown): Promise<boolean> => {
      let resource: Resource
      try {
        resource = validateEnvelope(doc)
      } catch (e) {
        out.set(doc, { resource: doc as Resource, findings: [{ severity: 'error', code: 'envelope', message: (e as Error).message }] })
        return true
      }
      const findings: Finding[] = []
      let applied = true
      try {
        // the Namespace apply would stamp (cli/apply.ts placeDoc), so a Workflow in the file sees the project's Namespaced Tasks
        if (!resource.metadata.namespace && engine.kinds.lookup(resource.apiVersion, resource.kind)?.definition.spec.scope !== 'Global') resource.metadata.namespace = engine.dispatch.defaultNamespace
        if (resource.kind === 'Adapter') copy(engine, resource) // no describe here; Executors get adapter_unavailable warnings
        else await engine.apply(resource)
        const impl = engine.handlers.lookup(resource.apiVersion, resource.kind)?.impl
        if (impl) findings.push(...impl.validate(engine.store.resources.get({ kind: resource.kind, namespace: resource.metadata.namespace, name: resource.metadata.name }) ?? resource).findings)
      } catch (e) {
        applied = false
        const f = (e as { findings?: Finding[] }).findings
        findings.push(...(f?.length ? f : [{ severity: 'error' as const, code: 'invalid', message: (e as Error).message }]))
      }
      out.set(doc, { resource, findings })
      return applied
    }
    // definitions first, so Workflows see their Tasks whatever the file order; what a kind's order cannot settle (a
    // Workflow stepping into a ReviewLoop, a ReviewLoop producing with a Workflow) gets a second pass once everything else is in
    const ordered = [...docs].sort((a, b) => rank(a) - rank(b))
    let retry: unknown[] = []
    for (const doc of ordered) if (!(await check(doc))) retry.push(doc)
    for (let before = retry.length + 1; retry.length && retry.length < before; ) {
      before = retry.length
      const again: unknown[] = []
      for (const doc of retry) if (!(await check(doc))) again.push(doc)
      retry = again // a pass that settled nothing ends it: what is left is a real error
    }
    return ordered.map((doc) => out.get(doc)!)
  } finally {
    await engine.close()
  }
}

function copy(engine: Engine, r: Resource): void {
  const { uid: _u, resourceVersion: _v, generation: _g, creationTimestamp: _c, ...metadata } = r.metadata
  const stored = engine.store.resources.put({ ...r, metadata })
  if (r.kind === 'KindDefinition' && !engine.kinds.lookup(`${(r.spec as { group: string }).group}/v1`, (r.spec as { names: { kind: string } }).names.kind)) engine.kinds.register(stored)
  if (r.kind === 'Adapter') engine.adapters.register(stored as never)
}

const order = ['KindDefinition', 'Handler', 'Adapter', 'RelationType', 'Prompt', 'Skill', 'Executor', 'Task', 'Validator', 'Approval', 'Gate', 'Workflow', 'ReviewLoop', 'Pipeline', 'Trigger']
const rank = (doc: unknown): number => {
  const i = order.indexOf((doc as { kind?: string })?.kind ?? '')
  return i === -1 ? order.length : i
}

export const hasErrors = (checked: Checked[]): boolean => checked.some((c) => c.findings.some((f) => f.severity === 'error'))
