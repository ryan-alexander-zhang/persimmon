// claude-code/v1: runs `claude -p` once per attempt with structured output (19-adapter-roles.md).
// Authentication is the CLI's own login; bind an anthropic-api-key credential on the Adapter to override it.
import { AdapterError, serve } from '../lib/agent.mjs'

const sandbox = {
  'read-only': ['--restricted', '--permission-mode', 'dontAsk'],
  'workspace-write': ['--permission-mode', 'acceptEdits'],
  full: ['--dangerously-skip-permissions'],
}

/** The `--output-format json` result object, or the agent's own error. */
function result(stdout) {
  let r
  try {
    r = JSON.parse(stdout)
  } catch {
    throw new AdapterError('agent_failed', 'claude printed no JSON result', true)
  }
  if (r.is_error || r.subtype !== 'success') {
    const message = typeof r.result === 'string' ? r.result : String(r.subtype)
    if (/authenticat|not logged in|login|api key/i.test(message)) throw new AdapterError('permission_denied', message, false) // a dead login never heals by retrying
    throw new AdapterError(r.subtype === 'error_max_turns' ? 'timeout' : 'agent_failed', message, true)
  }
  return r
}

serve({
  adapterId: 'claude-code/v1',
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
  command({ configuration: c, parameters: p, schema, skillDirs }) {
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--json-schema', JSON.stringify(schema), ...sandbox[c.sandbox ?? 'workspace-write']]
    for (const d of skillDirs) args.push('--add-dir', d) // skills live outside the working directory
    if (c.model) args.push('--model', c.model)
    if (c.agent) args.push('--agent', c.agent)
    if (c.allowedTools?.length) args.push('--allowedTools', ...c.allowedTools)
    if (p.effort) args.push('--effort', p.effort)
    return ['claude', args]
  },
  parse({ stdout }) {
    const r = result(stdout)
    return r.structured_output ?? JSON.parse(r.result)
  },
  errorFrom(stdout) {
    result(stdout)
  },
})
