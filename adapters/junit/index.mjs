// junit/v1: runs a project's test command in the workspace and answers what its JUnit XML says as the Task's one artifact
// output, a TestOutcome (35-build-process.md). The exit code is part of the answer, never a failure: red tests are an outcome
// the Gate judges. No test case read (a compile error, a killed suite, unreadable XML) answers `tests: []` and the output tail.
// Configured with `levels`, it runs each test level the map names in order, integration, api, e2e, and answers an artifacts
// list. Each level selects by the Change set before it runs: nothing, the affected tests or every test (36-test-levels.md).
// A TestHarness bound as `harness` names the levels and their commands instead; the Executor keeps the minimums. A round's
// `cases` are the case ids each level must run, as a record's names are (39-test-process.md).
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { AdapterError, redact, serve } from '../lib/agent.mjs'
import { isReport, reportPath, reports, testCases } from './read.mjs'
import { coverage, mutation } from './measure.mjs'
import { changeSet, expand, namedFor, newRed, select, touched, unmatched } from './select.mjs'
import { carries } from '../sdd/check.mjs'

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
// the report and the command come from here or from a TestHarness bound; the minimum is always the Executor's
const unitSchema = {
  ...levelSchema,
  properties: {
    ...level,
    coverage: { type: 'object', required: ['min'], additionalProperties: false, properties: { report: report('Cobertura or JaCoCo XML'), min } },
    mutation: { type: 'object', required: ['min'], additionalProperties: false, properties: { program: { ...programSchema, description: 'the mutation command: {base} and {files} as in affected' }, report: report('mutation-testing-elements JSON'), min, paths: { ...globs, description: 'globs of the source to mutate, never the tests; default the level\'s paths' } } },
  },
}
const defaultMin = 90 // the minimums a harness's measures are held to when the Executor names none (36-test-levels.md)
/** One level as the runner reads it, from a TestHarness level: its `run` is the program. */
const fromHarness = (level, h) => ({ level, program: h.run, junit: h.junit, ...(h.paths ? { paths: h.paths } : {}), ...(h.fullOn ? { fullOn: h.fullOn } : {}), ...(h.affected ? { affected: h.affected } : {}) })

// one attempt per Adapter process: what prepare decided, what each level answered
let run

/** The next level that runs: its command, after stale reports are gone; or, every level answered, the Task's answer. */
function advance(workspace) {
  while (++run.i < run.levels.length) {
    const l = run.levels[run.i]
    const selection = select({ tier: run.tier, level: l.level, config: l, changes: run.changes, named: run.named(l.level), held: run.held, everyCase: run.everyCase })
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
    const content = async (v) => (v?.kind === 'artifact' ? (await call('getArtifact', v.ref)).spec.content : undefined)
    const { record, baseline, baselines, testOutcome, harness: harnessRef, cases, testDesign } = payload.inputs ?? {}
    const harness = (await content(harnessRef))?.levels
    const measure = (name, h) => (h || c[name] ? { ...c[name], ...h, min: c[name]?.min ?? defaultMin } : undefined)
    const unit = harness?.unit && { ...fromHarness('unit', harness.unit), coverage: measure('coverage', harness.unit.coverage), mutation: measure('mutation', harness.unit.mutation) }
    const levels = list
      ? order.filter((l) => (harness ?? c.levels)[l]).map((l) => (harness ? fromHarness(l, harness[l]) : { level: l, ...c.levels[l] }))
      : [unit ?? { level: 'unit', ...c }]
    for (const l of levels) {
      for (const m of ['coverage', 'mutation']) if (!l[m]) delete l[m]
      if (l.coverage && !l.coverage.report) throw new AdapterError('invalid_input', 'coverage names a minimum but no report: the Executor or a TestHarness names it', false)
      if (l.mutation && !(l.mutation.program && l.mutation.report)) throw new AdapterError('invalid_input', 'mutation names a minimum but no program and report: the Executor or a TestHarness names them', false)
    }
    try {
      for (const l of levels) for (const f of [l.junit, l.coverage?.report, l.mutation?.report].filter(Boolean)) reportPath(workspace, f) // deleted before a run: never outside the workspace
    } catch (e) {
      throw new AdapterError('invalid_input', e.message, false)
    }
    const bases = list ? await Promise.all((baselines?.refs ?? []).map((r) => call('getArtifact', r).then((a) => a.spec.content))) : [await content(baseline)].filter(Boolean)
    for (const l of levels) l.baseline = bases.find((b) => (b.level ?? 'unit') === l.level)
    // a record is a round; no record, a baseline; no record beside baselines, the plan tier
    const tier = record ? 'round' : bases.length ? 'plan' : 'baseline'
    const base = bases.find((b) => b.head)?.head
    let changes
    if (tier === 'round' && base) {
      try {
        changes = changeSet(workspace, base)
      } catch {} // no such commit here: select runs every test
    }
    const round = await content(testOutcome)
    const named = await content(record)
    const ids = cases?.value // a round under a TestDesign: the case ids each level must run, carried in the tests' names
    run = {
      port, list, tier, base, changes, levels, i: -1, tested: gitState(workspace),
      held: round && (round.newRed > 0 || round.selection?.reason.startsWith('held')) ? 'unit' : undefined,
      everyCase: !!testDesign, // the plan tier under a TestDesign runs unit in full: the TestReport reads every case
      named: (level) => (ids ? ids[level] ?? [] : namedFor(named, level)),
      missed: (level, tests) => (ids ? (ids[level] ?? []).filter((q) => !tests.some((t) => carries(t, q))) : unmatched(namedFor(named, level), tests)),
    }
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
    const missed = l.selection.mode === 'affected' ? run.missed(l.level, tests) : []
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
