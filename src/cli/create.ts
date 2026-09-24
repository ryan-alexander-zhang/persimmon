import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import type { Engine } from '../engine.js'
import { readPath } from '../reconcile/merge-patch.js'
import type { Resource } from '../resource/types.js'
import { placeDoc } from './apply.js'
import type { Cli } from './context.js'
import { openEngine } from './context.js'
import { loadDocs } from './io.js'

export interface FollowOptions {
  follow?: boolean
  pollMs?: number
  namespace?: string
}

/** `persimmon create <file> [--follow]`: store any Resource; `--follow` runs until it reaches a terminal value. */
export async function create(cli: Cli, file: string, o: FollowOptions = {}): Promise<number> {
  const [doc] = loadDocs([file]) as Resource[]
  if (!doc) throw new Error(`${file}: no document`)
  return store(cli, doc, o)
}

/** `persimmon run <Workflow> [--input k=v]... [--timeout d] [--follow]`: a manual WorkflowRun without writing its YAML. */
export async function run(cli: Cli, workflow: string, o: FollowOptions & { inputs?: string[]; timeout?: string } = {}): Promise<number> {
  const inputs = Object.fromEntries((o.inputs ?? []).map(parseInput))
  const doc: Resource = {
    apiVersion: 'persimmon.ai/v1',
    kind: 'WorkflowRun',
    metadata: { name: `${workflow}-${randomBytes(3).toString('hex')}` },
    spec: { workflowRef: { kind: 'Workflow', name: workflow }, inputs, timeout: o.timeout ?? '24h', origin: { kind: 'manual' } },
  }
  return store(cli, doc, o)
}

/** `k=v`: `v` is YAML; `@file` reads the file; a RuntimeValue object passes through, anything else becomes `{kind: value, value}`. */
export function parseInput(arg: string): [string, unknown] {
  const eq = arg.indexOf('=')
  if (eq < 1) throw new Error(`--input ${arg}: expected <port>=<value>`)
  const [port, raw] = [arg.slice(0, eq), arg.slice(eq + 1)]
  const v: unknown = parse(raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw)
  const kind = (v as { kind?: unknown } | null)?.kind
  return [port, kind === 'value' || kind === 'artifact' || kind === 'externalResource' ? v : { kind: 'value', value: v }]
}

async function store(cli: Cli, doc: Resource, o: FollowOptions): Promise<number> {
  const engine = await openEngine(cli)
  try {
    placeDoc(engine, doc, o)
    const { resource, created } = await engine.create(doc)
    cli.out(`${created ? 'created' : 'exists'} ${resource.kind}/${resource.metadata.name}`)
    await engine.drain()
    if (!o.follow) return 0
    return await follow(cli, engine, resource, o.pollMs ?? 500)
  } finally {
    await engine.close()
  }
}

/** Drains until `resource` reaches a terminal value; prints every phase change of it and of the runs it owns. */
async function follow(cli: Cli, engine: Engine, resource: Resource, pollMs: number): Promise<number> {
  const t = engine.kinds.get(resource.apiVersion, resource.kind).definition.spec.terminal
  if (!t) return 0
  const uid = resource.metadata.uid as string
  const seen = new Map<string, string>()
  const report = () => {
    for (const r of [...children(engine, resource), engine.store.resources.getByUid(uid)!]) {
      const line = describe(r)
      if (seen.get(r.metadata.uid as string) === line) continue
      seen.set(r.metadata.uid as string, line)
      if (r.metadata.uid !== uid || phaseOf(r)) cli.out(`${r.kind}/${r.metadata.name}  ${line}`)
    }
  }
  for (;;) {
    const r = engine.store.resources.getByUid(uid)!
    report()
    const v = readPath(r as unknown as Record<string, unknown>, t.path)
    if (typeof v === 'string' && t.values.includes(v)) return v === 'Succeeded' ? 0 : 1
    if (r.metadata.stalled) {
      cli.err(`${r.kind}/${r.metadata.name} stalled after ${r.metadata.stalled.attempts} attempts: ${r.metadata.stalled.lastError ?? ''}`)
      return 1
    }
    await new Promise((res) => setTimeout(res, pollMs)) // ponytail: poll; wake on the next timer or call when it matters
    await engine.drain()
  }
}

/** Runs owned by `owner`, recursively: TaskRuns, GateRuns, ValidationRuns and their children. */
function children(engine: Engine, owner: Resource): Resource[] {
  const ns = owner.metadata.namespace
  const out: Resource[] = []
  for (const kind of ['WorkflowRun', 'TaskRun', 'GateRun', 'ValidationRun'])
    for (const r of engine.store.resources.list(kind, ns))
      if (r.metadata.ownerReferences?.some((o) => o.uid === owner.metadata.uid)) out.push(r, ...children(engine, r))
  return out
}

const phaseOf = (r: Resource) => (typeof r.status?.phase === 'string' ? r.status.phase : undefined)

/** `Running`, `Waiting human`, `Failed permission_denied: …`, `stalled after 3 attempts`. */
export function describe(r: Resource): string {
  const s = (r.status ?? {}) as { phase?: string; waitingReason?: string; error?: { code: string; message: string } }
  const parts = [s.phase ?? '']
  if (s.phase === 'Waiting' && s.waitingReason) parts.push(s.waitingReason)
  if (s.phase === 'Waiting' && s.waitingReason === 'human' && r.kind === 'TaskRun') parts.push(`(.persimmon/inbox/${r.metadata.name}.yaml)`)
  if (s.error) parts.push(`${s.error.code}: ${s.error.message}`)
  if (r.metadata.stalled) parts.push(`stalled after ${r.metadata.stalled.attempts} attempts`)
  return parts.filter(Boolean).join(' ')
}
