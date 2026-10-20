// parity-run/v1: what a script Task of the Rewrite pack answers (40-pack-rewrite.md). A Task with a `sourceIndex` output gets
// the Source system's checkout, its workspace, read into the source index; the Adapter runs in the project directory, so
// the index also says where the project is. It runs no program: `prepare` answers, as testdesign/v1 does.
import { AdapterError, serve } from '../lib/agent.mjs'
import { indexSource } from '../parity/source.mjs'

serve({
  adapterId: 'parity-run/v1',
  executorTypes: ['script'],
  contextKinds: [],
  skillFormats: [],
  configurationSchema: { type: 'object', additionalProperties: false, properties: {} },
  parametersSchema: { type: 'object', additionalProperties: false, properties: {} },
  command: () => {
    throw new AdapterError('invalid_input', 'parity-run/v1 runs no program', false)
  },
  input: () => '',
  async prepare({ payload, workspace }) {
    const ports = Object.keys(payload.task.outputs)
    if (ports.includes('sourceIndex')) {
      if (!payload.workspace) throw new AdapterError('invalid_input', 'index-source reads its workspace, the source checkout: action.workspace names the source input', false)
      try {
        return { outputs: { sourceIndex: indexSource(workspace, process.cwd()) } }
      } catch (e) {
        throw new AdapterError('invalid_input', e.message, false)
      }
    }
    throw new AdapterError('invalid_input', `parity-run/v1 answers a sourceIndex output; this Task declares ${ports.join(', ')}`, false)
  },
})
