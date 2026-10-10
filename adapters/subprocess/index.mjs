// subprocess/v1: runs a program once per attempt for script and tool Executors (19-adapter-roles.md, adapter-subprocess.yaml).
// stdin: the execute payload without `credentials` and `engine`; credentials arrive as `<NS>__<NAME>` environment.
// The program writes `{outputs: {<port>: value | artifact content}, summary?}` to `configuration.resultFile`; the Adapter publishes.
import { readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AdapterError, serve } from '../lib/agent.mjs'

serve({
  adapterId: 'subprocess/v1',
  conformance: { configuration: { program: [process.execPath, join(import.meta.dirname, 'conformance.mjs')], resultFile: 'conformance-result.json' } },
  transcript: true, // the answer is the result file; stdout is the program's own output
  executorTypes: ['script', 'tool'],
  contextKinds: ['file'],
  skillFormats: [],
  configurationSchema: { type: 'object', required: ['program', 'resultFile'], additionalProperties: false, properties: { program: { type: 'array', minItems: 1, items: { type: 'string' } }, resultFile: { type: 'string' } } },
  parametersSchema: { type: 'object', additionalProperties: false, properties: { args: { type: 'array', items: { type: 'string' } } } },
  command({ configuration: c, parameters: p }) {
    const [program, ...args] = c.program
    return [program, [...args, ...(p.args ?? [])]]
  },
  input({ payload: { credentials, engine, ...rest } }) {
    return JSON.stringify(rest) + '\n'
  },
  parse({ configuration: c, workspace }) {
    const file = resolve(workspace, c.resultFile) // the program ran there
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch (e) {
      throw new AdapterError('agent_failed', `${c.resultFile}: ${e.message}`, true)
    }
    rmSync(file, { force: true }) // one result per attempt; a stale file must not answer the next one
    try {
      return JSON.parse(text)
    } catch (e) {
      throw new AdapterError('agent_failed', `${c.resultFile} is not JSON: ${e.message}`, true)
    }
  },
})
