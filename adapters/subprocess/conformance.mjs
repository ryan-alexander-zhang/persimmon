// The program `subprocess/v1` runs under the conformance suite (22-conformance.md): the execute payload on stdin, the
// answer written to configuration.resultFile in the workspace.
import { writeFileSync } from 'node:fs'
import { fakeAgent } from '../lib/conformance.mjs'

fakeAgent((answer, { stdin }) => writeFileSync(JSON.parse(stdin).executor.configuration.resultFile, JSON.stringify({ outputs: answer })))
