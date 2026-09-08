import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TSC = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))

/**
 * The server emit the tests that spawn the bin need. `bin/host.js` imports
 * `../lib/*.js`, because Node refuses to strip types under `node_modules` and a
 * shipped package must carry JavaScript (issue-00029); the emit is git-ignored,
 * so the suite builds it rather than assuming a build ran first. Incremental
 * after the first run.
 */
export default function setup(): void {
  execFileSync(process.execPath, [TSC, '-p', 'tsconfig.build.json'], { cwd: ROOT, stdio: 'inherit' })
}
