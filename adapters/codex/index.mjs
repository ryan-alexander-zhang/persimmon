// codex/v1: runs `codex exec` once per attempt with an output schema (19-adapter-roles.md).
// Authentication is the CLI's own login; bind an openai-api-key credential on the Adapter to override it.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AdapterError, serve } from '../lib/agent.mjs'

const sandbox = { 'read-only': 'read-only', 'workspace-write': 'workspace-write', full: 'danger-full-access' }

/** OpenAI strict structured output: every object closed with all listed properties required; `format` is not accepted (the prompt states it). */
function strict(s) {
  if (Array.isArray(s)) return s.map(strict)
  if (!s || typeof s !== 'object') return s
  const { format, ...rest } = s
  const out = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, k === 'properties' ? Object.fromEntries(Object.entries(v).map(([n, p]) => [n, strict(p)])) : k === 'const' || k === 'enum' ? v : strict(v)]))
  if (out.type === 'object' && out.properties) {
    const required = new Set(out.required ?? Object.keys(out.properties))
    out.properties = Object.fromEntries(Object.entries(out.properties).filter(([n]) => required.has(n))) // optional properties cannot be expressed; drop them
    out.required = Object.keys(out.properties)
    out.additionalProperties = false
  }
  return out
}

serve({
  adapterId: 'codex/v1',
  configurationSchema: {
    type: 'object', additionalProperties: false,
    properties: { model: { type: 'string' }, sandbox: { enum: Object.keys(sandbox) }, profile: { type: 'string' } },
  },
  parametersSchema: { type: 'object', additionalProperties: false, properties: { reasoningEffort: { enum: ['minimal', 'low', 'medium', 'high', 'xhigh'] } } },
  command({ configuration: c, parameters: p, schema, dir }) {
    writeFileSync(join(dir, 'schema.json'), JSON.stringify(strict(schema)))
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--output-schema', join(dir, 'schema.json'), '-o', join(dir, 'answer.json'), '-s', sandbox[c.sandbox ?? 'workspace-write']]
    if (c.sandbox === 'full') args.push('--dangerously-bypass-approvals-and-sandbox')
    if (c.model) args.push('-m', c.model)
    if (c.profile) args.push('-p', c.profile)
    if (p.reasoningEffort) args.push('-c', `model_reasoning_effort="${p.reasoningEffort}"`)
    args.push('-')
    return ['codex', args]
  },
  parse({ dir }) {
    try {
      return JSON.parse(readFileSync(join(dir, 'answer.json'), 'utf8'))
    } catch (e) {
      throw new AdapterError('agent_failed', `codex wrote no JSON answer: ${e.message}`, true)
    }
  },
})
