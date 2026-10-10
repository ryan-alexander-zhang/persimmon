import { isDeepStrictEqual } from 'node:util'
import type { ValidateFunction } from 'ajv/dist/2020.js'
import { createAjv, formatErrors, validator } from '../resource/ajv.js'
import type { Resource } from '../resource/types.js'
import type { KindDefinition, KindVersion } from './types.js'

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
  // It holds the design schemas too, so a shipped KindDefinition may $ref "ports.yaml#/$defs/Bindings".
  readonly #ajv = createAjv({ strict: false })
  readonly #kinds = new Map<string, Compiled>()

  /** Registers a KindDefinition; `replace` re-registers a SpecMutable one (apply again). */
  register(value: unknown, o: { replace?: boolean; dryRun?: boolean } = {}): KindDefinition {
    const definition = validateKindDefinition(value)
    const target = definition.spec.expansion && this.byKind(definition.spec.expansion.kind)?.definition // registration order is free; an unregistered target fails at expand time
    if (target?.spec.expansion) throw new KindError(`${definition.metadata.name}: expansion kind ${target.spec.names.kind} is itself a composition`)
    if (target && definition.spec.stepContract && !isDeepStrictEqual(definition.spec.stepContract, target.spec.stepContract)) throw new KindError(`${definition.metadata.name}: stepContract differs from ${target.spec.names.kind}'s`)
    const staged = new Map<string, Compiled>()
    for (const version of definition.spec.versions) {
      const key = `${definition.spec.group}/${version.name}/${definition.spec.names.kind}`
      const existing = this.#kinds.get(key)
      if (existing && !o.replace) throw new KindError(`already registered: ${key}`)
      // a revisioned kind's schema is frozen: committed revisions were validated against it (05-revisioned-kind.md)
      if (existing?.definition.spec.revisioned && !isDeepStrictEqual(existing.definition.spec, definition.spec)) throw new KindError(`${key} is revisioned; its KindDefinition never changes`)
      const compiled: Compiled = { definition, version, spec: this.#ajv.compile(version.schema) }
      if (version.statusSchema) compiled.status = this.#ajv.compile(version.statusSchema)
      staged.set(key, compiled)
    }
    if (!o.dryRun) for (const [key, compiled] of staged) this.#kinds.set(key, compiled)
    return definition
  }

  /** Every registered KindDefinition once. */
  definitions(): KindDefinition[] {
    return [...new Set([...this.#kinds.values()].map((c) => c.definition))]
  }

  /** By kind name alone, as a LocalDefinitionRef names it. Kind names are unique across groups in v1. */
  byKind(kind: string): Compiled | undefined {
    for (const c of this.#kinds.values()) if (c.definition.spec.names.kind === kind) return c
    return undefined
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
