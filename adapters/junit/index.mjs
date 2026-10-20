// junit/v1: runs a project's test command in the workspace and answers what its JUnit XML says as the Task's one artifact
// output, a TestOutcome (35-build-process.md). The exit code is part of the answer, never a failure: red tests are an outcome
// the Gate judges. No test case read (a compile error, a killed suite, unreadable XML) answers `tests: []` and the output tail.
// Configured with `levels`, it runs each test level the map names in order, integration, api, e2e, and answers an artifacts
// list. Each level selects by the Change set before it runs: nothing, the affected tests or every test (36-test-levels.md).
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { AdapterError, redact, serve } from '../lib/agent.mjs'
import { isReport, reportPath, reports, testCases } from './read.mjs'
import { coverage, mutation } from './measure.mjs'
import { changeSet, expand, namedFor, newRed, select, touched, unmatched } from './select.mjs'

const tailLines = 50
const order = ['integration', 'api', 'e2e'] // cheapest first; unit runs on its own Executor before them

/** The commit and whether the tree differs from it, before the run writes its reports; no index lock taken; both absent outside a git repository. */
function gitState(cwd) {
  const git = (...args) => execFileSync('git', ['--no-optional-locks', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    return { head: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' }
  } catch {
    return {}
  }
}

const tail = (text) => text.split('\n').filter((l) => l.trim()).slice(-tailLines).join('\n')

const programSchema = { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } }
const globs = { type: 'array', items: { type: 'string', minLength: 1 } }
const level = {
  program: { ...programSchema, description: 'the test command, run in the workspace' },
  junit: { type: 'string', minLength: 1, description: 'the JUnit XML it writes, relative to the workspace: a file, or a directory of .xml files' },
  paths: { ...globs, description: 'globs of the code this level tests; default every file' },
  fullOn: { ...globs, description: 'globs whose change runs every test of the level' },
  affected: { ...programSchema, description: 'the program narrowed to the Change set: {base} the baseline commit, a {files} argument the changed files under paths' },
}
const levelSchema = { type: 'object', required: ['program', 'junit'], additionalProperties: false, properties: level }
const min = { type: 'number', minimum: 0, maximum: 100, description: 'the minimum percent over the Change set' }
const report = (what) => ({ type: 'string', minLength: 1, description: `the ${what} report it writes, relative to the workspace` })
// the unit level's measures, taken in a round over the Change set
const unitSchema = {
  ...levelSchema,
  properties: {
    ...level,
    coverage: { type: 'object', required: ['report', 'min'], additionalProperties: false, properties: { report: report('Cobertura or JaCoCo XML'), min } },
    mutation: { type: 'object', required: ['program', 'report', 'min'], additionalProperties: false, properties: { program: { ...programSchema, description: 'the mutation command: {base} and {files} as in affected' }, report: report('mutation-testing-elements JSON'), min, paths: { ...globs, description: 'globs of the source to mutate, never the tests; default the level\'s paths' } } },
  },
}

// one attempt per Adapter process: what prepare decided, what each level answered
let run

/** The next level that runs: its command, after stale reports are gone; or, every level answered, the Task's answer. */
function advance(workspace) {
  while (++run.i < run.levels.length) {
    const l = run.levels[run.i]
    const named = namedFor(run.record, l.level)
    const selection = select({ tier: run.tier, level: l.level, config: l, changes: run.changes, named, held: run.held })
    if (selection.mode === 'none') {
      answered({ command: l.program, exitCode: 0, tests: [], selection }, l)
      continue
    }
    l.selection = selection
    return { next: start(workspace, l, selection.mode === 'affected' ? expand(l.affected, { base: run.base, files: touched(run.changes, l.paths, workspace) }) : l.program) }
  }
  const outcomes = run.levels.map((l) => l.outcome)
  return { outputs: { [run.port]: run.list ? outcomes : outcomes[0] } }
}

function start(workspace, l, program) {
  for (const f of reports(workspace, l.junit)) if (isReport(f)) rmSync(f, { force: true }) // a stale report must not answer this run; other XML stays
  if (l.coverage) rmSync(reportPath(workspace, l.coverage.report), { force: true })
  l.command = program
  return [program[0], program.slice(1)]
}

function answered(outcome, l) {
  l.outcome = { ...outcome, ...run.tested, ...(run.list ? { level: l.level } : {}) }
  if (l.outcome.newRed > 0 || l.outcome.selection.reason.startsWith('held')) run.held ??= l.level
}

serve({
  adapterId: 'junit/v1',
  executorTypes: ['script'],
  contextKinds: [],
  skillFormats: [],
  anyExit: true,
  transcript: true, // the suite's output is the log
  configurationSchema: {
    oneOf: [
      unitSchema,
      { type: 'object', required: ['levels'], additionalProperties: false, properties: { levels: { type: 'object', additionalProperties: false, properties: Object.fromEntries(order.map((l) => [l, levelSchema])) } } },
    ],
  },
  parametersSchema: { type: 'object', additionalProperties: false, properties: {} },
  command: () => run.first,
  input: () => '', // a test command reads no prompt
  async prepare({ configuration: c, workspace, payload, call }) {
    const outputs = Object.entries(payload.task.outputs)
    if (outputs.length !== 1) throw new AdapterError('invalid_input', `junit/v1 answers one output, the TestOutcome; this Task declares ${outputs.length}`, false)
    const [[port, spec]] = outputs
    const list = 'levels' in c
    if (list !== (spec.type.kind === 'artifacts')) throw new AdapterError('invalid_input', `junit/v1 answers ${list ? 'an artifacts output with levels' : 'an artifact output with one program'}; ${port} is ${spec.type.kind}`, false)
    const levels = list ? order.filter((l) => c.levels[l]).map((l) => ({ level: l, ...c.levels[l] })) : [{ level: 'unit', ...c }]
    try {
      for (const l of levels) for (const f of [l.junit, l.coverage?.report, l.mutation?.report].filter(Boolean)) reportPath(workspace, f) // deleted before a run: never outside the workspace
    } catch (e) {
      throw new AdapterError('invalid_input', e.message, false)
    }
    const content = async (v) => (v?.kind === 'artifact' ? (await call('getArtifact', v.ref)).spec.content : undefined)
    const { record, baseline, baselines, testOutcome } = payload.inputs ?? {}
    const bases = list ? await Promise.all((baselines?.refs ?? []).map((r) => call('getArtifact', r).then((a) => a.spec.content))) : [await content(baseline)].filter(Boolean)
    for (const l of levels) l.baseline = bases.find((b) => (b.level ?? 'unit') === l.level)
    // a record is a round; no record, a baseline; no record beside baselines, the plan tier
    const tier = record ? 'round' : bases.length ? 'plan' : 'baseline'
    const unit = await content(testOutcome)
    const base = bases.find((b) => b.head)?.head
    let changes
    if (tier === 'round' && base) {
      try {
        changes = changeSet(workspace, base)
      } catch {} // no such commit here: select runs every test
    }
    run = { port, list, tier, base, changes, levels, i: -1, record: await content(record), tested: gitState(workspace), held: unit && (unit.newRed > 0 || unit.selection?.reason.startsWith('held')) ? 'unit' : undefined }
    const next = advance(workspace)
    if (!next.next) return next
    run.first = next.next
  },
  parse({ stdout, stderr, exitCode, workspace, payload }) {
    const l = run.levels[run.i]
    const clean = (text) => redact(text, payload.credentials) // the program had the credentials; what it printed is stored
    if (l.measuring) {
      const m = mutation({ workspace, report: l.mutation.report, min: l.mutation.min, changes: run.changes, paths: l.mutation.paths ?? l.paths, command: l.command })
      if (m.error) m.error = clean(`${m.error} (exit ${exitCode})\n${tail(`${stdout}\n${stderr}`)}`.trim())
      l.outcome.mutation = m
      return advance(workspace)
    }
    let tests = []
    let unreadable = ''
    try {
      tests = reports(workspace, l.junit).flatMap((f) => testCases(readFileSync(f, 'utf8'))).map((t) => (t.message ? { ...t, message: clean(t.message) } : t))
    } catch (e) {
      tests = []
      unreadable = `\nunreadable JUnit XML: ${e.message}`
    }
    // a named test the narrowed run did not select runs, with every other, once more
    const missed = l.selection.mode === 'affected' ? unmatched(namedFor(run.record, l.level), tests) : []
    if (missed.length) {
      l.selection = { mode: 'full', reason: `${missed.length} named test${missed.length > 1 ? 's' : ''} not selected: ${missed.join('; ')}` }
      return { next: start(workspace, l, l.program) }
    }
    const outcome = { command: l.command, exitCode, tests, selection: l.selection, newRed: newRed(tests, l.baseline) }
    if (tests.length === 0) outcome.outputTail = clean(tail(`${stdout}\n${stderr}`) + unreadable) || `no test case read from ${l.junit}`
    const round = !run.list && run.tier === 'round'
    if (round && l.coverage) outcome.coverage = coverage({ workspace, report: l.coverage.report, min: l.coverage.min, changes: run.changes, paths: l.paths })
    answered(outcome, l)
    // mutants only kill against tests with no new red, and only in changed source
    const mutate = touched(run.changes, l.mutation?.paths ?? l.paths, workspace)
    if (round && l.mutation && tests.length && outcome.newRed === 0 && (!run.changes || mutate.length)) {
      l.measuring = true
      rmSync(reportPath(workspace, l.mutation.report), { force: true })
      l.command = expand(l.mutation.program, { base: run.base, files: mutate })
      return { next: [l.command[0], l.command.slice(1)] }
    }
    return advance(workspace)
  },
})
