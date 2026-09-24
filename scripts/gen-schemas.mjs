// Copies docs/design/schemas/*.yaml into src/generated/schemas.json, keyed by file name.
// Relative $ref values ("resource.yaml#/$defs/Kind") stay as written; ajv resolves them by key.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

const dir = 'docs/design/schemas'
const out = {}
for (const f of readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort()) {
  out[f] = parse(readFileSync(join(dir, f), 'utf8'))
}
writeFileSync('src/generated/schemas.json', JSON.stringify(out, null, 1) + '\n')
console.log(`${Object.keys(out).length} schemas -> src/generated/schemas.json`)
