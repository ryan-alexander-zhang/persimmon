// Shared persimmon.adapter/v1 runner for agent Executors (19-adapter-roles.md). A driver names the agent
// command line and parses its final answer; this file owns the protocol: prompt assembly from context,
// structured output schema, artifact publication through the Engine callbacks, cancel by pid file.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { constants as osConstants, tmpdir } from 'node:os'
import { extname, join, relative } from 'node:path'
import { createInterface } from 'node:readline'
import { createHash } from 'node:crypto'
import { skillDigest } from './skills.mjs'

export class AdapterError extends Error {
  constructor(code, message, retryable) {
    super(message)
    this.code = code
    this.retryable = retryable
  }
}

const pidDir = () => join(process.cwd(), '.persimmon', 'agents')
const pidFile = (idempotencyKey) => join(pidDir(), encodeURIComponent(idempotencyKey) + '.pid')
// A file the agent leaves beside an output becomes a representation of the published revision (18-artifact.md): its name
// the file's stem as a DNS label (`Test_Report.v2.html`: `test-report-v2`); its media type from the extension, else
// application/octet-stream. `json` is the content's own. Regular files of one flat directory per port; a dotfile is skipped.
const mediaTypes = { html: 'text/html', htm: 'text/html', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', md: 'text/markdown', txt: 'text/plain', csv: 'text/csv', css: 'text/css', js: 'text/javascript', mmd: 'text/vnd.mermaid', json: 'application/json', yaml: 'application/yaml', yml: 'application/yaml', xml: 'application/xml' }
const maxFileBytes = 8 * 1024 * 1024 // ponytail: one cap for every file, the blob rides base64 over the callback; a streamed put when a Design ships a video
const label = (stem) => stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const filesOf = (dir, where, log) => {
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (e) {
    if (e.code === 'ENOENT') return [] // no directory: no files
    throw new AdapterError('agent_failed', `${where}: ${e.message}`, true)
  }
  const seen = new Map()
  const out = []
  for (const e of entries.map((e) => e.name).sort().map((n) => entries.find((e) => e.name === n))) {
    if (e.name.startsWith('.')) continue
    if (!e.isFile()) {
      log(`${where}/${e.name}: not a regular file, not a representation`)
      continue
    }
    const ext = extname(e.name)
    const name = label(e.name.slice(0, e.name.length - ext.length))
    if (!name || name === 'json' || name.length > 63) throw new AdapterError('agent_failed', `${where}/${e.name}: a representation's name is its file stem as a DNS label, never json or empty`, true)
    if (seen.has(name)) throw new AdapterError('agent_failed', `${where}/${e.name}: named ${name} like ${seen.get(name)}`, true)
    seen.set(name, e.name)
    const size = statSync(join(dir, e.name)).size
    if (size > maxFileBytes) throw new AdapterError('agent_failed', `${where}/${e.name}: ${size} bytes is over the ${maxFileBytes} cap`, true)
    out.push({ name, mediaType: mediaTypes[ext.slice(1).toLowerCase()] ?? 'application/octet-stream', bytes: readFileSync(join(dir, e.name)) })
  }
  return out
}

/** `<NS>__<NAME>` upper case, `-` becomes `_`: the same grammar the engine uses for its own credential env. */
const envName = (name) => name.toUpperCase().replaceAll('-', '_').replace('/', '__')

/** driver: {adapterId, executorTypes?, contextKinds?, skillFormats?, configurationSchema, parametersSchema, conformance?: {configuration} the suite sends when the user passes none (22-conformance.md), command(ctx) -> [cmd, args], input?(ctx) -> stdin text, skillDir?: where the CLI discovers skills, relative to the workspace (`.claude/skills`), parse({stdout, stderr, exitCode, dir, configuration, workspace, payload}) -> {outputs, summary?} or {next: [cmd, args]}, another program to run before the answer, or a promise of either, prepare?(ctx): awaited in the workspace before the command is chosen, ctx.call the Engine callback; an answer it returns stands in for running the program, anyExit?: true when the program's exit code is part of its answer, never a failure (`junit/v1`), transcript?: true when stdout is the agent's transcript, or (line) -> text | undefined to turn a structured stdout line into a log line} */
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
              ...(driver.conformance ? { conformance: { ...driver.conformance, ...(driver.skillDir ? { skillDir: driver.skillDir } : {}) } } : {}),
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
  const { workspace } = payload
  const cwd = workspace ?? process.cwd() // the Task's workspace (12-task.md); .persimmon/ state stays under the engine's cwd
  if (workspace && !(existsSync(workspace) && statSync(workspace).isDirectory())) throw new AdapterError('invalid_input', `workspace ${workspace} is not a directory`, false)
  // the files directory: inside the workspace, where a workspace-write sandbox lets the agent write; fresh per attempt, gone after;
  // none when the agent reads only, answers a program's payload (subprocess/v1) or has no artifact port
  const ports = Object.entries(payload.task.outputs).filter(([, s]) => s.type.kind === 'artifact' || s.type.kind === 'artifacts').map(([p]) => p)
  const files = !driver.input && ports.length && payload.executor.configuration?.sandbox !== 'read-only' ? mkdtempSync(join(cwd, '.persimmon-files-')) : undefined
  if (files) writeFileSync(join(files, '.gitignore'), '*\n') // a kill skips the cleanup; what stays is not the workspace's
  try {
    return await attempt(driver, payload, log, cwd, files, ports)
  } finally {
    if (files) rmSync(files, { recursive: true, force: true })
  }
}

async function attempt(driver, payload, log, cwd, files, ports) {
  const { task, taskRun, inputs, context, executor, credentials, engine, deadline } = payload
  const call = callbacks(engine)
  const configuration = executor.configuration ?? {}
  const schema = outputSchema(task)
  const dir = mkdtempSync(join(tmpdir(), 'persimmon-agent-'))
  // the files the agent left per port, `<files>/<port>/` or `<files>/<port>/<n>/` for a list item
  const filesFor = (port, n) => (files ? filesOf(n === undefined ? join(files, port) : join(files, port, String(n)), n === undefined ? port : `${port}/${n}`, log) : [])
  let answer
  try {
    if (!driver.input) checkSkills(context, driver.skillFormats ?? ['claude-code-skill/v1'], cwd, driver.skillDir ?? '.claude/skills', log)
    const ctx = { configuration, parameters: task.parameters ?? {}, schema, dir, payload, workspace: cwd, call }
    // before the command is chosen, so it can choose it; an answer here stands in for running the program (36-test-levels.md)
    answer = await driver.prepare?.(ctx)
    if (!answer) {
      let [cmd, args] = driver.command(ctx)
      if (configuration.command) {
        // the conformance suite's stand-in for the CLI; never honoured for an applied Executor (22-conformance.md)
        if (process.env.PERSIMMON_ADAPTER_CONFORMANCE !== '1') throw new AdapterError('invalid_input', 'configuration.command is honoured only by the conformance suite', false)
        if (!Array.isArray(configuration.command) || !configuration.command.length || !configuration.command.every((s) => typeof s === 'string' && s)) throw new AdapterError('invalid_input', 'configuration.command must be a non-empty array of strings', false)
        const [program, ...pre] = configuration.command
        ;[cmd, args] = [program, [...pre, ...args]]
      }
      const stdin = driver.input ? driver.input(ctx) : await buildPrompt(task, inputs, context, call, driver.skillDir ?? '.claude/skills', files, ports)
      for (;;) {
        let ran
        try {
          ran = await run(cmd, args, stdin, { credentials, deadline, idempotencyKey: taskRun.idempotencyKey, log, transcript: driver.transcript, cwd, anyExit: driver.anyExit })
        } catch (e) {
          if (e.stdout?.trim()) driver.errorFrom?.(e.stdout) // throws the agent's own error message when it printed one
          throw e
        }
        answer = await driver.parse({ ...ran, dir, configuration, workspace: cwd, payload })
        if (!answer?.next) break
        ;[cmd, args] = answer.next // one more program toward the same answer, under the same deadline (36-test-levels.md)
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  if (!answer?.outputs || typeof answer.outputs !== 'object') throw new AdapterError('agent_failed', 'agent answer has no outputs object', true)
  const refs = Object.values(inputs).flatMap((v) => (v.kind === 'artifact' ? [v.ref] : v.kind === 'artifacts' ? v.refs : []))
  const artifactInputs = [...new Map(refs.map((r) => [JSON.stringify(r), r])).values()] // every revision read lands in provenance, once
  const outputs = {}
  for (const [port, spec] of Object.entries(task.outputs)) {
    const value = answer.outputs[port]
    if (value === undefined) continue // the task Handler reports the missing port as schema_violation
    if (spec.type.kind !== 'artifact' && spec.type.kind !== 'artifacts') {
      outputs[port] = { kind: 'value', value }
      continue
    }
    const publish = async (content, id, files) => {
      const representations = []
      for (const f of [{ name: 'json', mediaType: 'application/json', bytes: Buffer.from(JSON.stringify(content)) }, ...files]) {
        const blob = await call('putBlob', { bytes: f.bytes.toString('base64'), mediaType: f.mediaType })
        representations.push({ name: f.name, mediaType: f.mediaType, digest: blob.digest })
      }
      return call('publishArtifact', { kind: spec.type.artifactKind, id, content, inputs: artifactInputs, representations })
    }
    if (spec.type.kind === 'artifacts') {
      // a list of contents, published in order as <prefix>-<n> under the Task's chosen prefix (12-task.md)
      if (!Array.isArray(value)) throw new AdapterError('agent_failed', `${port}: an artifacts output is a list`, true)
      const prefix = task.outputIds?.[port] ?? artifactId(taskRun.logicalExecutionId, port)
      const refs = []
      for (const [i, item] of value.entries()) refs.push(await publish(item, `${prefix}-${i + 1}`, filesFor(port, i + 1)))
      outputs[port] = { kind: 'artifacts', refs }
      continue
    }
    const id = task.outputIds?.[port] ?? artifactId(taskRun.logicalExecutionId, port) // the Task's chosen identity, else one per logical execution and port
    outputs[port] = { kind: 'artifact', ref: await publish(value, id, filesFor(port)) }
  }
  const result = { protocol: 'persimmon.result/v1', outputs }
  if (typeof answer.summary === 'string') result.summary = answer.summary
  return result
}

/** Every declared Skill is installed in the workspace (`persimmon skill install`) with the declared digest; the Adapter verifies and never writes (15-prompt-skill.md). Skills present but undeclared are logged. */
function checkSkills(context, formats, workspace, skillDir, log) {
  const declared = context.filter((c) => c.kind === 'skill')
  for (const c of declared) {
    if (!formats.includes(c.format)) throw new AdapterError('invalid_input', `skill ${c.name}: format ${c.format} is not supported by this Adapter`, false)
    const at = join(workspace, skillDir, c.name)
    const into = relative(process.cwd(), workspace) || '.'
    if (!existsSync(at)) throw new AdapterError('invalid_input', `skill ${c.name}: not installed at ${skillDir}/${c.name}; run persimmon skill install ${c.name} --into ${into}`, false)
    let actual
    try {
      actual = skillDigest(at)
    } catch (e) {
      throw new AdapterError('invalid_input', `skill ${c.name} at ${skillDir}/${c.name}: ${e.message}`, false)
    }
    if (actual !== c.digest) throw new AdapterError('skill_digest_mismatch', `skill ${c.name}: installed bundle digest ${actual} differs from ${c.digest}; run persimmon skill install ${c.name} --into ${into}`, false)
  }
  let present = []
  try {
    present = readdirSync(join(workspace, skillDir), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) // a stray file is not a skill
  } catch {
    /* no skill directory */
  }
  const extra = present.filter((n) => !declared.some((c) => c.name === n))
  if (extra.length) log(`workspace skills not declared by this Task: ${extra.join(', ')}`)
}

/** Context entries in order, then inputs, then instructions (12-task.md). Artifacts are fetched with the call token. */
async function buildPrompt(task, inputs, context, call, skillDir = '.claude/skills', files, ports = []) {
  const parts = []
  for (const c of context) {
    switch (c.kind) {
      case 'skill': {
        parts.push(`## Skill ${c.name}\n\nThe skill \`${c.name}\` is installed at \`${skillDir}/${c.name}\` in the working directory. Use it for this task.`)
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
  const values = Object.entries(inputs).filter(([, v]) => v.kind !== 'artifact' && v.kind !== 'artifacts') // artifacts are context entries, not Inputs
  if (values.length) parts.push(`## Inputs\n\n\`\`\`json\n${JSON.stringify(Object.fromEntries(values.map(([k, v]) => [k, v.kind === 'value' ? v.value : v.ref])), null, 2)}\n\`\`\``)
  parts.push(`## Instructions\n\n${task.instructions}`)
  // each port prints with its own hoisted definitions, under the hoisted keys its `$ref`s name, so the prose stands alone
  const { properties, $defs = {} } = outputSchema(task)
  const schemas = Object.entries(properties).map(([port, s]) => {
    const own = Object.entries($defs).filter(([name]) => name.startsWith(`${port}.`))
    const shown = own.length ? { ...s, $defs: Object.fromEntries(own) } : s
    return `\`${port}\`:\n\n\`\`\`json\n${JSON.stringify(shown, null, 2)}\n\`\`\``
  })
  const dirs = ports.map((p) => `\`${files}/${p}/\`${task.outputs[p].type.kind === 'artifacts' ? ` (\`${files}/${p}/<n>/\` for its n-th item, from 1)` : ''}`)
  const filesNote = files ? ` A file that belongs to an output (a rendered HTML, a mockup image, a diagram) goes in ${dirs.join(', ')}: flat, no subdirectory, one file per name, named \`<stem>.<ext>\` with a lowercase stem of letters, digits and hyphens (\`screens.png\`, \`report.html\`; never \`json\`) and an extension that says the type (html, png, svg, pdf, md, mmd, csv). Each becomes a representation of the published revision. The JSON answer is the content itself; a file never stands in for it.` : ''
  parts.push(`## Answer\n\nAnswer with one JSON object: one key per output port (${Object.keys(task.outputs).join(', ')}), nothing else, no wrapper key. No prose outside the JSON. Each output must validate against its JSON Schema, string formats included (a \`format: uri\` string is an absolute URL).${filesNote}\n\n${schemas.join('\n\n')}`)
  return parts.join('\n\n') + '\n'
}

/** One identity per logical execution and port: `<run>/<iteration>/<step>` + port as a DNS label (revisioned.yaml Id). */
function artifactId(logicalExecutionId, port) {
  const slug = `${logicalExecutionId}-${port}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.length <= 63 ? slug : `${slug.slice(0, 50)}-${createHash('sha256').update(slug).digest('hex').slice(0, 12)}`
}

/** Credential values never reach a log line, whatever the agent echoed (07-adapter.md). Log lines are single lines, so every line of a multi-line secret (a PEM key) is redacted on its own. */
export function redact(text, credentials) {
  for (const v of Object.values(credentials ?? {}))
    for (const part of String(v ?? '').split('\n')) if (part.trim().length >= 8) text = text.split(part).join('[redacted]')
  return text
}

/** Structured output: artifact ports take the frozen content schema, an artifacts port a list of it, value ports their port schema. */
export function outputSchema(task) {
  const properties = {}
  const $defs = {}
  for (const [port, spec] of Object.entries(task.outputs)) {
    const content = () => hoistDefs(task.outputSchemas[port] ?? { type: 'object' }, port, $defs)
    properties[port] = spec.type.kind === 'artifact' ? content() : spec.type.kind === 'artifacts' ? { type: 'array', maxItems: 999, items: content() } : hoistDefs(spec.type.schema ?? {}, port, $defs) // 999: a 59-char prefix plus -<n> stays an Id
  }
  // flat: one top-level key per port, no wrapper and no summary; a nested `outputs` and a second `summary` made claude misplace keys (19-adapter-roles.md)
  return { type: 'object', required: Object.keys(properties), additionalProperties: false, properties, ...(Object.keys($defs).length ? { $defs } : {}) }
}

/** A kind schema's `#/$defs/X` resolves from the root; nested under a port key it does not, and the CLI refuses it. Each port's $defs move to the root as `<port>.X`, every `$ref` rewritten. */
function hoistDefs(schema, port, $defs) {
  if (!schema || typeof schema !== 'object' || !schema.$defs) return schema
  const { $defs: own, ...rest } = schema
  for (const [name, def] of Object.entries(own)) $defs[`${port}.${name}`] = rewrite(def, port)
  return rewrite(rest, port)
}
function rewrite(node, port) {
  if (Array.isArray(node)) return node.map((n) => rewrite(n, port))
  if (!node || typeof node !== 'object') return node
  const out = {}
  for (const [k, v] of Object.entries(node)) out[k] = k === '$ref' && typeof v === 'string' && v.startsWith('#/$defs/') ? `#/$defs/${port}.${v.slice('#/$defs/'.length)}` : rewrite(v, port)
  return out
}

/** Whole lines of the agent's own output become `log` stream lines, ANSI escapes stripped, at most `maxLogLines` per stream per attempt; `map` turns a line into log text or drops it (undefined). The store keeps them beside the call (07-adapter.md). */
export const maxLogLines = 5000
const tailBytes = 1 << 20
function lineLogger(log, map = (line) => line) {
  let buf = ''
  let n = 0
  return (chunk) => {
    buf += chunk
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const raw = buf.slice(0, i).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '') // terminal colours mean nothing in a log
      buf = buf.slice(i + 1)
      if (!raw.trim()) continue
      let line
      try {
        line = map(raw)
      } catch {
        line = raw // a mapper that chokes on a line still leaves the line
      }
      if (line === undefined || !String(line).trim()) continue
      if (++n > maxLogLines) continue
      log(n === maxLogLines ? `${line}\n[log capped at ${maxLogLines} lines]` : String(line))
    }
  }
}

/** One agent process per attempt; pid recorded for cancel; killed at the deadline, on cancel, or when this process is killed. */
function run(cmd, args, prompt, { credentials, deadline, idempotencyKey, log, transcript, cwd, anyExit }) {
  const env = { ...process.env }
  delete env.PERSIMMON_ADAPTER_TOKEN
  for (const [name, secret] of Object.entries(credentials ?? {})) env[envName(name)] = secret
  const left = deadline ? Date.parse(deadline) - Date.now() : Infinity
  if (!(left > 0)) return Promise.reject(new AdapterError('timeout', 'attempt deadline already passed', true))
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    mkdirSync(pidDir(), { recursive: true })
    const pid = pidFile(idempotencyKey)
    const mine = () => existsSync(pid) && readFileSync(pid, 'utf8') === String(child.pid)
    const stop = () => {
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5000).unref()
    }
    let stopped = false // this process was told to stop: the program's exit is no answer, whatever anyExit says
    const onSigterm = () => ((stopped = true), stop())
    process.once('SIGTERM', onSigterm)
    let timedOut = false
    const timer = left < Infinity ? setTimeout(() => ((timedOut = true), stop()), left) : undefined
    let stdout = ''
    let stderr = ''
    const tapErr = lineLogger(log)
    const tapOut = transcript ? lineLogger(log, typeof transcript === 'function' ? transcript : undefined) : () => {}
    // ponytail: under anyExit only the last tailBytes are kept (a test suite's log can be gigabytes); a driver needing all of it lifts the cap
    const keep = (buf, c) => (anyExit ? (buf + c).slice(-tailBytes) : buf + c)
    child.stdout.setEncoding('utf8').on('data', (c) => ((stdout = keep(stdout, c)), tapOut(c)))
    child.stderr.setEncoding('utf8').on('data', (c) => ((stderr = keep(stderr, c)), tapErr(c)))
    child.on('spawn', () => writeFileSync(pid, String(child.pid)))
    child.on('error', (e) => {
      clearTimeout(timer)
      process.off('SIGTERM', onSigterm)
      reject(e.code === 'ENOENT' || e.code === 'EACCES' ? new AdapterError('invalid_input', `${cmd}: ${e.message}`, false) : e)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      process.off('SIGTERM', onSigterm)
      const cancelled = !mine() // cancel removed the file first; a stale file from another attempt is left alone
      if (mine()) unlinkSync(pid)
      tapOut('\n') // flush the partial last lines, the most telling ones when the agent was killed
      tapErr('\n')
      if (timedOut) return reject(new AdapterError('timeout', `${cmd} exceeded the deadline`, true))
      if (cancelled) return reject(new AdapterError('cancelled', `${cmd} was cancelled`, false))
      if (stopped) return reject(new AdapterError('agent_failed', `${cmd} was stopped with the Adapter`, true))
      // a signal is 128 plus its number, the shell's convention, so a killed program still has an exit code
      const exitCode = code ?? 128 + (osConstants.signals[signal] ?? 0)
      if (exitCode !== 0 && !anyExit) {
        const e = new AdapterError('agent_failed', `${cmd} exited with ${code ?? signal}`, true)
        e.stdout = stdout // the driver may read a better message out of it
        return reject(e)
      }
      resolve({ stdout, stderr, exitCode })
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
