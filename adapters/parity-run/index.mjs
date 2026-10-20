// parity-run/v1: what a script Task of the Rewrite pack answers (40-pack-rewrite.md), by the outputs it declares.
// `sourceIndex`: index-source reads its workspace, the Source system's checkout, into the source index; the Adapter runs in
// the project directory, so the index also says where the project is.
// `runs` and `coverage`: run-source runs each suite level that runs on the source (`app`, `units`) in the project, its reset
// first, with the checkout's path in PERSIMMON_SOURCE, and answers each level's tests and observations and the source's
// coverage mapped onto the index. A red suite is an answer, never a failure: the ledger records it.
// `mutantResults`: run-mutants applies each of the Tester's patches to a scratch clone of the checkout, never the checkout,
// and reruns one by one the tests green on the source that cite the patched item, each after the level's reset.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { AdapterError, redact, serve } from '../lib/agent.mjs'
import { cites } from '../parity/ledger.mjs'
import { diffFault, mutantResult, parseDiff, patchFault } from '../parity/mutants.mjs'
import { clearLevel, mergeCoverage, readLevel } from '../parity/runs.mjs'
import { indexSource, sourceState } from '../parity/source.mjs'

const onSource = ['app', 'units'] // records run against the rewrite only

// one attempt per Adapter process: the steps still to run, what to do with each one's result, and how to answer at the end
let state

const refuse = (message) => {
  throw new AdapterError('invalid_input', message, false)
}

/** The next command, a step's `before` run first (it may drop the step); with none left, the Task's answer. */
function advance() {
  for (;;) {
    const step = state.steps.shift()
    if (!step) return { outputs: state.finish() }
    if (step.before && step.before() === false) continue
    state.current = step
    return { next: step.command }
  }
}

const inEnv = (source, script, env = {}) => ['env', [`PERSIMMON_SOURCE=${source}`, 'PERSIMMON_TARGET=source', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), 'sh', '-c', script]]
const git = (cwd, args, input) => execFileSync('git', ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })

/** The checkout, the suite and the index a run needs, and the checkout still the indexed commit, unchanged. */
function sourceInputs(payload) {
  const inputs = payload.inputs ?? {}
  const suite = inputs.written?.value?.suite
  const source = inputs.source?.ref?.locator?.path
  const index = inputs.sourceIndex?.value
  if (!payload.workspace) refuse('the suite runs in the project: action.workspace names the project, never the engine directory by default')
  if (!suite?.levels) refuse('the suite inputs.written names is required: written.suite.levels')
  if (typeof source !== 'string' || !index?.files) refuse('inputs.source (the checkout) and inputs.sourceIndex are required')
  let now
  try {
    now = sourceState(source)
  } catch {
    refuse(`${source} is not a git checkout`)
  }
  if (now.commit !== index.commit || now.dirty.length) refuse(`the checkout is at ${now.commit}${now.dirty.length ? ` with ${now.dirty.join(', ')} changed` : ''}; the index read ${index.commit}: index it again`)
  for (const [name, level] of Object.entries(suite.levels)) {
    if (typeof level.run !== 'string' || !level.run.trim()) refuse(`suite level ${name} has no run command`)
    if (level.reset !== undefined && (typeof level.reset !== 'string' || !level.reset.trim())) refuse(`suite level ${name}'s reset is no command`)
  }
  return { inputs, suite, source, index, clean: (s) => redact(s, payload.credentials) }
}

/** run-source: each level's reset, then its run; a failed reset keeps its level from running. */
function runSource(payload, workspace) {
  const { suite, source, index, clean } = sourceInputs(payload)
  const runs = []
  let coverage = { files: {}, unmapped: [] }
  const steps = []
  for (const name of onSource.filter((n) => suite.levels[n])) {
    const level = suite.levels[name]
    try {
      clearLevel(workspace, level) // before any reset runs; a path outside the workspace is refused here
    } catch (e) {
      refuse(e.message)
    }
    if (level.reset) steps.push({ name, kind: 'reset', command: inEnv(source, level.reset) })
    steps.push({ name, kind: 'run', level, command: inEnv(source, level.run) })
  }
  state = {
    steps,
    finish: () => ({ runs, coverage }),
    parse(step, { stdout, stderr, exitCode }) {
      if (step.kind === 'reset' && exitCode !== 0) {
        // data not restored: the level's run would measure whatever the last run left, so it does not run and says why
        state.steps = state.steps.filter((s) => s.name !== step.name)
        const tail = `${stdout}\n${stderr}`.split('\n').filter((l) => l.trim()).slice(-50).join('\n')
        runs.push({ level: step.name, command: step.command.flat().map(clean), exitCode, head: index.commit, tests: [], observations: {}, reason: `reset exited ${exitCode}: the level did not run`, ...(tail ? { outputTail: clean(tail) } : {}) })
      } else if (step.kind === 'run') {
        const read = readLevel({ workspace, name: step.name, level: step.level, command: step.command.flat(), exitCode, head: index.commit, indexFiles: index.files, output: `${stdout}\n${stderr}`, clean })
        runs.push(read.run)
        if (read.coverage) coverage = mergeCoverage(coverage, read.coverage)
      }
    },
  }
}

/** run-mutants: per mutant, the scratch clone restored and patched, what it then differs in held to the item's where, and each
 * citing test green on the source rerun alone after the level's reset. Results come back in the order the mutants came. */
async function runMutants(payload, workspace, call) {
  const { inputs, suite, source, index } = sourceInputs(payload)
  const mutants = inputs.mutants?.value
  const runs = inputs.runs?.value
  if (!Array.isArray(mutants) || !Array.isArray(runs)) refuse('run-mutants needs inputs.mutants, the Tester\'s patches, and inputs.runs, run-source\'s answer')
  if (inputs.inventory?.kind !== 'artifact') refuse('run-mutants needs inputs.inventory: a patch is held to its item\'s where')
  const inventory = (await call('getArtifact', inputs.inventory.ref)).spec.content
  const where = new Map([...(inventory.guards ?? []), ...(inventory.declarations ?? []), ...(inventory.stateChanges ?? []), ...(inventory.externalSystems ?? [])].map((x) => [x.id, x.where]))
  const green = runs.flatMap((r) => r.tests.filter((t) => t.status === 'passed').map((t) => ({ name: t.name, level: r.level })))
  const scratch = join(process.cwd(), '.persimmon', 'scratch', payload.taskRun.ref.name)
  const results = new Array(mutants.length)
  const steps = []
  const invalid = (i, ref, reason) => {
    results[i] = { ref, result: 'invalid', failed: [], reason }
    state.steps = state.steps.filter((s) => s.mutant !== mutants[i]) // its remaining reruns and its verdict step
  }
  mutants.forEach((m, i) => {
    const fault = !where.has(m.ref) ? `${m.ref} is no item of the inventory a mutant can change` : patchFault(m.patch ?? '', where.get(m.ref))
    if (fault) return void (results[i] = { ref: m.ref, result: 'invalid', failed: [], reason: fault })
    const citing = green.filter((t) => cites(t.name, m.ref))
    const levelless = citing.find((t) => !suite.levels[t.level]?.one)
    if (levelless) return void (results[i] = { ref: m.ref, result: 'invalid', failed: [], reason: `suite level ${levelless.level} has no one command to rerun ${levelless.name}` })
    const reruns = []
    steps.push({
      mutant: m,
      before() {
        // a clean clone: no change and no build output of the last mutant stays
        git(scratch, ['checkout', '-q', '--', '.'])
        git(scratch, ['clean', '-xdfq'])
        try {
          // --unidiff-zero: a patch cut to the item's lines alone has no context; what it changed is checked right after
          git(scratch, ['apply', '--unidiff-zero', '--whitespace=nowarn', '-'], m.patch.endsWith('\n') ? m.patch : `${m.patch}\n`)
        } catch (e) {
          invalid(i, m.ref, `the patch does not apply: ${(e.stderr || e.message).trim().split('\n')[0]}`)
          return false
        }
        // git apply may land a hunk at an offset: what the clone now differs in is what is held to the where
        const untracked = git(scratch, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter((l) => l.startsWith('??'))
        const fault = untracked.length ? `the patch creates ${untracked.map((l) => l.slice(3)).join(', ')}: a mutant changes the item's lines only` : diffFault(parseDiff(git(scratch, ['diff', '-U0', '--no-color', 'HEAD'])), where.get(m.ref))
        if (fault) invalid(i, m.ref, fault)
        return false // no command of its own
      },
    })
    for (const t of citing) {
      const level = suite.levels[t.level]
      if (level.reset) steps.push({ mutant: m, kind: 'reset', index: i, command: inEnv(scratch, level.reset) })
      steps.push({ mutant: m, kind: 'test', test: t.name, level, reruns, before: () => (clearLevel(workspace, level), true), command: inEnv(scratch, level.one.replace(/(['"]?)\{test\}\1/g, '"$PERSIMMON_TEST"'), { PERSIMMON_TEST: t.name }) }) // a quoted '{test}' too: the shell expands the name, never splices it
    }
    steps.push({ mutant: m, before: () => ((results[i] = mutantResult(m.ref, citing.map((t) => reruns.find((r) => r.name === t.name) ?? { name: t.name, status: 'missing' }), green.map((t) => t.name))), false) })
  })
  for (const level of new Set(steps.filter((s) => s.level).map((s) => s.level))) {
    try {
      clearLevel(workspace, level) // a path outside the workspace is refused here, before anything runs
    } catch (e) {
      refuse(e.message)
    }
  }
  rmSync(scratch, { recursive: true, force: true }) // a clone a killed attempt left behind never answers this one
  if (steps.length) {
    mkdirSync(join(scratch, '..'), { recursive: true })
    git(process.cwd(), ['clone', '-q', '--shared', '--no-checkout', source, scratch]) // reads the checkout's objects, never writes to it
    git(scratch, ['checkout', '-q', index.commit])
  }
  state = {
    steps,
    scratch,
    finish: () => {
      rmSync(scratch, { recursive: true, force: true })
      return { mutantResults: results }
    },
    parse(step, { exitCode }) {
      if (step.kind === 'reset' && exitCode !== 0) return invalid(step.index, step.mutant.ref, `the level's reset exited ${exitCode}: a rerun on data it could not restore proves nothing`)
      if (step.kind !== 'test') return
      const { run } = readLevel({ workspace, name: 'mutant', level: step.level, command: [], exitCode: 0 })
      step.reruns.push(run.tests.find((t) => t.name === step.test) ?? { name: step.test, status: 'missing' })
    },
  }
}

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
  async prepare({ payload, workspace, call }) {
    const ports = Object.keys(payload.task.outputs)
    if (ports.includes('sourceIndex')) {
      if (!payload.workspace) refuse('index-source reads its workspace, the source checkout: action.workspace names the source input')
      try {
        return { outputs: { sourceIndex: indexSource(workspace, process.cwd()) } }
      } catch (e) {
        refuse(e.message)
      }
    }
    if (ports.includes('runs') && ports.includes('coverage')) runSource(payload, workspace)
    else if (ports.includes('mutantResults')) await runMutants(payload, workspace, call)
    else refuse(`parity-run/v1 answers a sourceIndex output, runs and coverage outputs, or a mutantResults output; this Task declares ${ports.join(', ')}`)
    let next
    try {
      next = advance()
    } catch (e) {
      if (state.scratch) rmSync(state.scratch, { recursive: true, force: true }) // a failing step leaves no clone behind
      throw e
    }
    if (!next.next) return next // nothing to run: the answer as it stands
    state.first = next.next
    return undefined
  },
  parse(ran) {
    try {
      state.parse(state.current, ran)
      return advance()
    } catch (e) {
      if (state.scratch) rmSync(state.scratch, { recursive: true, force: true }) // a failing step leaves no clone behind
      throw e
    }
  },
})
