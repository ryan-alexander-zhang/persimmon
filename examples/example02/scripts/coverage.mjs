// coverage-check Task (subprocess/v1): runs the app's tests with coverage, answers a ValidationResult.
// Runs in the Task's workspace, app/. stdin: the execute payload (unused); stdout: streamed to the RunLog;
// result: coverage/result.json, the Executor's resultFile, relative to the workspace.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const threshold = 90
const run = spawnSync('npx', ['vitest', 'run', '--coverage'], { encoding: 'utf8' })
process.stdout.write(run.stdout ?? '')
process.stderr.write(run.stderr ?? '')

let result
if (run.status !== 0) {
  result = { passed: false, findings: [{ severity: 'error', code: 'tests_failed', message: `vitest exited with ${run.status}` }], evidence: [] }
} else {
  const total = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8')).total
  const pct = Math.min(total.lines.pct, total.branches.pct, total.functions.pct, total.statements.pct)
  const message = `lines ${total.lines.pct}% branches ${total.branches.pct}% functions ${total.functions.pct}% statements ${total.statements.pct}% (threshold ${threshold}%)`
  result = { passed: pct >= threshold, findings: [{ severity: pct >= threshold ? 'info' : 'error', code: 'coverage', message }], evidence: [] }
}
mkdirSync('coverage', { recursive: true })
writeFileSync('coverage/result.json', JSON.stringify({ outputs: { result }, summary: result.findings[0].message }))
