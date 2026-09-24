// codex/v1: runs `codex exec` once per attempt with an output schema (19-adapter-roles.md).
// Authentication is the CLI's own login; bind an openai-api-key credential on the Adapter to override it.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AdapterError, serve } from '../lib/agent.mjs'

const sandbox = { 'read-only': 'read-only', 'workspace-write': 'workspace-write', full: 'danger-full-access' }

serve({
  adapterId: 'codex/v1',
  configurationSchema: {
    type: 'object', additionalProperties: false,
    properties: { model: { type: 'string' }, sandbox: { enum: Object.keys(sandbox) }, profile: { type: 'string' } },
  },
  parametersSchema: { type: 'object', additionalProperties: false, properties: { reasoningEffort: { enum: ['minimal', 'low', 'medium', 'high', 'xhigh'] } } },
  command({ configuration: c, parameters: p, schema, dir }) {
    writeFileSync(join(dir, 'schema.json'), JSON.stringify(schema))
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
