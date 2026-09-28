// package Task (subprocess/v1): the execute payload arrives on stdin; the answer goes to the Executor's resultFile.
// Writes build/<version>.txt as the "archive" and publishes a Package artifact pointing at it.
import { mkdirSync, statSync, writeFileSync } from 'node:fs'

const payload = JSON.parse(await new Promise((r) => { let s = ''; process.stdin.on('data', (c) => (s += c)).on('end', () => r(s)) }))
const version = payload.inputs.version.value
const title = payload.inputs.title.value
const notes = payload.inputs.notes.ref // RevisionRef of the ReleaseNotes; the content is not on stdin
console.log(`packaging ${title} from ${notes.kind}/${notes.id}.r${notes.revision}`)
mkdirSync('build', { recursive: true })
const file = `build/${version}.txt`
writeFileSync(file, `${title}\nbuilt from ${notes.kind}/${notes.id}.r${notes.revision}\n`)
const bytes = statSync(file).size
mkdirSync('.persimmon', { recursive: true })
writeFileSync('.persimmon/release-result.json', JSON.stringify({ outputs: { package: { version, file, bytes }, version }, summary: `built ${file} (${bytes} bytes)` }))
