// Shared persimmon.adapter/v1 runner for agent Executors (19-adapter-roles.md). A driver names the agent
// command line and parses its final answer; this file owns the protocol: prompt assembly from context,
// structured output schema, artifact publication through the Engine callbacks, cancel by pid file.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import { fetchSkill } from './skills.mjs'

export class AdapterError extends Error {
  constructor(code, message, retryable) {
    super(message)
    this.code = code
    this.retryable = retryable
  }
}

const pidDir = () => join(process.cwd(), '.persimmon', 'agents')
const pidFile = (idempotencyKey) => join(pidDir(), encodeURIComponent(idempotencyKey) + '.pid')
/** `<NS>__<NAME>` upper case, `-` becomes `_`: the same grammar the engine uses for its own credential env. */
const envName = (name) => name.toUpperCase().replaceAll('-', '_').replace('/', '__')

/** driver: {adapterId, executorTypes?, contextKinds?, skillFormats?, configurationSchema, parametersSchema, command(ctx) -> [cmd, args], input?(ctx) -> stdin text, parse({stdout, dir, configuration}) -> {outputs, summary?}, transcript?: true when stdout is the agent's transcript, not its answer} */
export function serve(driver) {
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n')
  createInterface({ input: process.stdin }).once('line', async (line) => {
    let id, op, payload
    try {
      ;({ id, op, payload } = JSON.parse(line))
      const log = (text) => out({ id, event: 'log', text: redact(text, payload?.credentials) })
      switch (op) {
        case 'describe':
          return out({
            id, ok: true,
            result: {
              adapterId: driver.adapterId, protocol: 'persimmon.adapter/v1', roles: ['executor'], executorTypes: driver.executorTypes ?? ['agent'],
              configurationSchema: driver.configurationSchema, parametersSchema: driver.parametersSchema,
              contextKinds: driver.contextKinds ?? ['file', 'artifact', 'prompt', 'skill'], skillFormats: driver.skillFormats ?? ['claude-code-skill/v1'], supports: { query: false, cancel: true, complete: false }, formRenderable: false,
            },
          })
        case 'execute':
          out({ id, event: 'waiting', reason: driver.executorTypes?.[0] ?? 'agent' })
          return out({ id, ok: true, result: await execute(driver, payload, log) })
        case 'cancel':
          return out({ id, ok: true, result: { state: cancel(payload.idempotencyKey) } })
        default:
          throw new AdapterError('invalid_input', `unknown op ${op}`, false)
      }
    } catch (e) {
      const code = e instanceof AdapterError ? e.code : 'agent_failed'
      out({ id, ok: false, error: { code, message: e.message, retryable: e instanceof AdapterError ? e.retryable : true } })
    }
  })
}

async function execute(driver, payload, log) {
  const { task, taskRun, inputs, context, executor, credentials, engine, deadline } = payload
  const call = callbacks(engine)
  const configuration = executor.configuration ?? {}
  const schema = outputSchema(task)
  const dir = mkdtempSync(join(tmpdir(), 'persimmon-agent-'))
  let answer
  try {
    const skills = driver.input ? [] : resolveSkills(context, driver.skillFormats ?? ['claude-code-skill/v1'])
    const ctx = { configuration, parameters: task.parameters ?? {}, schema, dir, payload, skillDirs: skills.map((s) => s.dir) }
    const [cmd, args] = driver.command(ctx)
    const stdin = driver.input ? driver.input(ctx) : await buildPrompt(task, inputs, context, call, skills)
    let stdout
    try {
      stdout = await run(cmd, args, stdin, { credentials, deadline, idempotencyKey: taskRun.idempotencyKey, log, transcript: driver.transcript })
    } catch (e) {
      if (e.stdout?.trim()) driver.errorFrom?.(e.stdout) // throws the agent's own error message when it printed one
      throw e
    }
    answer = driver.parse({ stdout, dir, configuration })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  if (!answer?.outputs || typeof answer.outputs !== 'object') throw new AdapterError('agent_failed', 'agent answer has no outputs object', true)
  const artifactInputs = Object.values(inputs).filter((v) => v.kind === 'artifact').map((v) => v.ref)
  const outputs = {}
  for (const [port, spec] of Object.entries(task.outputs)) {
    const value = answer.outputs[port]
    if (value === undefined) continue // the task Handler reports the missing port as schema_violation
    if (spec.type.kind !== 'artifact') {
      outputs[port] = { kind: 'value', value }
      continue
    }
    const blob = await call('putBlob', { bytes: Buffer.from(JSON.stringify(value)).toString('base64'), mediaType: 'application/json' })
    const ref = await call('publishArtifact', { kind: spec.type.artifactKind, id: artifactId(taskRun.logicalExecutionId, port), content: value, inputs: artifactInputs, representations: [{ name: 'json', mediaType: 'application/json', digest: blob.digest }] })
    outputs[port] = { kind: 'artifact', ref }
  }
  const result = { protocol: 'persimmon.result/v1', outputs }
  if (typeof answer.summary === 'string') result.summary = answer.summary
  return result
}

/** Every skill entry fetched and verified before the agent starts (15-prompt-skill.md); the format must be one this Adapter reads. */
function resolveSkills(context, formats) {
  return context
    .filter((c) => c.kind === 'skill')
    .map((c) => {
      if (!formats.includes(c.format)) throw new AdapterError('invalid_input', `skill ${c.name}: format ${c.format} is not supported by this Adapter`, false)
      return { entry: c, dir: fetchSkill(c, join(process.cwd(), '.persimmon', 'skills')) }
    })
}

/** Context entries in order, then inputs, then instructions (12-task.md). Artifacts are fetched with the call token. */
async function buildPrompt(task, inputs, context, call, skills = []) {
  const parts = []
  for (const c of context) {
    switch (c.kind) {
      case 'skill': {
        const { dir } = skills.find((s) => s.entry === c)
        parts.push(`## Skill ${c.name}\n\nRead \`${dir}/SKILL.md\` and follow it for this task. The skill directory is \`${dir}\`.`)
        break
      }
      case 'prompt':
        parts.push(c.content.trimEnd())
        break
      case 'artifact': {
        const a = await call('getArtifact', c.ref)
        parts.push(`## ${c.ref.kind} ${c.ref.id} revision ${c.ref.revision}\n\n\`\`\`json\n${JSON.stringify(a.spec.content, null, 2)}\n\`\`\``)
        break
      }
      case 'file':
        parts.push(`## File ${c.path}\n\nRead \`${c.path}\` in the working directory. Source: ${JSON.stringify(c.ref)}.`)
        break
      default:
        throw new AdapterError('invalid_input', `context kind ${c.kind} is not supported by this Adapter`, false)
    }
  }
  const values = Object.entries(inputs).filter(([, v]) => v.kind !== 'artifact')
  if (values.length) parts.push(`## Inputs\n\n\`\`\`json\n${JSON.stringify(Object.fromEntries(values.map(([k, v]) => [k, v.kind === 'value' ? v.value : v.ref])), null, 2)}\n\`\`\``)
  parts.push(`## Instructions\n\n${task.instructions}`)
  const schemas = Object.entries(outputSchema(task).properties.outputs.properties).map(([port, s]) => `\`outputs.${port}\`:\n\n\`\`\`json\n${JSON.stringify(s, null, 2)}\n\`\`\``)
  parts.push(`## Answer\n\nAnswer with one JSON object: \`outputs.<port>\` for every output port (${Object.keys(task.outputs).join(', ')}), plus a short \`summary\`. No prose outside the JSON. Each output must validate against its JSON Schema, string formats included (a \`format: uri\` string is an absolute URL).\n\n${schemas.join('\n\n')}`)
  return parts.join('\n\n') + '\n'
}

/** One identity per logical execution and port: `<run>/<iteration>/<step>` + port as a DNS label (revisioned.yaml Id). */
function artifactId(logicalExecutionId, port) {
  const slug = `${logicalExecutionId}-${port}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.length <= 63 ? slug : `${slug.slice(0, 50)}-${createHash('sha256').update(slug).digest('hex').slice(0, 12)}`
}

/** Credential values never reach a log line, whatever the agent echoed (07-adapter.md). */
function redact(text, credentials) {
  for (const v of Object.values(credentials ?? {})) if (v) text = text.split(v).join('[redacted]')
  return text
}

/** Structured output: artifact ports take the frozen content schema, value ports their port schema. */
function outputSchema(task) {
  const properties = {}
  for (const [port, spec] of Object.entries(task.outputs))
    properties[port] = spec.type.kind === 'artifact' ? task.outputSchemas[port] ?? { type: 'object' } : spec.type.schema ?? {}
  return {
    type: 'object', required: ['outputs'], additionalProperties: false,
    properties: { outputs: { type: 'object', required: Object.keys(properties), additionalProperties: false, properties }, summary: { type: 'string' } },
  }
}

/** Whole lines of the agent's own output become `log` stream lines, at most `maxLogLines` per attempt; the store keeps them beside the call (07-adapter.md). */
export const maxLogLines = 500
function lineLogger(log) {
  let buf = ''
  let n = 0
  return (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (!line.trim()) continue
      if (++n > maxLogLines) continue
      log(n === maxLogLines ? `${line}\n[log capped at ${maxLogLines} lines]` : line)
    }
  }
}

/** One agent process per attempt; pid recorded for cancel; killed at the deadline, on cancel, or when this process is killed. */
function run(cmd, args, prompt, { credentials, deadline, idempotencyKey, log, transcript }) {
  const env = { ...process.env }
  delete env.PERSIMMON_ADAPTER_TOKEN
  for (const [name, secret] of Object.entries(credentials ?? {})) env[envName(name)] = secret
  const left = deadline ? Date.parse(deadline) - Date.now() : Infinity
  if (!(left > 0)) return Promise.reject(new AdapterError('timeout', 'attempt deadline already passed', true))
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'pipe'] })
    mkdirSync(pidDir(), { recursive: true })
    const pid = pidFile(idempotencyKey)
    const mine = () => existsSync(pid) && readFileSync(pid, 'utf8') === String(child.pid)
    const stop = () => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5000).unref()
    }
    process.once('SIGTERM', stop)
    let timedOut = false
    const timer = left < Infinity ? setTimeout(() => ((timedOut = true), stop()), left) : undefined
    let stdout = ''
    let stderr = ''
    const tap = lineLogger(log)
    child.stdout.setEncoding('utf8').on('data', (c) => ((stdout += c), transcript && tap(c)))
    child.stderr.setEncoding('utf8').on('data', (c) => ((stderr += c), tap(c)))
    child.on('spawn', () => writeFileSync(pid, String(child.pid)))
    child.on('error', (e) => {
      clearTimeout(timer)
      process.off('SIGTERM', stop)
      reject(e.code === 'ENOENT' || e.code === 'EACCES' ? new AdapterError('invalid_input', `${cmd}: ${e.message}`, false) : e)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      process.off('SIGTERM', stop)
      const cancelled = !mine() // cancel removed the file first; a stale file from another attempt is left alone
      if (mine()) unlinkSync(pid)
      if (timedOut) return reject(new AdapterError('timeout', `${cmd} exceeded the deadline`, true))
      if (cancelled) return reject(new AdapterError('cancelled', `${cmd} was cancelled`, false))
      tap('\n')
      if (code !== 0) {
        const e = new AdapterError('agent_failed', `${cmd} exited with ${code ?? signal}`, true)
        e.stdout = stdout // the driver may read a better message out of it
        return reject(e)
      }
      resolve(stdout)
    })
    child.stdin.on('error', () => {})
    child.stdin.end(prompt)
  })
}

/** cancel removes the pid file first, so the exiting run reports `cancelled` rather than a failure. */
function cancel(idempotencyKey) {
  const pid = pidFile(idempotencyKey)
  if (!existsSync(pid)) return 'unknown'
  const n = Number(readFileSync(pid, 'utf8'))
  unlinkSync(pid)
  if (!Number.isInteger(n) || n <= 0) return 'unknown' // never signal the process group
  try {
    process.kill(n, 'SIGTERM')
  } catch {
    return 'unknown'
  }
  return 'cancelled'
}

export function callbacks(engine) {
  const socketPath = engine.endpoint.replace(/^unix:\/\//, '')
  return (name, args) =>
    new Promise((resolve, reject) => {
      const r = request({ socketPath, path: `/callbacks/${name}`, method: 'POST', headers: { authorization: `Bearer ${engine.token}`, 'content-type': 'application/json' } }, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          let body
          try {
            body = JSON.parse(data)
          } catch {
            return reject(new AdapterError('transient_network', `${name}: bad engine response`, true))
          }
          if (!body.error) return resolve(body.result)
          const { code, message } = body.error
          // engine refusals are final; anything else (500, socket) may pass on retry
          const mapped =
            code === 'unauthorized' || code === 'forbidden' ? 'permission_denied'
            : code === 'invalid_input' || code === 'not_found' ? (name === 'publishArtifact' ? 'schema_violation' : 'invalid_input')
            : 'transient_network'
          reject(new AdapterError(mapped, `${name}: ${message}`, mapped === 'transient_network'))
        })
      })
      r.on('error', (e) => reject(new AdapterError('transient_network', `${name}: ${e.message}`, true)))
      r.end(JSON.stringify(args))
    })
}
