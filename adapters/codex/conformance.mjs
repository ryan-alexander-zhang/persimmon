// Stands in for `codex exec -o <answer file>` under the conformance suite (22-conformance.md).
import { writeFileSync } from 'node:fs'
import { fakeAgent } from '../lib/conformance.mjs'

fakeAgent((answer, { argv }) => writeFileSync(argv[argv.indexOf('-o') + 1], JSON.stringify(answer)))
