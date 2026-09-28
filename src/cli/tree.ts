// `persimmon tree`: a run, what it produced, every run it owns (08-store.md). `--follow` prints the same tree when it stops.
import type { Engine } from '../engine.js'
import type { Resource } from '../resource/types.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { parseRef } from './io.js'

export interface Where {
  namespace?: string
  global?: boolean
}

/** Namespace first, then Global: the LocalDefinitionRef order (00-resource.md). */
function lookup(engine: Engine, kind: string, namespace: string | undefined, name: string): Resource | undefined {
  return (namespace ? engine.store.resources.get({ kind, namespace, name }) : undefined) ?? engine.store.resources.get({ kind, name })
}

/** Runs `owner` owns directly, oldest first. */
export function ownedBy(engine: Engine, owner: Resource): Resource[] {
  const ns = owner.metadata.namespace
  const out: Resource[] = []
  for (const kind of ['WorkflowRun', 'TaskRun', 'GateRun', 'ValidationRun'])
    for (const r of engine.store.resources.list(kind, ns)) if (r.metadata.ownerReferences?.some((o) => o.uid === owner.metadata.uid)) out.push(r)
  return out.sort((a, b) => String(a.metadata.creationTimestamp).localeCompare(String(b.metadata.creationTimestamp)))
}


/** `persimmon tree <kind>/<name>`: the run, what it produced, and every run it owns, nested; state and elapsed time per run. */
export async function tree(cli: Cli, ref: string, o: Where = {}): Promise<number> {
  return withEngine(
    cli,
    async (engine) => {
      const { kind, name } = parseRef(ref)
      const r = name && (o.global ? engine.store.resources.get({ kind, name }) : lookup(engine, kind, o.namespace ?? engine.dispatch.defaultNamespace, name))
      if (!r) {
        cli.err(`${ref} not found`)
        return 1
      }
      for (const line of renderTree(engine, r)) cli.out(line)
      return 0
    },
    { listen: false },
  )
}

export type Status = { phase?: string; waitingReason?: string; error?: { code: string; message: string }; outputs?: Record<string, Output>; result?: Verdict; attempts?: { finishedAt?: string }[] }
type Output = { kind: string; ref?: { kind: string; id: string; revision: number }; value?: unknown }
type Verdict = { passed: boolean; findings?: { severity: string; code?: string; message: string }[] }
interface Row {
  left: string
  state: string
  duration: string
  extra: string[]
  extraPrefix: string
}

const done = new Set(['Succeeded', 'Failed', 'Cancelled'])

/** Rows first, then padding: labels are the child's name minus its owner's, the right column is state and elapsed time. */
export function renderTree(engine: Engine, root: Resource): string[] {
  const rows: Row[] = []
  const now = Date.now()
  const walk = (node: Resource, owner: Resource | undefined, prefix: string, last: boolean) => {
    const branch = owner ? `${prefix}${last ? '└─ ' : '├─ '}` : ''
    const child = owner ? `${prefix}${last ? '   ' : '│  '}` : ''
    const label = labelOf(node, owner)
    const parts = owner ? [label, node.kind] : [node.kind, label]
    const adapter = node.kind === 'TaskRun' ? adapterOf(engine, node) : undefined
    if (adapter) parts.push(adapter)
    const s = (node.status ?? {}) as Status
    rows.push({ left: `${branch}${parts.join('   ')}`, state: stateOf(node, s), duration: elapsed(engine, node, now), extra: extraLines(node, s), extraPrefix: `${child}   ` })
    const kids = ownedBy(engine, node)
    kids.forEach((k, i) => walk(k, node, child, i === kids.length - 1))
  }
  walk(root, undefined, '', true)
  const width = Math.max(...rows.map((r) => r.left.length))
  const dwidth = Math.max(...rows.map((r) => r.duration.length))
  const swidth = Math.max(10, ...rows.map((r) => r.state.length + 1))
  const out: string[] = []
  for (const r of rows) {
    out.push(`${r.left.padEnd(width)}   ${r.state.padEnd(swidth)}${r.duration.padStart(dwidth)}`.trimEnd())
    for (const e of r.extra) out.push(`${r.extraPrefix}${e}`)
  }
  const outputs = Object.entries(((root.status ?? {}) as Status).outputs ?? {})
  if (outputs.length) {
    out.push('', 'outputs')
    const pw = Math.max(...outputs.map(([p]) => p.length))
    for (const [port, v] of outputs) out.push(`  ${port.padEnd(pw)}  ${short(v)}`)
  }
  return out
}

/** `passed` or `rejected` for a Gate or Validator verdict; the phase otherwise, with the waiting reason. */
export function stateOf(node: Resource, s: Status): string {
  const verdict = node.kind === 'GateRun' ? (s.outputs?.result?.value as Verdict | undefined) : node.kind === 'ValidationRun' ? s.result : undefined
  if (s.phase === 'Succeeded' && verdict) return verdict.passed ? 'passed' : 'rejected'
  return [s.phase ?? 'Pending', s.phase === 'Waiting' ? s.waitingReason : undefined].filter(Boolean).join(' ')
}

/** What to read next: the error, the complete command, rejected findings, the artifacts a TaskRun published. */
function extraLines(node: Resource, s: Status): string[] {
  const lines: string[] = []
  if (s.error) lines.push(`${s.error.code}: ${s.error.message}`)
  if (s.phase === 'Waiting' && s.waitingReason === 'human' && node.kind === 'TaskRun') lines.push(`persimmon complete ${node.metadata.name}`)
  if (node.kind === 'ValidationRun' && s.result && !s.result.passed) for (const f of s.result.findings ?? []) if (f.severity !== 'info') lines.push(`${f.code ? `${f.code}: ` : ''}${f.message}`)
  if (node.kind === 'TaskRun') for (const v of Object.values(s.outputs ?? {})) if (v.kind === 'artifact' && v.ref) lines.push(`${v.ref.kind}/${v.ref.id}.r${v.ref.revision}`)
  return lines
}

/** An artifact as `<Kind>/<id>.r<n>`, a result as `passed true`, any other value as short JSON. */
function short(v: Output): string {
  if (v.kind === 'artifact' && v.ref) return `${v.ref.kind}/${v.ref.id}.r${v.ref.revision}`
  const val = v.value as { passed?: unknown } | undefined
  if (val && typeof val === 'object' && typeof val.passed === 'boolean') return `passed ${val.passed}`
  const json = JSON.stringify(v.value) ?? ''
  return json.length > 60 ? `${json.slice(0, 57)}...` : json
}

/** Creation to the last RunLog entry for a finished run, to now for a live one. */
function elapsed(engine: Engine, node: Resource, now: number): string {
  const from = Date.parse(node.metadata.creationTimestamp ?? '')
  if (Number.isNaN(from)) return ''
  const s = (node.status ?? {}) as Status
  let to = now
  if (done.has(s.phase ?? '')) {
    const applied = engine.store.runLog.read(node.metadata.uid as string).map((e) => Date.parse(e.appliedAt ?? '')).filter((t) => !Number.isNaN(t))
    if (applied.length) to = Math.max(...applied)
  }
  const sec = Math.max(0, Math.round((to - from) / 1000))
  const [h, m, ss] = [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60]
  return h ? `${h}h${String(m).padStart(2, '0')}m` : m ? `${m}m${String(ss).padStart(2, '0')}s` : `${ss}s`
}

/** The Adapter behind a TaskRun: its Task's Executor, resolved Namespace first, then Global. */
export function adapterOf(engine: Engine, run: Resource): string | undefined {
  const taskRef = (run.spec as { taskRef?: { name: string } }).taskRef
  const ns = run.metadata.namespace
  const task = taskRef && lookup(engine, 'Task', ns, taskRef.name)
  const executorRef = (task?.spec as { executorRef?: { name: string } } | undefined)?.executorRef
  const executor = executorRef && lookup(engine, 'Executor', ns, executorRef.name)
  return (executor?.spec as { adapter?: string } | undefined)?.adapter
}


/** The label a run shows under its owner: its name minus the owner's. */
export function labelOf(node: Resource, owner: Resource | undefined): string {
  return owner && node.metadata.name.startsWith(`${owner.metadata.name}-`) ? node.metadata.name.slice(owner.metadata.name.length + 1) : node.metadata.name
}

/** `rounds-1/implement`: labels from the root down to `node`, for `--follow` lines. */
export function labelPath(engine: Engine, node: Resource, root: Resource): string {
  const labels: string[] = []
  let cur: Resource | undefined = node
  while (cur && cur.metadata.uid !== root.metadata.uid) {
    const ownerUid: string | undefined = cur.metadata.ownerReferences?.[0]?.uid
    const owner: Resource | undefined = ownerUid ? engine.store.resources.getByUid(ownerUid) : undefined
    labels.unshift(labelOf(cur, owner))
    cur = owner
  }
  return labels.join('/')
}
