// claude-code/v1: runs `claude -p` once per attempt with structured output (19-adapter-roles.md).
// Authentication is the CLI's own login; bind an anthropic-api-key credential on the Adapter to override it.
import { AdapterError, serve } from '../lib/agent.mjs'

const sandbox = {
  'read-only': ['--restricted', '--permission-mode', 'dontAsk'],
  'workspace-write': ['--permission-mode', 'acceptEdits'],
  full: ['--dangerously-skip-permissions'],
}

serve({
  adapterId: 'claude-code/v1',
  configurationSchema: {
    type: 'object', additionalProperties: false,
    properties: { model: { type: 'string' }, sandbox: { enum: Object.keys(sandbox) }, agent: { type: 'string', description: 'repository subagent name, run as-is' } },
  },
  parametersSchema: { type: 'object', additionalProperties: false, properties: { effort: { enum: ['low', 'medium', 'high', 'xhigh', 'max'] } } },
  command({ configuration: c, parameters: p, schema }) {
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--json-schema', JSON.stringify(schema), ...sandbox[c.sandbox ?? 'workspace-write']]
    if (c.model) args.push('--model', c.model)
    if (c.agent) args.push('--agent', c.agent)
    if (p.effort) args.push('--effort', p.effort)
    return ['claude', args]
  },
  parse({ stdout }) {
    let r
    try {
      r = JSON.parse(stdout)
    } catch {
      throw new AdapterError('agent_failed', 'claude printed no JSON result', true)
    }
    if (r.is_error || r.subtype !== 'success') throw new AdapterError(r.subtype === 'error_max_turns' ? 'timeout' : 'agent_failed', typeof r.result === 'string' ? r.result : r.subtype, true)
    return r.structured_output ?? JSON.parse(r.result)
  },
})
