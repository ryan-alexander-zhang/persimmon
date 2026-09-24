import { formatErrors, validator } from '../resource/ajv.js'
import type { Handler, HandlerImpl } from './types.js'

export class HandlerError extends Error {}

const handlerSchema = validator<Handler>('handler.yaml')

export function validateHandler(value: unknown): Handler {
  if (!handlerSchema(value)) throw new HandlerError(formatErrors(handlerSchema.errors))
  return value
}

export interface Bound {
  handler: Handler
  /** Absent for an Adapter implementation until the adapter client binds it. */
  impl?: HandlerImpl
}

/** Handlers keyed by `group/version/kind`; one Handler per (kind, version). */
export class HandlerRegistry {
  readonly #builtins: ReadonlyMap<string, HandlerImpl>
  readonly #bound = new Map<string, Bound>()

  constructor(builtins: ReadonlyMap<string, HandlerImpl>) {
    this.#builtins = builtins
  }

  register(value: unknown, o: { replace?: boolean } = {}): Handler {
    const handler = validateHandler(value)
    const impl = 'builtin' in handler.spec.implementation ? this.#builtins.get(handler.spec.implementation.builtin) : undefined
    if ('builtin' in handler.spec.implementation && !impl)
      throw new HandlerError(`${handler.metadata.name}: no builtin named ${handler.spec.implementation.builtin}`)
    const keys = handler.spec.kinds.flatMap((k) => k.versions.map((v) => `${k.group}/${v}/${k.kind}`))
    for (const key of keys) {
      const other = this.#bound.get(key)
      if (other && !(o.replace && other.handler.metadata.name === handler.metadata.name)) throw new HandlerError(`${key} already handled by ${other.handler.metadata.name}`)
    }
    const bound: Bound = impl ? { handler, impl } : { handler }
    for (const key of keys) this.#bound.set(key, bound)
    return handler
  }

  lookup(apiVersion: string, kind: string): Bound | undefined {
    return this.#bound.get(`${apiVersion}/${kind}`)
  }

  get(apiVersion: string, kind: string): Bound {
    const b = this.lookup(apiVersion, kind)
    if (!b) throw new HandlerError(`no Handler for ${apiVersion} ${kind}`)
    return b
  }
}
