import { formatErrors, validator } from '../resource/ajv.js'
import { canonicalBytes, digestOf } from '../snapshot/canonical.js'
import type { CredentialStore } from '../store/store.js'
import { call } from './transport.js'
import type { Adapter, CallOptions, CallOutcome, Describe } from './types.js'

export class AdapterError extends Error {}

const adapterSchema = validator<Adapter>('adapter.yaml')
const describeSchema = validator<Describe>('adapter.yaml', '/$defs/Describe')

export function validateAdapter(value: unknown): Adapter {
  if (!adapterSchema(value)) throw new AdapterError(formatErrors(adapterSchema.errors))
  return value
}

/** `describe` at apply: fills status.describe, describeDigest and the Ready condition (07-adapter.md). */
export async function describe(adapter: Adapter, credentials: CredentialStore, now: () => Date, o: CallOptions = {}): Promise<Adapter> {
  const out = await call(adapter.spec, 'describe', {}, credentials, o)
  const time = now().toISOString()
  const notReady = (reason: string): Adapter => ({
    ...adapter,
    status: { ...adapter.status, conditions: [{ type: 'Ready', status: 'False', reason, lastTransitionTime: time }] },
  })
  if (out.state !== 'succeeded') return notReady(out.state === 'failed' ? out.error.message : out.state === 'unknown' ? out.reason : 'pending')
  const d = out.result
  if (!describeSchema(d)) return notReady(`describe: ${formatErrors(describeSchema.errors)}`)
  if (d.adapterId !== adapter.spec.id) return notReady(`describe.adapterId ${d.adapterId} != ${adapter.spec.id}`)
  const missing = adapter.spec.roles.filter((r) => !d.roles.includes(r))
  if (missing.length) return notReady(`roles not reported: ${missing.join(', ')}`)
  return {
    ...adapter,
    status: {
      describe: d,
      describeDigest: digestOf(canonicalBytes(d)),
      conditions: [{ type: 'Ready', status: 'True', lastTransitionTime: time }],
    },
  }
}

export const isReady = (a: Adapter): boolean => a.status?.conditions?.some((c) => c.type === 'Ready' && c.status === 'True') ?? false

/** Ready Adapters by id; the engine's view for `x-persimmon-adapter` checks and callAdapter. */
export class AdapterRegistry {
  readonly #adapters = new Map<string, Adapter>()
  readonly #credentials: CredentialStore
  readonly #cwd: string | undefined

  constructor(credentials: CredentialStore, cwd?: string) {
    this.#credentials = credentials
    this.#cwd = cwd
  }

  register(adapter: Adapter): void {
    this.#adapters.set(adapter.spec.id, adapter)
  }

  get(id: string): Adapter | undefined {
    return this.#adapters.get(id)
  }

  /** Ready with the Role, else throws: what every `x-persimmon-adapter` field needs. */
  require(id: string, role?: string): Adapter {
    const a = this.#adapters.get(id)
    if (!a) throw new AdapterError(`adapter ${id} not registered`)
    if (!isReady(a)) throw new AdapterError(`adapter ${id} not Ready`)
    if (role && !a.spec.roles.includes(role)) throw new AdapterError(`adapter ${id} lacks role ${role}`)
    return a
  }

  /** A Role op; the engine sets `payload.engine` before calling (07-adapter.md). */
  call(id: string, op: string, payload: Record<string, unknown>, o: CallOptions = {}): Promise<CallOutcome> {
    return call(this.require(id).spec, op, payload, this.#credentials, { ...(this.#cwd ? { cwd: this.#cwd } : {}), ...o })
  }
}
