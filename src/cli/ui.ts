import { serve } from '../server/index.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'

/** `persimmon ui [--port <n>] [--read-only]`: the API and the built tools on loopback until SIGINT. The engine listens: a publish may fire a Trigger whose run calls a stdio Adapter.
 * `--read-only` opens it as the read verbs do, no lock, so it watches a project another verb drives; every POST is 409 (25-ui.md). */
export async function ui(cli: Cli, o: { port?: number; readOnly?: boolean } = {}): Promise<number> {
  return withEngine(cli, async (engine) => {
    const server = await serve(engine, { ...(o.port === undefined ? {} : { port: o.port }), ...(o.readOnly ? { readOnly: true } : {}) })
    cli.out(`persimmon ui${o.readOnly ? ' (read-only)' : ''}: http://127.0.0.1:${server.port}/tools/progress/   (the event storming editor: /tools/eventstorming/)`)
    await new Promise<void>((done) => process.once('SIGINT', () => done()))
    await server.close()
    return 0
  }, o.readOnly ? { listen: false } : {})
}
