// Fake agent for the conformance suite (22-conformance.md). A stub beside each shipped Adapter calls `fakeAgent` with the
// emitter that answers in its CLI's own format. The stub records {argv, stdin, env, cwd} where PERSIMMON_CONFORMANCE_RECORD
// says, then behaves as PERSIMMON_CONFORMANCE_AGENT says: answer (default), sleep, fail.
import { writeFileSync } from 'node:fs'

export function fakeAgent(emit) {
  let stdin = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => (stdin += c))
  process.stdin.on('end', () => {
    const env = process.env
    const argv = process.argv.slice(2)
    if (env.PERSIMMON_CONFORMANCE_RECORD) writeFileSync(env.PERSIMMON_CONFORMANCE_RECORD, JSON.stringify({ argv, stdin, env, cwd: process.cwd() }))
    switch (env.PERSIMMON_CONFORMANCE_AGENT ?? 'answer') {
      case 'sleep':
        return setTimeout(() => {}, 600_000)
      case 'fail':
        for (const [k, v] of Object.entries(env)) if (k.includes('__')) process.stderr.write(`${k}=${v}\n`) // every `<NS>__<NAME>` credential, to prove redaction
        return process.exit(1)
      default:
        emit(JSON.parse(env.PERSIMMON_CONFORMANCE_ANSWER ?? '{}'), { argv, stdin })
    }
  })
}
