import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import type { CredentialSource } from '../config.js'
import { formatErrors, validator } from '../resource/ajv.js'
import type { CredentialStore } from './store.js'

const credentialsFile = validator<Record<string, string>>('store.yaml', '/$defs/CredentialsFile')

/** `<PREFIX><NS>__<NAME>`: upper case, `-` becomes `_` since env names allow neither. */
export function envName(prefix: string, name: string): string {
  const [ns, local] = name.includes('/') ? name.split('/', 2) : [undefined, name]
  const up = (s: string) => s.toUpperCase().replaceAll('-', '_')
  return `${prefix}${ns ? up(ns) + '__' : ''}${up(local!)}`
}

/** Sources tried in order, first match wins (08-store.md). Read-only. */
export class ConfigCredentialStore implements CredentialStore {
  readonly #sources: CredentialSource[]
  readonly #env: NodeJS.ProcessEnv
  readonly #files = new Map<string, Record<string, string>>()

  readonly #run: (cmd: string, args: string[]) => string
  readonly #keychain = new Map<string, string | undefined>()

  constructor(sources: CredentialSource[], env: NodeJS.ProcessEnv = process.env, run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()) {
    this.#sources = sources
    this.#env = env
    this.#run = run
  }

  resolve(name: string): string | undefined {
    for (const s of this.#sources) {
      const v = this.#from(s, name)
      if (v !== undefined) return v
    }
    return undefined
  }

  #from(s: CredentialSource, name: string): string | undefined {
    switch (s.source) {
      case 'env':
        return this.#env[envName(s.prefix ?? 'PERSIMMON_CRED_', name)]
      case 'file':
        return this.#file(s.path!)[name]
      case 'keychain':
        return this.#fromKeychain(name)
      default:
        return undefined // secretManager arrives with server mode
    }
  }

  /** macOS keychain: `security add-generic-password -s persimmon -a <name> -w <secret>`; one lookup per name per process. */
  #fromKeychain(name: string): string | undefined {
    if (!this.#keychain.has(name)) {
      let v: string | undefined
      try {
        v = this.#run('security', ['find-generic-password', '-s', 'persimmon', '-a', name, '-w']).trimEnd()
      } catch {
        v = undefined // not found, or no keychain on this platform
      }
      this.#keychain.set(name, v)
    }
    return this.#keychain.get(name)
  }

  #file(path: string): Record<string, string> {
    let f = this.#files.get(path)
    if (!f) {
      const parsed: unknown = parse(readFileSync(path, 'utf8'))
      if (!credentialsFile(parsed)) throw new Error(`${path}: ${formatErrors(credentialsFile.errors)}`)
      f = parsed
      this.#files.set(path, f)
    }
    return f
  }
}
