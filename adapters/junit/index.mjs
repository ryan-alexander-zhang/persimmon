// junit/v1: runs a project's test command in the workspace and answers what its JUnit XML says as the Task's one artifact
// output, a TestOutcome (35-build-process.md). The exit code is part of the answer, never a failure: red tests are an outcome
// the Gate judges. No test case read (a compile error, a killed suite, unreadable XML) answers `tests: []` and the output tail.
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { AdapterError, redact, serve } from '../lib/agent.mjs'
import { isReport, reports, testCases } from './read.mjs'

const tailLines = 50

/** The commit and whether the tree differs from it, before the run writes its reports; no index lock taken; both absent outside a git repository. */
function gitState(cwd) {
  const git = (...args) => execFileSync('git', ['--no-optional-locks', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    return { head: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' }
  } catch {
    return {}
  }
}

let tested = {} // gitState before the run; one attempt per Adapter process

const tail = (text) => text.split('\n').filter((l) => l.trim()).slice(-tailLines).join('\n')

serve({
  adapterId: 'junit/v1',
  executorTypes: ['script'],
  contextKinds: [],
  skillFormats: [],
  anyExit: true,
  transcript: true, // the suite's output is the log
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
  prepare({ configuration: c, workspace, payload }) {
    const ports = Object.keys(payload.task.outputs)
    if (ports.length !== 1) throw new AdapterError('invalid_input', `junit/v1 answers one output, the TestOutcome; this Task declares ${ports.length}`, false)
    let stale
    try {
      stale = reports(workspace, c.junit)
    } catch (e) {
      throw new AdapterError('invalid_input', e.message, false)
    }
    for (const f of stale) if (isReport(f)) rmSync(f, { force: true }) // a stale report must not answer this run; other XML stays
    tested = gitState(workspace)
  },
  parse({ stdout, stderr, exitCode, configuration: c, workspace, payload }) {
    const port = Object.keys(payload.task.outputs)[0]
    const clean = (text) => redact(text, payload.credentials) // the program had the credentials; what it printed is stored
    let tests = []
    let unreadable = ''
    try {
      tests = reports(workspace, c.junit).flatMap((f) => testCases(readFileSync(f, 'utf8'))).map((t) => (t.message ? { ...t, message: clean(t.message) } : t))
    } catch (e) {
      tests = []
      unreadable = `\nunreadable JUnit XML: ${e.message}`
    }
    const outcome = { command: c.program, exitCode, ...tested, tests }
    if (tests.length === 0) outcome.outputTail = clean(tail(`${stdout}\n${stderr}`) + unreadable) || `no test case read from ${c.junit}`
    return { outputs: { [port]: outcome } }
  },
})
