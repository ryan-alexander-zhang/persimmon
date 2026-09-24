// Appending Events: any new Event on a stalled Resource clears `stalled` (03-reconcile.md Failure).
import { audit } from '../handler/write.js'
import { engineActor } from '../outbox/event.js'
import type { Actor } from '../resource/types.js'
import type { Store } from '../store/store.js'
import type { NewEvent } from './types.js'

export function appendEvent(engine: { store: Store; now: () => Date }, uid: string, event: NewEvent, actor?: Actor): number {
  const { store } = engine
  return store.transaction(() => {
    const seq = store.runLog.append(uid, event as never, actor as unknown as Record<string, unknown> | undefined)
    const r = store.resources.getByUid(uid)
    if (r?.metadata.stalled) {
      const { stalled: _s, ...metadata } = r.metadata
      const stored = store.resources.put({ ...r, metadata })
      store.audit.append(audit(stored, engineActor, engine.now().toISOString(), 'metadata'))
    }
    return seq
  })
}
