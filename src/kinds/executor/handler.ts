// executor Handler: validate only (13-executor.md rules); Executors never reconcile.
import type { Finding, HandlerImpl, ReconcileInput, ReconcileResult } from '../../handler/types.js'
import { ajv } from '../../resource/ajv.js'
import type { Resource } from '../../resource/types.js'
import type { HandlerDeps } from '../deps.js'
import type { ExecutorSpec } from '../task/types.js'

export function executorHandler(deps: HandlerDeps): HandlerImpl {
  return {
    validate(resource: Resource): { findings: Finding[] } {
      if (resource.kind !== 'Executor') return { findings: [] }
      const spec = resource.spec as unknown as ExecutorSpec
      const f: Finding[] = []
      let describe: { executorTypes?: string[]; configurationSchema?: Record<string, unknown>; supports?: { complete?: boolean } } | undefined
      try {
        describe = deps.adapters.require(spec.adapter, 'executor').status?.describe as typeof describe
      } catch (e) {
        return { findings: [{ severity: 'warning', code: 'adapter_unavailable', path: '/spec/adapter', message: (e as Error).message }] }
      }
      const bad = (path: string, message: string) => f.push({ severity: 'error', code: 'invalid_executor', path, message })
      if (!describe?.executorTypes?.includes(spec.type)) bad('/spec/type', `${spec.adapter} does not execute type ${spec.type}`)
      if (describe?.configurationSchema && !ajv.compile(describe.configurationSchema)(spec.configuration ?? {})) bad('/spec/configuration', 'configuration does not match describe.configurationSchema')
      if (spec.type === 'human' && !describe?.supports?.complete) bad('/spec/type', `${spec.adapter} does not support human completion`)
      const ns = resource.metadata.namespace
      for (const name of spec.security?.credentialBindings ?? []) {
        const owner = name.includes('/') ? name.split('/')[0] : undefined
        if (owner && owner !== ns) bad('/spec/security/credentialBindings', `${name} belongs to another Namespace`)
      }
      return { findings: f }
    },
    reconcile(_input: ReconcileInput): ReconcileResult {
      return { actions: [] }
    },
  }
}
