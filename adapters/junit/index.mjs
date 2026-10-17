// junit/v1: runs a project's test command in the workspace and answers what its JUnit XML says as the Task's one artifact
// output, a TestOutcome (35-build-process.md). The exit code is part of the answer, never a failure: red tests are an outcome
// the Gate judges. No test case read (a compile error, a killed suite, unreadable XML) answers `tests: []` and the output tail.
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { AdapterError, serve } from '../lib/agent.mjs'
import { reports, testCases } from './read.mjs'

const tailLines = 50

/** The commit and whether the tree differs from it, read only; both absent outside a git repository. */
function gitState(cwd) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    return { head: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' }
  } catch {
    return {}
  }
}

const tail = (text) => text.split('\n').filter((l) => l.trim()).slice(-tailLines).join('\n')

serve({
  adapterId: 'junit/v1',
  executorTypes: ['script'],
  contextKinds: [],
  skillFormats: [],
  anyExit: true,
  configurationSchema: {
    type: 'object', required: ['program', 'junit'], additionalProperties: false,
    properties: {
      program: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 }, description: 'the test command, run in the workspace' },
      junit: { type: 'string', minLength: 1, description: 'the JUnit XML it writes, relative to the workspace: a file, or a directory of .xml files' },
    },
  },
  parametersSchema: { type: 'object', additionalProperties: false, properties: {} },
  command({ configuration: c }) {
    const [program, ...args] = c.program
    return [program, args]
  },
  input: () => '', // a test command reads no prompt
  prepare({ configuration: c, workspace }) {
    for (const f of reports(workspace, c.junit)) rmSync(f, { force: true }) // a stale report must not answer this run
  },
  parse({ stdout, stderr, exitCode, configuration: c, workspace, payload }) {
    const ports = Object.keys(payload.task.outputs)
    if (ports.length !== 1) throw new AdapterError('invalid_input', `junit/v1 answers one output, the TestOutcome; this Task declares ${ports.length}`, false)
    let tests = []
    let unreadable = ''
    try {
      tests = reports(workspace, c.junit).flatMap((f) => testCases(readFileSync(f, 'utf8')))
    } catch (e) {
      tests = []
      unreadable = `\nunreadable JUnit XML: ${e.message}`
    }
    const outcome = { command: c.program, exitCode, ...gitState(workspace), tests }
    if (tests.length === 0) outcome.outputTail = tail(`${stdout}\n${stderr}`) + unreadable || `no JUnit XML at ${c.junit}`
    return { outputs: { [ports[0]]: outcome } }
  },
})
