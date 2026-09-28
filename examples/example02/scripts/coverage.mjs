// coverage-check Task (subprocess/v1): runs the app's tests with coverage, answers a ValidationResult.
// stdin: the execute payload (unused); stdout: streamed to the RunLog; result: .persimmon/coverage-result.json
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const threshold = 90
const app = new URL('../app/', import.meta.url).pathname
const run = spawnSync('npx', ['vitest', 'run', '--coverage'], { cwd: app, encoding: 'utf8' })
process.stdout.write(run.stdout ?? '')
process.stderr.write(run.stderr ?? '')

let result
if (run.status !== 0) {
  result = { passed: false, findings: [{ severity: 'error', code: 'tests_failed', message: `vitest exited with ${run.status}` }], evidence: [] }
} else {
  const total = JSON.parse(readFileSync(`${app}coverage/coverage-summary.json`, 'utf8')).total
  const pct = Math.min(total.lines.pct, total.branches.pct, total.functions.pct, total.statements.pct)
  const message = `lines ${total.lines.pct}% branches ${total.branches.pct}% functions ${total.functions.pct}% statements ${total.statements.pct}% (threshold ${threshold}%)`
  result = { passed: pct >= threshold, findings: [{ severity: pct >= threshold ? 'info' : 'error', code: 'coverage', message }], evidence: [] }
}
mkdirSync('.persimmon', { recursive: true })
writeFileSync('.persimmon/coverage-result.json', JSON.stringify({ outputs: { result }, summary: result.findings[0].message }))
