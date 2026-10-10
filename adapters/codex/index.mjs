// codex/v1: runs `codex exec` once per attempt with an output schema (19-adapter-roles.md).
// Authentication is the CLI's own login; bind an openai-api-key credential on the Adapter to override it.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AdapterError, serve } from '../lib/agent.mjs'

const sandbox = { 'read-only': 'read-only', 'workspace-write': 'workspace-write', full: 'danger-full-access' }

/** OpenAI strict structured output: closed objects, every property required (optional ones widened with null), `anyOf` only, no `format` (the prompt states it). */
function strict(s) {
  if (!s || typeof s !== 'object') return s
  const { format, oneOf, ...out } = s
  if (oneOf) out.anyOf = oneOf
  for (const k of ['anyOf', 'allOf', 'prefixItems']) if (out[k]) out[k] = out[k].map(strict)
  for (const k of ['items', 'additionalProperties', 'not']) if (typeof out[k] === 'object') out[k] = strict(out[k])
  for (const k of ['properties', '$defs']) if (out[k]) out[k] = Object.fromEntries(Object.entries(out[k]).map(([n, p]) => [n, strict(p)]))
  if (out.type === 'object' && out.properties) {
    const required = new Set(out.required ?? [])
    for (const [n, p] of Object.entries(out.properties)) if (!required.has(n)) out.properties[n] = { anyOf: [p, { type: 'null' }] }
    out.required = Object.keys(out.properties)
    out.additionalProperties = false
  }
  return out
}

/** Optional properties come back as null under strict mode; the engine schema never allows null there. */
function stripNulls(v) {
  if (Array.isArray(v)) return v.map(stripNulls)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, stripNulls(x)]))
  return v
}

serve({
  adapterId: 'codex/v1',
  transcript: true, // the answer is in answer.json; stdout is what the agent did
  skillDir: '.agents/skills', // where codex discovers repository skills
  configurationSchema: {
    type: 'object', additionalProperties: false,
    properties: { model: { type: 'string' }, sandbox: { enum: Object.keys(sandbox) }, profile: { type: 'string' } },
  },
  parametersSchema: { type: 'object', additionalProperties: false, properties: { reasoningEffort: { enum: ['minimal', 'low', 'medium', 'high', 'xhigh'] } } },
  command({ configuration: c, parameters: p, schema, dir, payload }) {
    writeFileSync(join(dir, 'schema.json'), JSON.stringify(strict(schema)))
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--output-schema', join(dir, 'schema.json'), '-o', join(dir, 'answer.json'), '-s', sandbox[c.sandbox ?? 'workspace-write']]
    // security.networkAccess: codex has one switch for the workspace-write sandbox; allowedHosts cannot be narrowed here.
    // Closed unless allowlist; the full sandbox bypass ignores the switch, so deny cannot combine with it.
    const network = payload.executor.security?.networkAccess === 'allowlist'
    if (!network && c.sandbox === 'full') throw new AdapterError('invalid_input', 'sandbox full bypasses the network sandbox; security.networkAccess must be allowlist', false)
    args.push('-c', `sandbox_workspace_write.network_access=${network}`)
    if (c.sandbox === 'full') args.push('--dangerously-bypass-approvals-and-sandbox')
    if (c.model) args.push('-m', c.model)
    if (c.profile) args.push('-p', c.profile)
    if (p.reasoningEffort) args.push('-c', `model_reasoning_effort="${p.reasoningEffort}"`)
    args.push('-')
    return ['codex', args]
  },
  parse({ dir }) {
    try {
      return { outputs: stripNulls(JSON.parse(readFileSync(join(dir, 'answer.json'), 'utf8'))) } // flat schema, one key per port
    } catch (e) {
      throw new AdapterError('agent_failed', `codex wrote no JSON answer: ${e.message}`, true)
    }
  },
})
