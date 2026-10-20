import { serve } from '../server/index.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'

/** `persimmon ui [--port <n>]`: the API and the built tools on loopback until SIGINT. The engine listens: a publish may fire a Trigger whose run calls a stdio Adapter. */
export async function ui(cli: Cli, o: { port?: number } = {}): Promise<number> {
  return withEngine(cli, async (engine) => {
    const server = await serve(engine, o.port === undefined ? {} : { port: o.port })
    cli.out(`persimmon ui: http://127.0.0.1:${server.port}/tools/progress/   (the event storming editor: /tools/eventstorming/)`)
    await new Promise<void>((done) => process.once('SIGINT', () => done()))
    await server.close()
    return 0
  })
}
