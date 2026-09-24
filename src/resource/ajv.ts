import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormatsModule from 'ajv-formats'
import schemas from '../generated/schemas.json' with { type: 'json' }

export type SchemaFile = keyof typeof schemas

/** Schema annotations the engine reads (01-kind-definition.md). Declared so strict mode accepts them. */
const annotations = ['x-persimmon-ref', 'x-persimmon-kind-ref', 'x-persimmon-adapter']

/** One Ajv instance holding every design schema under its file name, so "resource.yaml#/$defs/Kind" resolves. */
// ajv-formats ships CJS; under nodenext the default import is typed as the module namespace.
const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default

// strictTypes and strictRequired off: the design schemas use `not: {required: [..]}` without a `type`.
export const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true })
addFormats(ajv)
for (const k of annotations) ajv.addKeyword({ keyword: k, metaSchema: { type: 'object' } })
for (const [file, schema] of Object.entries(schemas)) ajv.addSchema(schema, file)

/** Compiled validator for a schema file, or for a pointer inside it. */
export function validator<T = unknown>(file: SchemaFile, pointer = ''): ValidateFunction<T> {
  const v = ajv.getSchema<T>(`${file}#${pointer}`)
  if (!v) throw new Error(`schema not found: ${file}#${pointer}`)
  return v
}

export function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`).join('; ')
}
