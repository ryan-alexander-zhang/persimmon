import { checkBatch, hasErrors } from '../checker/check.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { loadDocs } from './io.js'

/** `persimmon validate <files>`: schema plus static rules against the batch and the stored definitions; non-zero exit on errors. */
export async function validate(cli: Cli, files: string[]): Promise<number> {
  const docs = loadDocs(files)
  const checked = await withEngine(cli, (engine) => checkBatch(docs, engine), { listen: false })
  for (const c of checked) {
    const name = `${c.resource.kind ?? '?'}/${c.resource.metadata?.name ?? '?'}`
    if (c.findings.length === 0) cli.out(`ok    ${name}`)
    for (const f of c.findings) cli.out(`${f.severity === 'error' ? 'error' : 'warn '} ${name}${f.path ? ` ${f.path}` : ''}: ${f.message}`)
  }
  return hasErrors(checked) ? 1 : 0
}
