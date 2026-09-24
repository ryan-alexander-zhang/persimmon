import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from '../config.js'
import { Engine } from '../engine.js'

export interface Cli {
  cwd: string
  out: (line: string) => void
  err: (line: string) => void
  /** Interactive answer: prints `prompt`, returns the lines typed until a lone `.`; null once stdin closed; absent when no terminal. */
  ask?: (prompt: string) => Promise<string | null>
}

/** Opens the local engine for one verb: `.persimmon/` exists, stored definitions load. `listen: false` is a read-only process: no socket, no lock, no call recovery, no drain. */
export async function openEngine(cli: Cli, options: { listen?: boolean } = {}): Promise<Engine> {
  const config = loadConfig(join(cli.cwd, 'persimmon.yaml'))
  if (!existsSync(join(cli.cwd, '.persimmon'))) mkdirSync(join(cli.cwd, '.persimmon'), { recursive: true })
  const engine = new Engine({ config, cwd: cli.cwd })
  await engine.start({ recover: options.listen !== false })
  if (options.listen !== false) await engine.listen()
  return engine
}

/** Every local write verb drains due timers and the Outbox before exit (08-store.md); read verbs only look. */
export async function withEngine<T>(cli: Cli, fn: (engine: Engine) => Promise<T>, options: { listen?: boolean } = {}): Promise<T> {
  const engine = await openEngine(cli, options)
  try {
    const out = await fn(engine)
    if (options.listen !== false) await engine.drain()
    return out
  } finally {
    await engine.close()
  }
}
