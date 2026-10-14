import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { parse } from 'yaml'
import type { Engine } from '../engine.js'
import { readPath } from '../reconcile/merge-patch.js'
import type { Resource, RevisionRef } from '../resource/types.js'
import { placeDoc } from './apply.js'
import type { Cli } from './context.js'
import { openEngine } from './context.js'
import { loadDocs } from './io.js'
import { adapterOf, labelPath, ownedBy, renderTree, type Status, stateOf } from './tree.js'

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

/** The next revision of `id` from `content`: the `<id>.r<n>` document `persimmon create` would read, stored the same way (05-revisioned-kind.md). */
export async function createRevision(engine: Engine, ref: { apiVersion: string; kind: string; namespace: string; id: string }, content: unknown): Promise<Resource> {
  const latest = engine.store.resources.listRevisions(ref.kind, ref.namespace, ref.id).at(-1)
  const revision = ((latest?.spec as { identity?: { revision: number } } | undefined)?.identity?.revision ?? 0) + 1
  const doc = (n: number): Resource => ({ apiVersion: ref.apiVersion, kind: ref.kind, metadata: { name: `${ref.id}.r${n}`, namespace: ref.namespace }, spec: { identity: { id: ref.id, revision: n }, content } })
  try {
    return (await engine.create(doc(revision))).resource
  } catch (e) {
    // the reserve counter runs past staged or abandoned revisions (05-revisioned-kind.md); the engine names the next one
    const next = /is not the next one \((\d+)\)/.exec((e as Error).message)?.[1]
    if (!next) throw e
    return (await engine.create(doc(Number(next)))).resource
  }
}

/** `persimmon run <Workflow> [--input k=v]... [--timeout d] [--follow]`: a manual WorkflowRun without writing its YAML. */
export async function run(cli: Cli, workflow: string, o: FollowOptions & { inputs?: string[]; timeout?: string } = {}): Promise<number> {
  const parsed = (o.inputs ?? []).map((a) => parseInput(a, cli.cwd))
  const inputs = Object.fromEntries(parsed)
  const texts: Record<string, FileText> = Object.fromEntries(parsed.flatMap((p) => (p.length === 3 ? [[p[0], p[2]]] : [])))
  const doc: Resource = {
    apiVersion: 'persimmon.ai/v1',
    kind: 'WorkflowRun',
    metadata: { name: `${workflow.slice(0, 56)}-${randomBytes(3).toString('hex')}` }, // stays a DNS label
    spec: { workflowRef: { kind: 'Workflow', name: workflow }, inputs, ...(o.timeout ? { timeout: o.timeout } : {}), origin: { kind: 'manual' } }, // timeout absent: the Workflow's (17-runs.md)
  }
  return store(cli, doc, o, texts)
}

/** A file given as `@file`: its text, for a string port that takes it raw, and the YAML error when it did not parse, for every other port. */
export interface FileText {
  text: string
  error?: Error
}

/** `k=v`: `v` is YAML; `@file` reads the file; a RuntimeValue object passes through, anything else becomes `{kind: value, value}`. A file that is not a RuntimeValue also comes back as a third element (`textInputs`). */
export function parseInput(arg: string, cwd = process.cwd()): [string, unknown] | [string, unknown, FileText] {
  const eq = arg.indexOf('=')
  if (eq < 1) throw new Error(`--input ${arg}: expected <port>=<value>`)
  const [port, raw] = [arg.slice(0, eq), arg.slice(eq + 1)]
  const text = raw.startsWith('@') ? readFileSync(resolve(cwd, raw.slice(1)), 'utf8') : undefined
  let v: unknown
  let error: Error | undefined
  try {
    v = parse(text ?? raw)
  } catch (e) {
    if (text === undefined) throw e
    error = e as Error // prose that is not YAML: the text itself, unless the port wants YAML
    v = text
  }
  const kind = (v as { kind?: unknown } | null)?.kind
  if (kind === 'value' || kind === 'artifact' || kind === 'artifacts' || kind === 'externalResource') return [port, v] // a RuntimeValue passes through, file or not
  return text === undefined ? [port, { kind: 'value', value: v }] : [port, { kind: 'value', value: v }, { text, ...(error ? { error } : {}) }]
}

async function store(cli: Cli, doc: Resource, o: FollowOptions, texts: Record<string, FileText> = {}): Promise<number> {
  const engine = await openEngine(cli)
  try {
    placeDoc(engine, doc, o)
    if (doc.kind === 'WorkflowRun') {
      const wf = workflowOf(engine, doc)
      textInputs(wf, doc, texts)
      pathInputs(engine, wf, cli.cwd, doc)
      await artifactInputs(engine, wf, doc)
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
    const changed: { line: string; at: number }[] = []
    for (const r of [...children(engine, resource, new Set()), ...(self ? [self] : [])]) {
      const line = followLine(engine, r, resource)
      if (seen.get(r.metadata.uid as string) === line) continue
      seen.set(r.metadata.uid as string, line)
      if (r.metadata.uid !== uid || phaseOf(r)) changed.push({ line, at: committedAt(engine, r) })
    }
    for (const c of changed.sort((a, b) => a.at - b.at)) cli.out(c.line) // one drain commits parent and child together; print in commit order, not walk order
  }
  const summary = () => {
    const self = engine.store.resources.getByUid(uid)
    if (!self) return
    cli.out('')
    for (const line of renderTree(engine, self)) cli.out(line)
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
      if (typeof v === 'string' && t.values.includes(v)) {
        summary()
        return v === 'Succeeded' ? 0 : 1
      }
      if (r.metadata.stalled) {
        cli.err(`${r.kind}/${r.metadata.name} stalled after ${r.metadata.stalled.attempts} attempts: ${r.metadata.stalled.lastError ?? ''}`)
        return 1
      }
      await engine.drain() // a resumed run may hold undelivered events; parked is judged only after the engine is idle
      const parked = parkedOn(children(engine, resource, new Set()))
      if (parked.length) {
        report()
        summary()
        for (const p of parked) cli.out(`parked on you: persimmon complete ${p.metadata.name}`)
        return 0
      }
      await new Promise((res) => setTimeout(res, pollMs)) // ponytail: poll; wake on the next timer or call when it matters
    }
  } finally {
    clearInterval(ticker)
  }
}

/** When the run last changed: its latest applied RunLog entry, else its creation. */
function committedAt(engine: Engine, r: Resource): number {
  const applied = engine.store.runLog.read(r.metadata.uid as string).map((e) => Date.parse(e.appliedAt ?? '')).filter((t) => !Number.isNaN(t))
  return applied.length ? Math.max(...applied) : Date.parse(r.metadata.creationTimestamp ?? '') || 0
}

/** `rounds-1/implement   TaskRun   codex/v1   Running`: the same words the tree uses, one line per change. */
function followLine(engine: Engine, r: Resource, root: Resource): string {
  const s = (r.status ?? {}) as Status
  const label = r.metadata.uid === root.metadata.uid ? `${r.kind}   ${r.metadata.name}` : `${labelPath(engine, r, root)}   ${r.kind}`
  const adapter = r.kind === 'TaskRun' ? adapterOf(engine, r) : undefined
  const state = [stateOf(r, s), s.error ? `${s.error.code}: ${s.error.message}` : undefined, r.metadata.stalled ? `stalled after ${r.metadata.stalled.attempts} attempts` : undefined].filter(Boolean).join('  ')
  return [label, adapter, state].filter(Boolean).join('   ')
}

/** Runs owned by `owner`, recursively: TaskRuns, GateRuns, ValidationRuns and their children. */
function children(engine: Engine, owner: Resource, seen: Set<string>): Resource[] {
  const out: Resource[] = []
  for (const r of ownedBy(engine, owner))
    if (!seen.has(r.metadata.uid as string)) {
      seen.add(r.metadata.uid as string)
      out.push(r, ...children(engine, r, seen))
    }
  return out
}

/** The human Tasks the run waits on, when nothing else is in flight: every TaskRun is finished or waits on a human, at least one does. */
// ponytail: only TaskRuns can idle on a timer today; a run kind that gains a poll or backoff wait must count as busy here too
function parkedOn(runs: Resource[]): Resource[] {
  const tasks = runs.filter((r) => r.kind === 'TaskRun')
  const human = tasks.filter((r) => phaseOf(r) === 'Waiting' && (r.status as { waitingReason?: string }).waitingReason === 'human')
  const busy = tasks.some((r) => !['Succeeded', 'Failed', 'Cancelled'].includes(phaseOf(r) ?? '') && !human.includes(r))
  return busy ? [] : human
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

/** `--input spec=@spec.yaml` on an artifact port: a revision document in the file is stored (once) and the run gets its reference.
 * On an artifacts port the file holds a list; each item is a revision document, stored the same way, or a RevisionRef taken as is. */
async function artifactInputs(engine: Engine, wf: Resource | undefined, doc: Resource): Promise<void> {
  const spec = doc.spec as { inputs: Record<string, { kind: string; value?: unknown }> }
  const ports = (wf?.spec as { inputs?: Record<string, { type: { kind: string } }> } | undefined)?.inputs ?? {}
  const isDoc = (d: unknown): d is Resource => !!(d as Resource | undefined)?.apiVersion && !!(d as Resource).kind && !!(d as Resource).metadata
  const store = async (port: string, d: Resource): Promise<RevisionRef> => {
    const identity = (d.spec as { identity?: { id: string; revision: number } } | undefined)?.identity
    if (!identity) throw new Error(`--input ${port}: ${d.kind}/${d.metadata.name} has no spec.identity`)
    if (!d.metadata.namespace && doc.metadata.namespace) d.metadata.namespace = doc.metadata.namespace // the run's Namespace
    const { resource } = await engine.create(d) // exists: same name, same content by immutability
    return { apiVersion: resource.apiVersion, kind: resource.kind, namespace: resource.metadata.namespace!, id: identity.id, revision: identity.revision }
  }
  for (const [port, v] of Object.entries(spec.inputs)) {
    const kind = ports[port]?.type.kind
    if (v.kind !== 'value') continue
    if (kind === 'artifact' && isDoc(v.value)) spec.inputs[port] = { kind: 'artifact', ref: await store(port, v.value) } as never
    else if (kind === 'artifact' && (v.value as Partial<RevisionRef> | undefined)?.id) spec.inputs[port] = { kind: 'artifact', ref: { ...(v.value as RevisionRef), namespace: (v.value as RevisionRef).namespace ?? doc.metadata.namespace! } } as never // a bare ref is in the run's Namespace, as a list item is
    // `kind:<Kind>`: every artifact of that kind in the run's Namespace at its latest committed revision, by id (33-multi-context-product.md)
    if (typeof v.value === 'string' && v.value.startsWith('kind:')) {
      if (kind !== 'artifacts') throw new Error(`--input ${port}: kind:<Kind> lists artifacts; ${port} is not an artifacts port`)
      const want = v.value.slice('kind:'.length)
      const ns = doc.metadata.namespace!
      const latest = new Map<string, RevisionRef>()
      for (const r of engine.store.resources.list(want, ns)) {
        const identity = (r.spec as { identity?: { id: string; revision: number } }).identity
        if (!identity || (latest.get(identity.id)?.revision ?? 0) >= identity.revision) continue
        latest.set(identity.id, { apiVersion: r.apiVersion, kind: r.kind, namespace: ns, id: identity.id, revision: identity.revision })
      }
      if (!latest.size) throw new Error(`--input ${port}: no ${want} in Namespace ${ns}`)
      spec.inputs[port] = { kind: 'artifacts', refs: [...latest.keys()].sort().map((id) => latest.get(id)!) } as never
      continue
    }
    if (kind === 'artifacts' && Array.isArray(v.value)) {
      const refs: RevisionRef[] = []
      for (const [i, item] of v.value.entries()) {
        const ref = item as Partial<RevisionRef>
        if (isDoc(item)) refs.push(await store(port, item))
        else if (ref?.apiVersion && ref.kind && ref.id && ref.revision) refs.push({ namespace: doc.metadata.namespace!, ...ref } as RevisionRef) // a ref without a Namespace is in the run's
        else throw new Error(`--input ${port}[${i}]: neither a revision document nor a RevisionRef`)
      }
      spec.inputs[port] = { kind: 'artifacts', refs } as never
    }
  }
  for (const [port, v] of Object.entries(spec.inputs as Record<string, { kind: string; ref?: RevisionRef; refs?: RevisionRef[] }>))
    for (const ref of v.kind === 'artifact' && v.ref ? [v.ref] : v.kind === 'artifacts' ? (v.refs ?? []) : []) {
      if (!ref.namespace) ref.namespace = doc.metadata.namespace! // a RuntimeValue given whole, without a Namespace
      if (ref.namespace !== doc.metadata.namespace) throw new Error(`--input ${port}: ${ref.kind} ${ref.id} is in Namespace ${ref.namespace}, not the run's (00-resource.md)`)
      if (!engine.store.resources.get({ kind: ref.kind, namespace: ref.namespace, name: `${ref.id}.r${ref.revision}` })) throw new Error(`--input ${port}: ${ref.kind} ${ref.id} revision ${ref.revision} is not in the store`) // refuse here, not inside the first Task
    }
}

/** The run's Workflow, or a composition expanding to one (21-composition.md): its Namespace first, then Global. `workflowRef.kind` is set to what was found. */
function workflowOf(engine: Engine, doc: Resource): Resource | undefined {
  const { workflowRef } = doc.spec as { workflowRef: { kind: string; name: string } }
  const ns = doc.metadata.namespace
  const kinds = ['Workflow', ...engine.kinds.definitions().filter((kd) => kd.spec.expansion?.kind === 'Workflow').map((kd) => kd.spec.names.kind)]
  const scopes: (string | undefined)[] = ns ? [ns, undefined] : [undefined] // Namespace across every kind first, then Global, the closure's own order (04-snapshot.md)
  for (const scope of scopes)
    for (const kind of kinds) {
      const hit = engine.store.resources.get(scope ? { kind, namespace: scope, name: workflowRef.name } : { kind, name: workflowRef.name })
      if (hit) {
        workflowRef.kind = kind
        return hit
      }
    }
  return undefined
}

/** `--input brief=@brief.txt` on a `value` port of `type: string`: the file's text as is, however YAML would read it, less one final newline; any other port gets the YAML reading, or its error. */
function textInputs(wf: Resource | undefined, doc: Resource, texts: Record<string, FileText>): void {
  const spec = doc.spec as { inputs: Record<string, unknown> }
  const ports = (wf?.spec as { inputs?: Record<string, { type: { kind: string; schema?: { type?: unknown } } }> } | undefined)?.inputs ?? {}
  for (const [port, { text, error }] of Object.entries(texts)) {
    if (ports[port]?.type.kind === 'value' && ports[port].type.schema?.type === 'string') spec.inputs[port] = { kind: 'value', value: text.replace(/\n$/, '') }
    else if (error) throw new Error(`--input ${port}: ${error.message}`)
  }
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

