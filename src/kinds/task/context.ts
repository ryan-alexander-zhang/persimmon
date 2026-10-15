import { createHash } from 'node:crypto'
import type { ExternalResourceRef } from '../../resource/types.js'
import type { Closure } from '../../snapshot/walk.js'
import { fromClosure } from '../deps.js'
import type { InputSpec, RuntimeValues } from '../ports/types.js'
import { optional } from '../ports/ports.js'
import type { ContextEntry, ResolvedContextEntry } from './types.js'

export class ContextError extends Error {
  constructor(
    readonly code: 'invalid_input' | 'schema_violation',
    message: string,
  ) {
    super(message)
  }
}

/** Resolves `action.context` for one attempt (12-task.md Context, 15-prompt-skill.md). */
export function resolveContext(
  entries: ContextEntry[],
  inputs: Record<string, InputSpec>,
  values: RuntimeValues,
  closure: Closure,
  namespace: string | undefined,
): ResolvedContextEntry[] {
  const out: ResolvedContextEntry[] = []
  for (const e of entries) {
    switch (e.kind) {
      case 'file':
      case 'artifact': {
        const v = values[e.input]
        if (!v) {
          if (inputs[e.input] && optional(inputs[e.input]!)) continue // optional and unbound: dropped
          throw new ContextError('invalid_input', `context ${e.kind}: input ${e.input} absent`)
        }
        if (e.kind === 'file') {
          if (v.kind !== 'externalResource') throw new ContextError('invalid_input', `context file: ${e.input} is not an externalResource`)
          if (!v.ref.version) throw new ContextError('invalid_input', `context file: ${e.input} has no version`)
          out.push({ kind: 'file', ref: v.ref as ExternalResourceRef, path: e.path })
        } else {
          if (v.kind !== 'artifact' && v.kind !== 'artifacts') throw new ContextError('invalid_input', `context artifact: ${e.input} is not an artifact`)
          for (const ref of v.kind === 'artifact' ? [v.ref] : v.refs) out.push({ kind: 'artifact', ref }) // an artifacts port: one entry per ref, in order
        }
        break
      }
      case 'prompt': {
        const p = fromClosure(closure, 'Prompt', namespace, e.ref.name)
        if (!p) throw new ContextError('invalid_input', `Prompt ${e.ref.name} not in the snapshot`)
        const { mediaType, content } = p.spec as { mediaType: string; content: string }
        out.push({ kind: 'prompt', name: e.ref.name, mediaType, content, digest: `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}` })
        break
      }
      case 'skill': {
        const s = fromClosure(closure, 'Skill', namespace, e.ref.name)
        if (!s) throw new ContextError('invalid_input', `Skill ${e.ref.name} not in the snapshot`)
        const { source, digest, format } = s.spec as { source: ExternalResourceRef; digest: string; format: string }
        out.push({ kind: 'skill', name: e.ref.name, source, digest, format })
        break
      }
    }
  }
  return out
}
