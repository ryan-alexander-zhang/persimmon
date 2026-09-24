import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from './sqlite.js'
import type { Addressed, BlobStore } from './store.js'

/** Local-mode BlobStore: `<dir>/<sha256 hex>` holds the bytes, `<dir>/<sha256 hex>.type` the media type. */
export class FileBlobStore implements BlobStore {
  readonly #dir: string

  constructor(dir: string) {
    this.#dir = dir
    mkdirSync(dir, { recursive: true })
  }

  put(bytes: Uint8Array, mediaType: string): Addressed {
    const hex = sha256(bytes)
    const path = join(this.#dir, hex)
    if (!existsSync(path)) {
      writeFileSync(path, bytes)
      writeFileSync(`${path}.type`, mediaType)
    }
    return { uri: `blob://${hex}`, digest: `sha256:${hex}` }
  }

  get(uri: string): { bytes: Uint8Array; mediaType: string } | undefined {
    const hex = uri.replace(/^blob:\/\//, '')
    if (!/^[0-9a-f]{64}$/.test(hex)) return undefined // never join caller text into the path
    const path = join(this.#dir, hex)
    if (!existsSync(path) || !existsSync(`${path}.type`)) return undefined
    return { bytes: readFileSync(path), mediaType: readFileSync(`${path}.type`, 'utf8') }
  }
}
