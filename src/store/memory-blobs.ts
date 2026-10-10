import { sha256 } from './sqlite.js'
import type { BlobStore } from './store.js'

/** In-memory BlobStore: the static checker's throwaway engine and the tests. */
export function memoryBlobs(): BlobStore {
  const m = new Map<string, { bytes: Uint8Array; mediaType: string }>()
  return {
    put(bytes, mediaType) {
      const hex = sha256(bytes)
      m.set(hex, { bytes, mediaType })
      return { uri: `blob://${hex}`, digest: `sha256:${hex}` }
    },
    get: (uri) => m.get(uri.replace(/^blob:\/\//, '')),
  }
}
