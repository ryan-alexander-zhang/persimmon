// claude-code/v1: runs `claude -p` once per attempt with structured output (19-adapter-roles.md).
// Authentication is the CLI's own login; bind an anthropic-api-key credential on the Adapter to override it.
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
    if (/not logged in|failed to authenticate|authentication_error|invalid api key|invalid x-api-key/i.test(message)) throw new AdapterError('permission_denied', message, false) // the CLI's own login phrasing, not the agent's prose
    throw new AdapterError(r.subtype === 'error_max_turns' ? 'timeout' : 'agent_failed', message, true)
  }
  return r
}

const shortJson = (v, n = 160) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? ''
  return s.length > n ? `${s.slice(0, n - 3)}...` : s
}

/** One stream-json event as a log line: what the agent said, which tool it called, what came back. Everything else is dropped. */
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
  return undefined // system, result, rate limit events
}

serve({
  adapterId: 'claude-code/v1',
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
