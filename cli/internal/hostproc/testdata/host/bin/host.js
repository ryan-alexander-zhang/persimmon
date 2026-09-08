// A stand-in for the host package's bin, run as `node <dir>/bin/host.js` the way
// the development override runs the real one (design-00004 §3). It prints the
// address from the environment the command handed it and reacts to signals and
// to stdin, so the command's half of the launch can be tested without the
// service. The environment picks which half of it is under test.
//
// The signal handlers go on before the address line, never after: that line is
// how a test knows the host is up, and a signal arriving between the two would
// be the default disposition's to take rather than a handler's.

// `--judge` is the host package's query mode (design-00004 §4): it reads the
// registry, judges availability and prints the five states as JSON without
// listening. The stub prints the judgement the environment hands it, because
// what is under test on the command's side is how it reads that answer — the
// real pairing between the two is `test/host.test.ts`'s.
if (process.argv.includes('--judge')) {
  console.log(process.env.STUB_JUDGE ?? '{"workspaces": []}')
  process.exit(0)
}

if (process.env.STUB_EXIT === undefined && process.env.STUB_ECHO_STDIN === undefined) {
  const wanted = Number(process.env.STUB_SIGNALS ?? 1)
  const alive = setTimeout(() => {
    console.error('stub: never signalled')
    process.exitCode = 99
  }, 30_000)
  let seen = 0
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      seen += 1
      console.log(`stub: ${signal} ${seen}`)
      if (seen < wanted) return
      // Exiting is left to the event loop draining rather than process.exit():
      // a pipe makes stdout asynchronous, and exiting on the spot truncates
      // what was just written.
      process.exitCode = Number(process.env.STUB_SIGNAL_EXIT ?? 0)
      clearTimeout(alive)
      for (const each of ['SIGINT', 'SIGTERM']) process.removeAllListeners(each)
    })
  }
}

const port = process.env.PORT
const workspace = process.env.PERSIMMON_WORKSPACE
console.log(`persimmon: http://localhost:${port}/${workspace === undefined ? '' : `w/${workspace}`}`)
if (process.env.STUB_STDERR !== undefined) console.error(process.env.STUB_STDERR)
if (process.env.STUB_EXIT !== undefined) process.exitCode = Number(process.env.STUB_EXIT)
if (process.env.STUB_ECHO_STDIN !== undefined) process.stdin.pipe(process.stdout)
