// parity-run/v1: what a script Task of the Rewrite pack answers (40-pack-rewrite.md). A Task with a `sourceIndex` output gets
// the Source system's checkout, its workspace, read into the source index; the Adapter runs in the project directory, so
// the index also says where the project is. A Task with `runs` and `coverage` outputs, run-source, runs each suite level that
// runs on the source (`app`, `units`) in the project, its reset first, with the checkout's path in PERSIMMON_SOURCE, and
// answers each level's tests and observations and the source's coverage mapped onto the index. A red suite is an answer,
// never a failure: the ledger records it.
import { AdapterError, redact, serve } from '../lib/agent.mjs'
import { clearLevel, mergeCoverage, readLevel } from '../parity/runs.mjs'
import { indexSource, sourceState } from '../parity/source.mjs'

const onSource = ['app', 'units'] // records run against the rewrite only

// one attempt per Adapter process: the commands still to run and what the levels answered
let state

/** The next command, or with none left the Task's answer. Reports were cleared in prepare, before any reset ran. */
function advance() {
  const step = state.steps.shift()
  if (!step) return { outputs: { runs: state.runs, coverage: state.coverage } }
  state.current = step
  return { next: step.command }
}

const inEnv = (script) => ['env', [`PERSIMMON_SOURCE=${state.source}`, 'PERSIMMON_TARGET=source', 'sh', '-c', script]]

serve({
  adapterId: 'parity-run/v1',
  executorTypes: ['script'],
  contextKinds: [],
  skillFormats: [],
  anyExit: true,
  transcript: true, // the suite's output is the log
  configurationSchema: { type: 'object', additionalProperties: false, properties: {} },
  parametersSchema: { type: 'object', additionalProperties: false, properties: {} },
  command: () => state.first,
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
    if (ports.includes('runs') && ports.includes('coverage')) {
      const inputs = payload.inputs ?? {}
      const suite = inputs.written?.value?.suite
      const source = inputs.source?.ref?.locator?.path
      const index = inputs.sourceIndex?.value
      const refuse = (message) => {
        throw new AdapterError('invalid_input', message, false)
      }
      if (!payload.workspace) refuse('run-source runs the suite in the project: action.workspace names the project, never the engine directory by default')
      if (!suite?.levels) refuse('run-source runs the suite inputs.written names: written.suite.levels is required')
      if (typeof source !== 'string' || !index?.files) refuse('run-source needs inputs.source (the checkout) and inputs.sourceIndex')
      let now
      try {
        now = sourceState(source)
      } catch {
        refuse(`${source} is not a git checkout`)
      }
      // the measures are the commit's only if the checkout is still the indexed commit, unchanged
      if (now.commit !== index.commit || now.dirty.length) refuse(`the checkout is at ${now.commit}${now.dirty.length ? ` with ${now.dirty.join(', ')} changed` : ''}; the index read ${index.commit}: index it again`)
      state = { source, index, runs: [], coverage: { files: {}, unmapped: [] }, steps: [], clean: (s) => redact(s, payload.credentials) }
      for (const name of onSource.filter((n) => suite.levels[n])) {
        const level = suite.levels[name]
        if (typeof level.run !== 'string' || !level.run.trim()) refuse(`suite level ${name} has no run command`)
        if (level.reset !== undefined && (typeof level.reset !== 'string' || !level.reset.trim())) refuse(`suite level ${name}'s reset is no command`)
        try {
          clearLevel(workspace, level) // before any reset runs; a path outside the workspace is refused here
        } catch (e) {
          refuse(e.message)
        }
        if (level.reset) state.steps.push({ kind: 'reset', name, level, command: inEnv(level.reset) })
        state.steps.push({ kind: 'run', name, level, command: inEnv(level.run) })
      }
      const next = advance()
      if (!next.next) return next // no level runs on the source: an empty answer, the Oracle static
      state.first = next.next
      return undefined
    }
    throw new AdapterError('invalid_input', `parity-run/v1 answers a sourceIndex output, or runs and coverage outputs; this Task declares ${ports.join(', ')}`, false)
  },
  parse({ stdout, stderr, exitCode, workspace }) {
    const step = state.current
    if (step.kind === 'reset' && exitCode !== 0) {
      // data not restored: the level's run would measure whatever the last run left, so it does not run and says why
      state.steps = state.steps.filter((s) => s.name !== step.name)
      const tail = `${stdout}\n${stderr}`.split('\n').filter((l) => l.trim()).slice(-50).join('\n')
      state.runs.push({ level: step.name, command: step.command.flat().map(state.clean), exitCode, head: state.index.commit, tests: [], observations: {}, reason: `reset exited ${exitCode}: the level did not run`, ...(tail ? { outputTail: state.clean(tail) } : {}) })
    } else if (step.kind === 'run') {
      const { run, coverage } = readLevel({ workspace, name: step.name, level: step.level, command: step.command.flat(), exitCode, head: state.index.commit, indexFiles: state.index.files, output: `${stdout}\n${stderr}`, clean: state.clean })
      state.runs.push(run)
      if (coverage) state.coverage = mergeCoverage(state.coverage, coverage)
    }
    return advance()
  },
})
