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
  const engine = new Engine({ config: parseConfig({}), storePath: ':memory:', blobs: memoryBlobs(), cwd: mkdtempSync(join(tmpdir(), 'persimmon-check-')) })
  try {
    await engine.start()
    if (base) for (const kind of ['KindDefinition', 'Handler', 'Adapter']) for (const r of base.store.resources.list(kind)) copy(engine, r)
    if (base) for (const kd of engine.kinds.definitions()) if (kd.spec.snapshot === 'Definition') for (const r of base.store.resources.list(kd.spec.names.kind)) copy(engine, r)
    const out: Checked[] = []
    // definitions first, so Workflows see their Tasks whatever the file order
    const ordered = [...docs].sort((a, b) => rank(a) - rank(b))
    for (const doc of ordered) {
      let resource: Resource
      try {
        resource = validateEnvelope(doc)
      } catch (e) {
        out.push({ resource: doc as Resource, findings: [{ severity: 'error', code: 'envelope', message: (e as Error).message }] })
        continue
      }
      const findings: Finding[] = []
      try {
        if (resource.kind === 'Adapter') copy(engine, resource) // no describe here; Executors get adapter_unavailable warnings
        else await engine.apply(resource)
        const impl = engine.handlers.lookup(resource.apiVersion, resource.kind)?.impl
        if (impl) findings.push(...impl.validate(engine.store.resources.get({ kind: resource.kind, namespace: resource.metadata.namespace ?? (engine.kinds.get(resource.apiVersion, resource.kind).definition.spec.scope === 'Global' ? undefined : 'default'), name: resource.metadata.name }) ?? resource).findings)
      } catch (e) {
        const f = (e as { findings?: Finding[] }).findings
        findings.push(...(f?.length ? f : [{ severity: 'error' as const, code: 'invalid', message: (e as Error).message }]))
      }
      out.push({ resource, findings })
    }
    return out
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

const order = ['KindDefinition', 'Handler', 'Adapter', 'RelationType', 'Prompt', 'Skill', 'Executor', 'Task', 'Validator', 'Gate', 'Workflow', 'Trigger']
const rank = (doc: unknown): number => {
  const i = order.indexOf((doc as { kind?: string })?.kind ?? '')
  return i === -1 ? order.length : i
}

export const hasErrors = (checked: Checked[]): boolean => checked.some((c) => c.findings.some((f) => f.severity === 'error'))
