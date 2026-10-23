// claude-code/v1: runs `claude -p` once per attempt with structured output (19-adapter-roles.md).
// Authentication is the CLI's own login; bind an anthropic-api-key credential on the Adapter to override it.
import { join } from 'node:path'
import { AdapterError, serve } from '../lib/agent.mjs'

const sandbox = {
  'read-only': ['--restricted', '--permission-mode', 'dontAsk'],
  'workspace-write': ['--permission-mode', 'acceptEdits'],
  full: ['--dangerously-skip-permissions'],
}

/** The `result` event of `--output-format stream-json` (one JSON object per line, the result last), or the agent's own error. */
function result(stdout) {
  let r
  for (const line of stdout.split('\n').reverse()) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line)
      if (o.type === 'result') {
        r = o
        break
      }
    } catch {
      /* a partial or non-JSON line */
    }
  }
  if (!r) throw new AdapterError('agent_failed', 'claude printed no JSON result', true)
  if (r.is_error || r.subtype !== 'success') {
    const message = typeof r.result === 'string' ? r.result : String(r.subtype)
    const dead = /"type":\s*"permission_error"|token has been revoked/i // the API's own phrasing for a login that will not come back, never the agent's prose
    const login = /not logged in|failed to authenticate|authentication_error|session expired|invalid api key|invalid x-api-key/i // the CLI's own login phrasing
    const refused = /API Error: (403|429|5\d\d)\b|overloaded|rate limit/i // the API refused this call, not this login: the Task's retry policy decides
    if (dead.test(message)) throw new AdapterError('permission_denied', message, false)
    if (refused.test(message)) throw new AdapterError('agent_failed', message, true)
    if (login.test(message)) throw new AdapterError('permission_denied', message, false)
    throw new AdapterError(r.subtype === 'error_max_turns' ? 'timeout' : 'agent_failed', message, true)
  }
  return r
}

const shortJson = (v, n = 160) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? ''
  return s.length > n ? `${s.slice(0, n - 3)}...` : s
}

/** One stream-json event as a log line: what the agent said, which tool it called, what came back; any other event as `[type subtype] …`. */
function transcript(line) {
  const e = JSON.parse(line)
  if (e.type === 'assistant') {
    const out = []
    for (const c of e.message?.content ?? []) {
      if (c.type === 'text' && c.text.trim()) out.push(c.text.trim())
      if (c.type === 'tool_use') out.push(`> ${c.name} ${shortJson(c.name === 'Bash' && c.input?.command ? c.input.command : c.input)}`)
    }
    return out.length ? out.join('\n') : undefined
  }
  if (e.type === 'user') {
    const out = []
    for (const c of e.message?.content ?? []) if (c.type === 'tool_result') out.push(`< ${shortJson(Array.isArray(c.content) ? c.content.map((x) => x.text ?? '').join(' ') : c.content)}`)
    return out.length ? out.join('\n') : undefined
  }
  // init, rate limit and result events stay as one line each: a run that ends with none of the above shows whether claude started at all
  const { type, subtype, ...rest } = e
  if (type === 'result') {
    // a denied call named in full: the agent's own session is not kept, so this log is the one place to read it (19-adapter-roles.md)
    const denied = (e.permission_denials ?? []).map((d) => `\n[denied] ${d.tool_name} ${shortJson(d.tool_name === 'Bash' && d.tool_input?.command ? d.tool_input.command : d.tool_input, 400)}`).join('')
    return `[result ${subtype}] ${e.is_error ? shortJson(e.result) : `${e.num_turns ?? '?'} turns, ${e.duration_ms ?? '?'} ms`}${denied}`
  }
  return `[${type}${subtype ? ` ${subtype}` : ''}] ${shortJson(rest, 120)}`
}

serve({
  adapterId: 'claude-code/v1',
  conformance: { configuration: { command: [process.execPath, join(import.meta.dirname, 'conformance.mjs')] } },
  transcript,
  skillDir: '.claude/skills', // where claude discovers repository skills
  configurationSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      model: { type: 'string' },
      sandbox: { enum: Object.keys(sandbox) },
      agent: { type: 'string', description: 'repository subagent name, run as-is' },
      allowedTools: { type: 'array', items: { type: 'string' }, description: 'claude --allowedTools patterns, e.g. "Bash(npm test:*)"; lets workspace-write run commands without a prompt' },
    },
  },
  parametersSchema: { type: 'object', additionalProperties: false, properties: { effort: { enum: ['low', 'medium', 'high', 'xhigh', 'max'] } } },
  command({ configuration: c, parameters: p, schema }) {
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--json-schema', JSON.stringify(schema), ...sandbox[c.sandbox ?? 'workspace-write']]
    if (c.model) args.push('--model', c.model)
    if (c.agent) args.push('--agent', c.agent)
    if (c.allowedTools?.length) args.push('--allowedTools', ...c.allowedTools)
    if (p.effort) args.push('--effort', p.effort)
    return ['claude', args]
  },
  parse({ stdout }) {
    const r = result(stdout)
    if (r.structured_output) return { outputs: r.structured_output } // the schema is flat: one key per port (19-adapter-roles.md)
    try {
      return { outputs: JSON.parse(r.result) }
    } catch {
      throw new AdapterError('agent_failed', 'claude answered no structured output', true)
    }
  },
  errorFrom(stdout) {
    result(stdout)
  },
})
