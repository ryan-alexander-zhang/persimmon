import { isDeepStrictEqual } from 'node:util'
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js'
import addFormatsModule from 'ajv-formats'
import { formatErrors, validator } from '../resource/ajv.js'
import type { Resource } from '../resource/types.js'
import type { KindDefinition, KindVersion } from './types.js'

const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default

export class KindError extends Error {}

const kindDefinition = validator<KindDefinition>('kind-definition.yaml')

/** Schema plus the rules outside it that need no other kind (01-kind-definition.md). */
export function validateKindDefinition(value: unknown): KindDefinition {
  if (!kindDefinition(value)) throw new KindError(formatErrors(kindDefinition.errors))
  const { metadata, spec } = value
  const expected = `${spec.names.plural}.${spec.group}`
  if (metadata.name !== expected) throw new KindError(`metadata.name must be ${expected}, got ${metadata.name}`)
  const names = spec.versions.map((v) => v.name)
  if (new Set(names).size !== names.length) throw new KindError(`versions[].name not unique: ${names.join(', ')}`)
  return value
}

interface Compiled {
  definition: KindDefinition
  version: KindVersion
  spec: ValidateFunction
  status?: ValidateFunction
}

/** Registered kinds keyed by `apiVersion/kind`. Compiles each version's schemas once. */
export class KindRegistry {
  // User schemas may carry keywords ajv does not know, so this instance is not strict.
  readonly #ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true })
  readonly #kinds = new Map<string, Compiled>()

  constructor() {
    addFormats(this.#ajv)
  }

  register(value: unknown): KindDefinition {
    const definition = validateKindDefinition(value)
    for (const version of definition.spec.versions) {
      const key = `${definition.spec.group}/${version.name}/${definition.spec.names.kind}`
      if (this.#kinds.has(key)) throw new KindError(`already registered: ${key}`)
      const compiled: Compiled = { definition, version, spec: this.#ajv.compile(version.schema) }
      if (version.statusSchema) compiled.status = this.#ajv.compile(version.statusSchema)
      this.#kinds.set(key, compiled)
    }
    return definition
  }

  lookup(apiVersion: string, kind: string): Compiled | undefined {
    return this.#kinds.get(`${apiVersion}/${kind}`)
  }

  get(apiVersion: string, kind: string): Compiled {
    const c = this.lookup(apiVersion, kind)
    if (!c) throw new KindError(`unregistered kind: ${apiVersion} ${kind}`)
    return c
  }

  /** KindDefinition-schema stage of the write order: spec by `schema`, status by `statusSchema`. */
  validateResource(resource: Resource): void {
    const c = this.get(resource.apiVersion, resource.kind)
    const { scope, revisioned } = c.definition.spec
    const ns = resource.metadata.namespace
    if (scope === 'Global' && ns) throw new KindError(`${resource.kind} is Global; namespace not allowed`)
    if (scope === 'Namespaced' && !ns) throw new KindError(`${resource.kind} is Namespaced; namespace required`)
    // A revisioned kind's schema validates spec.content (05-revisioned-kind.md).
    const subject = revisioned ? (resource.spec as { content?: unknown }).content : resource.spec
    if (!c.spec(subject)) throw new KindError(`spec: ${formatErrors(c.spec.errors)}`)
    if (c.status && resource.status !== undefined && !c.status(resource.status))
      throw new KindError(`status: ${formatErrors(c.status.errors)}`)
  }

  /** Immutable freezes spec after create. */
  checkMutability(current: Resource, next: Resource): void {
    const c = this.get(current.apiVersion, current.kind)
    if (c.definition.spec.mutability === 'Immutable' && !isDeepStrictEqual(current.spec, next.spec))
      throw new KindError(`${current.kind} is Immutable; spec may not change`)
  }
}
