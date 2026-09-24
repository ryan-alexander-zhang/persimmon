import type { Engine } from '../engine.js'
import type { Resource } from '../resource/types.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { loadDocs } from './io.js'

export interface ApplyOptions {
  namespace?: string
  skipAdapterValidation?: boolean
}

/** `persimmon apply <files>`: write definitions; an Executor on an unreachable Adapter fails unless skipped (13-executor.md). */
export async function apply(cli: Cli, files: string[], o: ApplyOptions = {}): Promise<number> {
  const docs = loadDocs(files) as Resource[]
  return withEngine(cli, (engine) => applyDocs(cli, engine, docs, o))
}

export async function applyDocs(cli: Cli, engine: Engine, docs: Resource[], o: ApplyOptions = {}): Promise<number> {
  let code = 0
  for (const doc of docs) {
    if (o.namespace && !doc.metadata.namespace) doc.metadata.namespace = o.namespace
    try {
      const { resource, created } = await engine.apply(doc)
      const impl = engine.handlers.lookup(resource.apiVersion, resource.kind)?.impl
      const warnings = impl?.validate(resource).findings.filter((f) => f.severity === 'warning') ?? []
      if (!o.skipAdapterValidation && warnings.some((w) => w.code === 'adapter_unavailable')) {
        cli.err(`error ${doc.kind}/${doc.metadata.name}: ${warnings.find((w) => w.code === 'adapter_unavailable')!.message} (use --skip-adapter-validation)`)
        code = 1
        continue
      }
      for (const w of warnings) cli.out(`warn  ${doc.kind}/${doc.metadata.name}: ${w.message}`)
      cli.out(`${created ? 'created' : 'updated'} ${resource.kind}/${resource.metadata.name}`)
    } catch (e) {
      cli.err(`error ${doc.kind}/${doc.metadata.name}: ${(e as Error).message}`)
      code = 1
    }
  }
  return code
}
