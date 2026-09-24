import { Environment } from '@marcbachmann/cel-js'
import type { JsonSchema } from '../kind-definition/types.js'
import { bindValue, celTypeOf, toJson } from './schema-type.js'

export class ExpressionError extends Error {}

/** One expression environment: the roots a site exposes, each typed by a JSON Schema (10-ports.md). */
export class Site {
  readonly #env: Environment
  readonly #roots: Record<string, JsonSchema | undefined>

  constructor(roots: Record<string, JsonSchema | undefined>) {
    this.#roots = roots
    // Map literals mix value types (ValidationResult), so aggregate literals are not homogeneous.
    this.#env = new Environment({ homogeneousAggregateLiterals: false })
    for (const [name, schema] of Object.entries(roots)) {
      const t = celTypeOf(schema)
      if (typeof t === 'string') this.#env.registerVariable(name, t)
      else this.#env.registerVariable({ name, schema: t })
    }
  }

  /** Static rule: the expression parses and type-checks against this site. Returns the result type. */
  check(expression: string): string {
    const r = this.#env.check(expression) as { valid: boolean; type?: string; error?: { message: string } }
    if (!r.valid) throw new ExpressionError(r.error?.message ?? 'invalid expression')
    return r.type ?? 'dyn'
  }

  /** Evaluates with JSON values bound by the root schemas; returns JSON. */
  evaluate(expression: string, context: Record<string, unknown>): unknown {
    const bound = Object.fromEntries(
      Object.entries(context).map(([k, v]) => [k, bindValue(v, this.#roots[k])]),
    )
    try {
      return toJson(this.#env.evaluate(expression, bound))
    } catch (e) {
      throw new ExpressionError((e as Error).message)
    }
  }
}
