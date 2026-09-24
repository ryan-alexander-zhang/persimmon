import { existsSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { createAjv, formatErrors } from './resource/ajv.js'

export class ConfigError extends Error {}

export interface CredentialSource {
  source: 'env' | 'file' | 'keychain' | 'secretManager'
  prefix?: string
  path?: string
  url?: string
}

export interface ActorKey {
  kind: 'user' | 'service'
  id: string
}

/** persimmon.yaml after defaults (08-store.md, schemas/store.yaml). */
export interface Config {
  mode: 'local' | 'server'
  store: { sqlite: string } | { postgres: string }
  blobs: string
  defaultNamespace: string
  credentials: CredentialSource[]
  maxReconcileAttempts: number
  maxCausationDepth: number
  defaultCallDeadline: string
  leaseTtl: string
  server?: {
    listen: string
    tls: { cert: string; key: string }
    auth: { tokens: { actor: ActorKey; tokenHash: string }[] }
    grants: { actor: ActorKey; namespaces: '*' | string[]; admin?: boolean }[]
  }
}

// Own instance: defaults are written into the config object, which the shared instance must not do to Resources.
const validate = createAjv({ useDefaults: true }).getSchema<Config>('store.yaml')!

/** Validates and fills defaults. `{}` is the default local config. */
export function parseConfig(value: unknown): Config {
  const v: unknown = structuredClone(value ?? {})
  if (!validate(v)) throw new ConfigError(`persimmon.yaml: ${formatErrors(validate.errors)}`)
  return v as Config
}

/** Reads `persimmon.yaml` at `path`; a missing file means defaults. */
export function loadConfig(path = 'persimmon.yaml'): Config {
  return parseConfig(existsSync(path) ? parse(readFileSync(path, 'utf8')) : {})
}

const unit: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** Duration grammar `^[0-9]+(ms|s|m|h|d)$` to milliseconds. */
export function durationMs(d: string): number {
  const m = /^([0-9]+)(ms|s|m|h|d)$/.exec(d)
  if (!m) throw new ConfigError(`bad duration: ${d}`)
  return Number(m[1]) * unit[m[2]!]!
}
