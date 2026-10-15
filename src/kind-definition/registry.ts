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

/** The two definitions differ in `versions[].schema` alone. */
const schemaOnly = (a: KindDefinition, b: KindDefinition): boolean => {
  const bare = (d: KindDefinition) => ({ ...d.spec, versions: d.spec.versions.map(({ schema: _s, ...v }) => v) })
  return isDeepStrictEqual(bare(a), bare(b))
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
  readonly #frozen = new Map<string, ValidateFunction>()

  /** A validator for a schema a snapshot froze (05-revisioned-kind.md); compiled once per distinct schema. */
  compile(schema: unknown): ValidateFunction {
    const key = JSON.stringify(schema)
    let v = this.#frozen.get(key)
    if (!v) this.#frozen.set(key, (v = this.#ajv.compile(schema as object)))
    return v
  }

  /**
   * Registers a KindDefinition; `replace` re-registers one (apply again). A revisioned kind's definition changes in
   * `versions[].schema` only, and only when every committed revision `committed(kind)` returns still validates under the
   * new schema (01-kind-definition.md); without `committed` it never changes.
   */
  register(value: unknown, o: { replace?: boolean; dryRun?: boolean; committed?: (kind: string) => Resource[] } = {}): KindDefinition {
    const definition = validateKindDefinition(value)
    const target = definition.spec.expansion && this.byKind(definition.spec.expansion.kind)?.definition // registration order is free; an unregistered target fails at expand time
    if (target?.spec.expansion) throw new KindError(`${definition.metadata.name}: expansion kind ${target.spec.names.kind} is itself a composition`)
    if (target && definition.spec.stepContract && !isDeepStrictEqual(definition.spec.stepContract, target.spec.stepContract)) throw new KindError(`${definition.metadata.name}: stepContract differs from ${target.spec.names.kind}'s`)
    // a revisioned kind's definition, found by name so a renamed kind or version cannot slip past: its schema may change
    // only where the committed revisions still validate (05-revisioned-kind.md)
    const prior = this.definitions().find((d) => d.metadata.name === definition.metadata.name)
    const changed = prior?.spec.revisioned && !isDeepStrictEqual(prior.spec, definition.spec)
    if (changed && !(o.committed && schemaOnly(prior!, definition))) throw new KindError(`${definition.metadata.name} is revisioned; its KindDefinition changes in versions[].schema only`)
    const committed = changed ? o.committed!(definition.spec.names.kind) : []
    const staged = new Map<string, Compiled>()
    for (const version of definition.spec.versions) {
      const key = `${definition.spec.group}/${version.name}/${definition.spec.names.kind}`
      if (this.#kinds.has(key) && !o.replace) throw new KindError(`already registered: ${key}`)
      const compiled: Compiled = { definition, version, spec: this.#ajv.compile(version.schema) }
      if (version.statusSchema) compiled.status = this.#ajv.compile(version.statusSchema)
      for (const r of committed) {
        if (r.apiVersion !== `${definition.spec.group}/${version.name}`) continue
        if (!compiled.spec((r.spec as { content?: unknown }).content)) throw new KindError(`${r.kind}/${r.metadata.namespace}/${r.metadata.name} fails the new schema: ${formatErrors(compiled.spec.errors)}`)
      }
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
