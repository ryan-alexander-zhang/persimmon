import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
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
  const inputs = Object.fromEntries((o.inputs ?? []).map((a) => parseInput(a, cli.cwd)))
  const doc: Resource = {
    apiVersion: 'persimmon.ai/v1',
    kind: 'WorkflowRun',
    metadata: { name: `${workflow.slice(0, 56)}-${randomBytes(3).toString('hex')}` }, // stays a DNS label
    spec: { workflowRef: { kind: 'Workflow', name: workflow }, inputs, ...(o.timeout ? { timeout: o.timeout } : {}), origin: { kind: 'manual' } }, // timeout: the Workflow's unless --timeout
  }
  return store(cli, doc, o)
}

/** `k=v`: `v` is YAML; `@file` reads the file; a RuntimeValue object passes through, anything else becomes `{kind: value, value}`. */
export function parseInput(arg: string, cwd = process.cwd()): [string, unknown] {
  const eq = arg.indexOf('=')
  if (eq < 1) throw new Error(`--input ${arg}: expected <port>=<value>`)
  const [port, raw] = [arg.slice(0, eq), arg.slice(eq + 1)]
  const v: unknown = parse(raw.startsWith('@') ? readFileSync(resolve(cwd, raw.slice(1)), 'utf8') : raw)
  const kind = (v as { kind?: unknown } | null)?.kind
  return [port, kind === 'value' || kind === 'artifact' || kind === 'externalResource' ? v : { kind: 'value', value: v }]
}

async function store(cli: Cli, doc: Resource, o: FollowOptions): Promise<number> {
  const engine = await openEngine(cli)
  try {
    placeDoc(engine, doc, o)
    if (doc.kind === 'WorkflowRun') {
      const wf = workflowOf(engine, doc)
      const spec = doc.spec as { timeout?: string }
      spec.timeout ??= (wf?.spec as { timeout?: string } | undefined)?.timeout ?? '24h' // 24h only when the Workflow is missing; validation then reports it
      pathInputs(engine, wf, cli.cwd, doc)
    }
    const { resource, created } = await engine.create(doc)
    cli.out(`${created ? 'created' : 'exists'} ${resource.kind}/${resource.metadata.name}`)
    if (!o.follow) {
      await engine.drain()
      return 0
    }
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
    const self = engine.store.resources.getByUid(uid)
    for (const r of [...children(engine, resource, new Set()), ...(self ? [self] : [])]) {
      const line = describe(r)
      if (seen.get(r.metadata.uid as string) === line) continue
      seen.set(r.metadata.uid as string, line)
      if (r.metadata.uid !== uid || phaseOf(r)) cli.out(`${r.kind}/${r.metadata.name}  ${line}`)
    }
  }
  const ticker = setInterval(report, pollMs) // a drain blocks on the agent for minutes; phases still print as they commit
  try {
    for (;;) {
      const r = engine.store.resources.getByUid(uid)
      if (!r) {
        cli.err(`${resource.kind}/${resource.metadata.name} is gone`)
        return 1
      }
      report()
      const v = readPath(r as unknown as Record<string, unknown>, t.path)
      if (typeof v === 'string' && t.values.includes(v)) return v === 'Succeeded' ? 0 : 1
      if (r.metadata.stalled) {
        cli.err(`${r.kind}/${r.metadata.name} stalled after ${r.metadata.stalled.attempts} attempts: ${r.metadata.stalled.lastError ?? ''}`)
        return 1
      }
      await engine.drain()
      await new Promise((res) => setTimeout(res, pollMs)) // ponytail: poll; wake on the next timer or call when it matters
    }
  } finally {
    clearInterval(ticker)
  }
}

/** Runs owned by `owner`, recursively: TaskRuns, GateRuns, ValidationRuns and their children. */
function children(engine: Engine, owner: Resource, seen: Set<string>): Resource[] {
  const ns = owner.metadata.namespace
  const out: Resource[] = []
  for (const kind of ['WorkflowRun', 'TaskRun', 'GateRun', 'ValidationRun'])
    for (const r of engine.store.resources.list(kind, ns))
      if (!seen.has(r.metadata.uid as string) && r.metadata.ownerReferences?.some((o) => o.uid === owner.metadata.uid)) {
        seen.add(r.metadata.uid as string)
        out.push(r, ...children(engine, r, seen))
      }
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

/** The run's Workflow: its Namespace first, then Global. */
function workflowOf(engine: Engine, doc: Resource): Resource | undefined {
  const { workflowRef } = doc.spec as { workflowRef: { name: string } }
  const ns = doc.metadata.namespace
  return (ns ? engine.store.resources.get({ kind: 'Workflow', namespace: ns, name: workflowRef.name }) : undefined) ?? engine.store.resources.get({ kind: 'Workflow', name: workflowRef.name })
}

/** `--input repository=.`: a plain path on an externalResource port becomes a git repository ref, pinned to HEAD when it is a checkout. */
function pathInputs(engine: Engine, wf: Resource | undefined, cwd: string, doc: Resource): void {
  const spec = doc.spec as { inputs: Record<string, { kind: string; value?: unknown }> }
  const ports = (wf?.spec as { inputs?: Record<string, { type: { kind: string } }> } | undefined)?.inputs ?? {}
  for (const [port, v] of Object.entries(spec.inputs)) {
    if (ports[port]?.type.kind !== 'externalResource' || v.kind !== 'value' || typeof v.value !== 'string') continue
    const path = resolve(cwd, v.value)
    if (!existsSync(path)) throw new Error(`--input ${port}=${v.value}: no such path`)
    let version = 'worktree'
    try {
      version = execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {
      /* not a git checkout: the ref still names the directory */
    }
    spec.inputs[port] = { kind: 'externalResource', ref: { provider: 'git', type: 'repository', id: basename(path), locator: { path }, version } } as never
  }
}

