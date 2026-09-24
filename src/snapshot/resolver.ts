import type { AdapterRegistry } from '../adapter/registry.js'
import type { KindRegistry } from '../kind-definition/registry.js'
import type { Store } from '../store/store.js'
import type { Resolver } from './walk.js'

/** The engine's Resolver: live registries and Store, root Namespace first then Global. */
export function liveResolver(kinds: KindRegistry, store: Store, adapters: AdapterRegistry): Resolver {
  return {
    kindByName: (k) => kinds.byKind(k)?.definition,
    kind: (av, k) => kinds.lookup(av, k)?.definition,
    definition: (kind, ns, name) => (ns ? store.resources.get({ kind, namespace: ns, name }) : undefined) ?? store.resources.get({ kind, name }),
    adapterDigest: (id) => {
      const a = adapters.require(id)
      return a.status?.describeDigest as string
    },
  }
}
