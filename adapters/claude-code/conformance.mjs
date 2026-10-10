// Stands in for `claude -p --output-format stream-json` under the conformance suite (22-conformance.md).
import { fakeAgent } from '../lib/conformance.mjs'

fakeAgent((answer) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{}', structured_output: answer }) + '\n'))
