import { readFileSync } from 'node:fs'
import { parseAllDocuments, stringify } from 'yaml'

/** Every YAML document in the files, in order; `-` reads stdin. */
export function loadDocs(files: string[]): unknown[] {
  return files.flatMap((f) => parseAllDocuments(readFileSync(f === '-' ? 0 : f, 'utf8')).map((d) => d.toJS() as unknown).filter((d) => d !== null && d !== undefined))
}

export const toYaml = (v: unknown): string => stringify(v, { lineWidth: 0 })

/** `<Kind>/<name>` → parts. */
export function parseRef(arg: string): { kind: string; name?: string } {
  const [kind, name] = arg.split('/', 2)
  if (!kind) throw new Error(`expected <kind>/<name>, got ${arg}`)
  return name ? { kind, name } : { kind }
}
