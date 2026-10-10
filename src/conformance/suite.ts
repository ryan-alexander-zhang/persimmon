// The conformance suite (22-conformance.md): the engine's side of persimmon.adapter/v1 played against one executor
// Adapter, one verdict per rule. Offline, the Adapter runs the stub it named; live, its real CLI answers once.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { skillDigest } from '../../adapters/lib/skills.mjs'
import { call } from '../adapter/transport.js'
import type { AdapterSpec, CallOutcome, Describe, StreamLine } from '../adapter/types.js'
import { formatErrors, validator } from '../resource/ajv.js'
import { envName } from '../store/credentials.js'
import type { CredentialStore } from '../store/store.js'
import { serveCallbacks } from './callbacks.js'

export interface Verdict {
  id: RuleId
  status: 'pass' | 'FAIL' | 'skip'
  rule: string
  reason?: string
}

export interface SuiteOptions {
  /** Executor configuration; absent: `describe.conformance.configuration` offline, `{}` live. */
  configuration?: Record<string, unknown>
  /** The Adapter's own `credentialBindings` resolve here, as at apply; the fixture's Task credential is the suite's. */
  credentials?: CredentialStore
  /** No stub, no cues: the real CLI answers once; only the rules marked live in the design run. */
  live?: boolean
}

export const rules = {
  E1: 'describe validates ExecutorDescribe; adapterId is the id; roles has executor',
  E2: 'a second describe is equal to the first',
  E3: 'execute answers exactly the declared outputs; artifacts go through putBlob then publishArtifact under the call token',
  E4: 'a second execute with the same idempotencyKey publishes the same identity',
  E5: 'credentials reach the program only as <NS>__<NAME> environment',
  E6: 'engine.token and the adapter token never reach the program',
  E7: 'the program runs in payload.workspace; a workspace that is not a directory is invalid_input',
  E8: 'a passed deadline is timeout; a program outliving the deadline is killed, timeout',
  E9: 'cancel by idempotencyKey answers a CancelResult; a process attempt then answers cancelled',
  E10: 'a non-zero exit is agent_failed, retryable; credential values are redacted from log lines',
  E11: 'the prompt presents context entries before instructions, in order, instructions verbatim',
  E12: 'a declared Skill: missing is invalid_input, another digest is skill_digest_mismatch, equal passes',
  E13: 'an unknown op is invalid_input',
  E14: 'human: execute answers HumanAck after a waiting stream line with reason human',
  E15: 'every error is {code, message, retryable}',
} as const
export type RuleId = keyof typeof rules
const ids = Object.keys(rules) as RuleId[]

const executorDescribe = validator<Describe & { executorTypes: string[]; contextKinds: string[]; skillFormats: string[]; supports: { cancel: boolean }; conformance?: { configuration?: Record<string, unknown>; skillDir?: string } }>('adapter-roles.yaml', '/$defs/ExecutorDescribe')
const taskResult = validator<{ outputs: Record<string, unknown> }>('task.yaml', '/$defs/TaskResult')
const humanAck = validator('adapter-roles.yaml', '/$defs/HumanAck')
const cancelResult = validator('adapter-roles.yaml', '/$defs/CancelResult')
const errorShape = validator('reconcile.yaml', '/$defs/Error')

const answer = { doc: { title: 'Fixture note' }, count: 1 } // what a careful agent derives from the context: the note's title, the number of notes
const noteKind = { apiVersion: 'conformance.persimmon.ai/v1', kind: 'Note' }
const noteRef = { ...noteKind, namespace: 'conformance', id: 'fixture-note', revision: 1 }
const fixtureArtifact = { ...noteKind, metadata: { namespace: 'conformance', name: 'fixture-note.r1' }, spec: { identity: { id: 'fixture-note', revision: 1 }, content: { title: 'Fixture note' } } }
const promptText = 'Conformance prompt: keep the title exact.\n'
const instructions = 'You were given one note. Answer with doc = {title: <the title of that note, unchanged>} and count = 1, the number of notes you were given.'
const credentialName = 'demo/github-token'
const lei = 'conformance-001//fixture'
const skillSource = { provider: 'git', type: 'repository', id: 'conformance-skill', locator: { url: 'https://example.invalid/conformance-skill.git' }, version: 'v1' }

type Record_ = { argv: string[]; stdin: string; env: Record<string, string>; cwd: string }
type Sent = { out: CallOutcome; stream: StreamLine[] }

const outcome = (out: CallOutcome): string =>
  out.state === 'succeeded' ? `ok ${JSON.stringify(out.result).slice(0, 200)}`
  : out.state === 'failed' ? `${out.error.code}: ${out.error.message}`
  : out.state === 'unknown' ? `unknown: ${out.reason}`
  : out.state

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message)
}

function failedWith(out: CallOutcome, code: string, retryable?: boolean): void {
  check(out.state === 'failed', `expected ${code}, got ${outcome(out)}`)
  check(out.error.code === code, `expected ${code}, got ${out.error.code}: ${out.error.message}`)
  if (retryable !== undefined) check(out.error.retryable === retryable, `${code} must be retryable: ${retryable}`)
}

const waitFor = async (cond: () => boolean, ms: number, what: string): Promise<void> => {
  const until = Date.now() + ms
  while (!cond()) {
    check(Date.now() < until, what)
    await new Promise((r) => setTimeout(r, 50))
  }
}

export async function conformance(spec: AdapterSpec, o: SuiteOptions = {}): Promise<Verdict[]> {
  const live = o.live === true
  const dir = mkdtempSync(join(tmpdir(), 'persimmon-conf-')) // the Adapter's cwd: .persimmon/ state lands here
  const workspace = join(dir, 'workspace')
  mkdirSync(workspace)
  const socket = join(dir, 'engine.sock')
  const record = join(dir, 'record.json')
  const tokens = { call: `call-${randomUUID()}`, adapter: `adapter-${randomUUID()}` }
  const secret = `conformance-secret-${randomUUID()}`
  const server = await serveCallbacks(socket, tokens, { artifact: fixtureArtifact })
  const credentials: CredentialStore = { resolve: (n) => (n === credentialName ? secret : o.credentials?.resolve(n)) }
  const verdicts: Verdict[] = []
  const errors: unknown[] = []
  const rule = async (id: RuleId, applies: boolean | string, fn: () => Promise<void>): Promise<void> => {
    if (applies !== true) {
      verdicts.push({ id, rule: rules[id], status: 'skip', reason: typeof applies === 'string' ? applies : 'not applicable' })
      return
    }
    try {
      await fn()
      verdicts.push({ id, rule: rules[id], status: 'pass' })
    } catch (e) {
      verdicts.push({ id, rule: rules[id], status: 'FAIL', reason: (e as Error).message })
    }
  }
  const send = async (op: string, payload: Record<string, unknown>, cues: Record<string, string> = {}, timeoutMs = live ? 600_000 : 30_000): Promise<Sent> => {
    const stream: StreamLine[] = []
    const withCues: AdapterSpec = { ...spec, env: { ...spec.env, ...(live ? {} : { PERSIMMON_ADAPTER_CONFORMANCE: '1' }), ...cues } }
    const out = await call(withCues, op, payload, credentials, { cwd: dir, adapterToken: tokens.adapter, timeoutMs, onStream: (l) => stream.push(l) })
    if (out.state === 'failed') errors.push(out.error)
    return { out, stream }
  }

  try {
    let describe: (typeof executorDescribe extends (v: unknown) => v is infer T ? T : never) | undefined
    await rule('E1', true, async () => {
      const { out } = await send('describe', {})
      check(out.state === 'succeeded', `describe ${outcome(out)}`)
      const d = out.result
      check(executorDescribe(d), `describe: ${formatErrors(executorDescribe.errors)}`)
      check(d.adapterId === spec.id, `adapterId ${d.adapterId} != ${spec.id}`)
      check(d.roles.includes('executor'), 'roles lack executor')
      describe = d
    })
    if (!describe) {
      for (const id of ids.slice(1)) verdicts.push({ id, rule: rules[id], status: 'skip', reason: 'E1 failed' })
      return verdicts
    }
    const d = describe
    await rule('E2', true, async () => {
      const { out } = await send('describe', {})
      check(out.state === 'succeeded' && isDeepStrictEqual(out.result, d), 'second describe differs')
    })

    const processType = d.executorTypes.find((t) => t !== 'human')
    const isProcess = processType !== undefined
    const isHuman = d.executorTypes.includes('human')
    const isAgent = d.executorTypes.includes('agent')
    const contextKinds = new Set(d.contextKinds)
    const configuration = o.configuration ?? (live ? {} : (d.conformance?.configuration ?? {}))
    const notLive = live ? 'live' : true
    const forProcess = isProcess ? notLive : 'no agent, script or tool type'
    const credentialEnv = envName('', credentialName)
    const context = [
      { kind: 'artifact', ref: noteRef },
      { kind: 'prompt', name: 'conformance-prompt', mediaType: 'text/markdown', content: promptText, digest: `sha256:${'0'.repeat(64)}` },
    ].filter((c) => contextKinds.has(c.kind))
    const payload = (n: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
      taskRun: { ref: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', namespace: 'conformance', name: 'conformance-001-fixture', uid: 'conformance-uid' }, logicalExecutionId: lei, idempotencyKey: `${lei}/${n}`, attempt: 1 },
      task: {
        instructions, parameters: {}, sideEffects: 'idempotent',
        outputs: { doc: { type: { kind: 'artifact', artifactKind: noteKind } }, count: { type: { kind: 'value', schema: { type: 'integer' } } } },
        outputSchemas: { doc: { type: 'object', required: ['title'], additionalProperties: false, properties: { title: { type: 'string' } } } },
      },
      executor: { type: isProcess ? processType : 'human', configuration, security: { networkAccess: 'deny', credentialBindings: [credentialName] } },
      inputs: { note: { kind: 'artifact', ref: noteRef } },
      context,
      deadline: new Date(Date.now() + (live ? 600_000 : 60_000)).toISOString(),
      workspace,
      credentials: { [credentialName]: secret },
      engine: { endpoint: `unix://${socket}`, token: tokens.call },
      ...over,
    })
    const execute = (n: number, cues: Record<string, string> = {}, over: Record<string, unknown> = {}, timeoutMs?: number): Promise<Sent> => {
      rmSync(record, { force: true })
      server.calls.length = 0
      return send('execute', payload(n, over), { PERSIMMON_CONFORMANCE_ANSWER: JSON.stringify(answer), PERSIMMON_CONFORMANCE_RECORD: record, ...cues }, timeoutMs)
    }
    const readRecord = (): Record_ => {
      check(existsSync(record), 'the program never ran')
      return JSON.parse(readFileSync(record, 'utf8')) as Record_
    }

    let first: Sent | undefined
    let firstId: string | undefined
    await rule('E3', isProcess || 'no agent, script or tool type', async () => {
      first = await execute(1)
      const { out } = first
      check(out.state === 'succeeded', `execute ${outcome(out)}`)
      check(taskResult(out.result), `result: ${formatErrors(taskResult.errors)}`)
      const outputs = out.result.outputs
      check(isDeepStrictEqual(Object.keys(outputs).sort(), ['count', 'doc']), `outputs ${Object.keys(outputs).join(', ')} != doc, count`)
      check(isDeepStrictEqual(outputs.count, { kind: 'value', value: answer.count }), `count ${JSON.stringify(outputs.count)}`)
      const published = server.calls.filter((c) => c.name === 'publishArtifact')
      const put = server.calls.filter((c) => c.name === 'putBlob')
      check(published.length === 1, `${published.length} publishArtifact calls, expected 1`)
      check(put.length >= 1 && server.calls.indexOf(put[0]!) < server.calls.indexOf(published[0]!), 'putBlob must precede publishArtifact')
      check([...put, ...published].every((c) => c.token === tokens.call), 'putBlob and publishArtifact must carry the call token')
      check(isDeepStrictEqual(published[0]!.args.content, answer.doc), `published content ${JSON.stringify(published[0]!.args.content)}`)
      firstId = published[0]!.args.id as string
      check(isDeepStrictEqual(outputs.doc, { kind: 'artifact', ref: { ...noteKind, namespace: 'conformance', id: firstId, revision: 1 } }), `doc ${JSON.stringify(outputs.doc)} is not the published RevisionRef`)
    })
    await rule('E4', firstId ? forProcess : 'E3 did not publish', async () => {
      const { out } = await execute(1)
      check(out.state === 'succeeded', `execute ${outcome(out)}`)
      const id = server.calls.find((c) => c.name === 'publishArtifact')?.args.id
      check(id === firstId, `published ${String(id)}, the first execute published ${firstId}`)
    })
    const seen = isProcess && !live && existsSync(record) ? readRecord() : undefined
    await rule('E5', seen ? true : forProcess === true ? 'the program never ran' : forProcess, async () => {
      const s = seen!
      check(s.env[credentialEnv] === secret, `${credentialEnv} missing from the program environment`)
      const holders = Object.entries(s.env).filter(([, v]) => v.includes(secret)).map(([k]) => k)
      check(isDeepStrictEqual(holders, [credentialEnv]), `the secret is in environment ${holders.join(', ')}`)
      check(!s.argv.join(' ').includes(secret), 'the secret is in an argument')
      check(!s.stdin.includes(secret), 'the secret is on stdin')
      check(!first!.stream.some((l) => l.event === 'log' && l.text.includes(secret)), 'the secret is in a log line')
      check(!JSON.stringify(first!.out).includes(secret), 'the secret is in the result')
    })
    await rule('E6', seen ? true : forProcess === true ? 'the program never ran' : forProcess, async () => {
      const dump = JSON.stringify(seen)
      check(!dump.includes(tokens.call), 'engine.token reached the program')
      check(!dump.includes(tokens.adapter), 'the adapter token reached the program')
      check(!('PERSIMMON_ADAPTER_TOKEN' in seen!.env), 'PERSIMMON_ADAPTER_TOKEN is in the program environment')
    })
    await rule('E7', isProcess || 'no agent, script or tool type', async () => {
      if (seen) check(realpathSync(seen.cwd) === realpathSync(workspace), `the program ran in ${seen.cwd}, not the workspace`)
      const { out } = await execute(2, {}, { workspace: join(dir, 'not-a-directory') })
      failedWith(out, 'invalid_input', false)
    })
    await rule('E8', isProcess || 'no agent, script or tool type', async () => {
      const passed = await execute(3, {}, { deadline: new Date(Date.now() - 1000).toISOString() })
      failedWith(passed.out, 'timeout')
      if (live) return
      const slept = await execute(4, { PERSIMMON_CONFORMANCE_AGENT: 'sleep' }, { deadline: new Date(Date.now() + 1500).toISOString() }, 20_000)
      failedWith(slept.out, 'timeout', true)
    })
    await rule('E9', d.supports.cancel ? notLive : 'supports.cancel is false', async () => {
      if (isProcess) {
        const running = execute(5, { PERSIMMON_CONFORMANCE_AGENT: 'sleep' }, {}, 20_000)
        await waitFor(() => existsSync(record), 10_000, 'the program never started')
        const { out: c } = await send('cancel', { logicalExecutionId: lei, idempotencyKey: `${lei}/5` })
        check(c.state === 'succeeded', `cancel ${outcome(c)}`)
        check(cancelResult(c.result), `cancel result: ${formatErrors(cancelResult.errors)}`)
        failedWith((await running).out, 'cancelled')
      } else {
        const { out } = await execute(5)
        check(out.state === 'succeeded', `execute ${outcome(out)}`)
        const { out: c } = await send('cancel', { logicalExecutionId: lei, idempotencyKey: `${lei}/5` })
        check(c.state === 'succeeded', `cancel ${outcome(c)}`)
        check(cancelResult(c.result), `cancel result: ${formatErrors(cancelResult.errors)}`)
      }
    })
    await rule('E10', forProcess, async () => {
      const { out, stream } = await execute(6, { PERSIMMON_CONFORMANCE_AGENT: 'fail' })
      failedWith(out, 'agent_failed', true)
      check(!stream.some((l) => l.event === 'log' && l.text.includes(secret)), 'the secret is in a log line')
      check(!JSON.stringify(out).includes(secret), 'the secret is in the error')
    })
    await rule('E11', isAgent ? (seen ? true : forProcess === true ? 'the program never ran' : forProcess) : 'no agent type', async () => {
      const s = seen!.stdin
      const marks = [...context.map((c) => (c.kind === 'artifact' ? 'Fixture note' : promptText.trim())), instructions]
      const at = marks.map((m) => s.indexOf(m))
      check(at.every((i) => i >= 0), `the prompt lacks ${marks.filter((_, i) => at[i]! < 0).join('; ')}`)
      check(at.every((i, k) => k === 0 || i > at[k - 1]!), 'the prompt is not in context order, instructions last')
    })
    const skillFormat = d.skillFormats[0]
    await rule('E12', skillFormat && contextKinds.has('skill') ? isProcess || 'no agent, script or tool type' : 'no skill format', async () => {
      const skill = { kind: 'skill', name: 'conformance-skill', format: skillFormat, digest: `sha256:${'1'.repeat(64)}`, source: skillSource }
      const missing = await execute(7, {}, { context: [...context, skill] })
      failedWith(missing.out, 'invalid_input', false)
      const skillDir = d.conformance?.skillDir
      if (live || !skillDir) return
      const at = join(workspace, skillDir, skill.name)
      mkdirSync(at, { recursive: true })
      writeFileSync(join(at, 'SKILL.md'), '# conformance-skill\n\nSay the title exactly.\n')
      const wrong = await execute(8, {}, { context: [...context, skill] })
      failedWith(wrong.out, 'skill_digest_mismatch', false)
      const right = await execute(9, {}, { context: [...context, { ...skill, digest: skillDigest(at) }] })
      check(right.out.state === 'succeeded', `with the right digest: ${outcome(right.out)}`)
    })
    await rule('E13', true, async () => {
      const { out } = await send('conformance-unknown-op', {})
      failedWith(out, 'invalid_input')
    })
    await rule('E14', isHuman || 'no human type', async () => {
      const { out, stream } = await execute(10)
      check(out.state === 'succeeded', `execute ${outcome(out)}`)
      check(humanAck(out.result), `result: ${formatErrors(humanAck.errors)}`)
      check(stream.some((l) => l.event === 'waiting' && l.reason === 'human'), 'no waiting stream line with reason human')
    })
    await rule('E15', true, async () => {
      const bad = errors.filter((e) => !errorShape(e))
      check(bad.length === 0, `${bad.length} malformed error(s): ${JSON.stringify(bad[0])}`)
    })
    return verdicts
  } finally {
    await server.close()
    rmSync(dir, { recursive: true, force: true })
  }
}
