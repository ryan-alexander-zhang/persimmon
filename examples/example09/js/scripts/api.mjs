// Starts the app, runs the Bruno collection with its JUnit reporter, stops the app.
import { spawn, spawnSync } from 'node:child_process'
const app = spawn(process.execPath, ['src/server.js', '3997'], { stdio: 'inherit' })
await new Promise((r) => setTimeout(r, 500))
const r = spawnSync('bru', ['run', '--env', 'ci', '--reporter-junit', '../junit-api.xml'], { cwd: 'api', stdio: 'inherit' })
app.kill()
process.exit(r.status ?? 1)
