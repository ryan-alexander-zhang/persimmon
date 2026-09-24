import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { isDeepStrictEqual } from 'node:util'
import type { AuditRecord, ObjectRef, Resource } from '../resource/types.js'
import {
  type Addressed,
  type BlobStore,
  ConflictError,
  NotFoundError,
  ReferencedError,
  type OutboxRecord,
  type OutstandingCall,
  type ResourceKey,
  type RunLogEntry,
  type RunLogEvent,
  type RunLogResult,
  type Store,
  type Timer,
} from './store.js'

const schema = `
create table if not exists resources (
  uid text primary key,
  kind text not null, namespace text not null, name text not null,
  body text not null,
  unique (kind, namespace, name)
);
create table if not exists refs (
  from_uid text not null, kind text not null, namespace text not null, name text not null
);
create index if not exists refs_to on refs (kind, namespace, name);
create table if not exists audit (
  seq integer primary key, uid text not null, body text not null
);
create table if not exists runlog (
  uid text not null, sequence integer not null, dedupe_key text not null,
  event text not null, deliveries integer not null default 0,
  applied_at text, result text,
  primary key (uid, sequence),
  unique (uid, dedupe_key)
);
create table if not exists outbox (
  seq integer primary key, event_id text not null unique, body text not null,
  claimed_by text, claimed_until integer, acked integer not null default 0
);
create table if not exists timers (
  uid text not null, key text not null, at text not null, primary key (uid, key)
);
create table if not exists leases (
  uid text primary key, holder text not null, until integer not null
);
create table if not exists snapshots (
  digest text primary key, bytes blob not null
);
create table if not exists tokens (
  hash text primary key, scope text not null, expires_at text
);
create table if not exists calls (
  uid text not null, idempotency_key text not null, sequence integer not null,
  action text not null, finished integer not null default 0,
  primary key (uid, idempotency_key)
);
`

export interface SqliteStoreOptions {
  blobs: BlobStore
  now?: () => Date
}

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** Local-mode Store on one SQLite file (08-store.md). `:memory:` for tests. Blobs live outside the file. */
export class SqliteStore implements Store {
  readonly #db: DatabaseSync
  readonly #now: () => Date
  readonly blobs: BlobStore
  #depth = 0

  constructor(path: string, options: SqliteStoreOptions) {
    this.#db = new DatabaseSync(path)
    this.#db.exec('pragma journal_mode = wal; pragma foreign_keys = on;')
    this.#db.exec(schema)
    this.#now = options.now ?? (() => new Date())
    this.blobs = options.blobs
  }

  close(): void {
    this.#db.close()
  }

  transaction<T>(fn: () => T): T {
    if (this.#depth > 0) return fn()
    this.#db.exec('begin immediate')
    this.#depth++
    try {
      const out = fn()
      this.#db.exec('commit')
      return out
    } catch (e) {
      this.#db.exec('rollback')
      throw e
    } finally {
      this.#depth--
    }
  }

  readonly resources = {
    put: (resource: Resource): Resource =>
      this.transaction(() => {
        const key = keyOf(resource)
        const current = this.resources.get(key)
        const rv = resource.metadata.resourceVersion
        if (current) {
          if (rv === undefined) throw new ConflictError(`${describe(key)} exists`)
          if (rv !== current.metadata.resourceVersion)
            throw new ConflictError(`${describe(key)}: resourceVersion ${rv} is stale`)
        } else if (rv !== undefined) {
          throw new ConflictError(`${describe(key)} not found for resourceVersion ${rv}`)
        }
        const stored = structuredClone(resource)
        const m = stored.metadata
        if (current) {
          m.uid = current.metadata.uid as string
          m.creationTimestamp = current.metadata.creationTimestamp as string
          m.resourceVersion = String(Number(current.metadata.resourceVersion) + 1)
          m.generation =
            (current.metadata.generation ?? 1) + (isDeepStrictEqual(current.spec, stored.spec) ? 0 : 1)
        } else {
          m.uid = randomUUID()
          m.creationTimestamp = this.#now().toISOString()
          m.resourceVersion = '1'
          m.generation = 1
        }
        const uid = m.uid as string
        this.#db
          .prepare(
            `insert into resources (uid, kind, namespace, name, body) values (?, ?, ?, ?, ?)
             on conflict (uid) do update set body = excluded.body`,
          )
          .run(uid, key.kind, key.namespace ?? '', key.name, JSON.stringify(stored))
        this.#db.prepare('delete from refs where from_uid = ?').run(uid)
        const ins = this.#db.prepare('insert into refs (from_uid, kind, namespace, name) values (?, ?, ?, ?)')
        for (const r of referencesOf(stored)) ins.run(uid, r.kind, r.namespace ?? key.namespace ?? '', r.name)
        return stored
      }),

    get: (key: ResourceKey): Resource | undefined => {
      const row = this.#db
        .prepare('select body from resources where kind = ? and namespace = ? and name = ?')
        .get(key.kind, key.namespace ?? '', key.name) as { body: string } | undefined
      return row ? (JSON.parse(row.body) as Resource) : undefined
    },

    getByUid: (uid: string): Resource | undefined => {
      const row = this.#db.prepare('select body from resources where uid = ?').get(uid) as { body: string } | undefined
      return row ? (JSON.parse(row.body) as Resource) : undefined
    },

    list: (kind: string, namespace?: string, labels?: Record<string, string>): Resource[] => {
      const rows = (
        namespace === undefined
          ? this.#db.prepare('select body from resources where kind = ? order by namespace, name').all(kind)
          : this.#db.prepare('select body from resources where kind = ? and namespace = ? order by name').all(kind, namespace)
      ) as { body: string }[]
      const all = rows.map((r) => JSON.parse(r.body) as Resource)
      if (!labels) return all
      // ponytail: label filter in memory; index labels when lists get large
      return all.filter((r) => Object.entries(labels).every(([k, v]) => r.metadata.labels?.[k] === v))
    },

    delete: (uid: string): void =>
      this.transaction(() => {
        const current = this.resources.getByUid(uid)
        if (!current) throw new NotFoundError(uid)
        const key = keyOf(current)
        const holder = this.#db
          .prepare('select from_uid from refs where kind = ? and namespace = ? and name = ? and from_uid <> ? limit 1')
          .get(key.kind, key.namespace ?? '', key.name, uid) as { from_uid: string } | undefined
        if (holder) throw new ReferencedError(`${describe(key)} is referenced by ${holder.from_uid}`)
        this.#db.prepare('delete from resources where uid = ?').run(uid)
        this.#db.prepare('delete from refs where from_uid = ?').run(uid)
      }),
  }

  readonly runLog = {
    append: (uid: string, event: RunLogEvent): number =>
      this.transaction(() => {
        const dup = this.#db
          .prepare('select sequence from runlog where uid = ? and dedupe_key = ?')
          .get(uid, event.dedupeKey) as { sequence: number } | undefined
        if (dup) return dup.sequence
        const last = this.#db.prepare('select max(sequence) as s from runlog where uid = ?').get(uid) as { s: number | null }
        const sequence = (last.s ?? 0) + 1
        this.#db
          .prepare('insert into runlog (uid, sequence, dedupe_key, event) values (?, ?, ?, ?)')
          .run(uid, sequence, event.dedupeKey, JSON.stringify(event))
        if (event.type === 'AdapterFinished' && typeof event.payload?.idempotencyKey === 'string')
          this.#db
            .prepare('update calls set finished = 1 where uid = ? and idempotency_key = ?')
            .run(uid, event.payload.idempotencyKey)
        return sequence
      }),

    markDelivery: (uid: string, sequence: number): number => {
      this.#db.prepare('update runlog set deliveries = deliveries + 1 where uid = ? and sequence = ?').run(uid, sequence)
      const row = this.#db.prepare('select deliveries from runlog where uid = ? and sequence = ?').get(uid, sequence) as
        | { deliveries: number }
        | undefined
      if (!row) throw new NotFoundError(`runlog ${uid}#${sequence}`)
      return row.deliveries
    },

    ack: (uid: string, sequence: number, result: RunLogResult, appliedAt: string): void =>
      this.transaction(() => {
        const r = this.#db
          .prepare('update runlog set result = ?, applied_at = ? where uid = ? and sequence = ? and applied_at is null')
          .run(JSON.stringify(result), appliedAt, uid, sequence)
        if (r.changes === 0) return
        const ins = this.#db.prepare(
          'insert or ignore into calls (uid, idempotency_key, sequence, action) values (?, ?, ?, ?)',
        )
        for (const a of result.actions)
          if (a.type === 'callAdapter') ins.run(uid, a.idempotencyKey as string, sequence, JSON.stringify(a))
      }),

    read: (uid: string, from = 1): RunLogEntry[] =>
      (
        this.#db
          .prepare('select * from runlog where uid = ? and sequence >= ? order by sequence')
          .all(uid, from) as unknown as RunLogRow[]
      ).map(entryOf),

    listOpen: (): { uid: string; entry: RunLogEntry }[] =>
      (this.#db.prepare('select * from runlog where applied_at is null order by uid, sequence').all() as unknown as RunLogRow[]).map(
        (r) => ({ uid: r.uid, entry: entryOf(r) }),
      ),

    outstandingCalls: (): OutstandingCall[] =>
      (
        this.#db.prepare('select uid, sequence, action from calls where finished = 0 order by uid, sequence').all() as {
          uid: string
          sequence: number
          action: string
        }[]
      ).map((r) => ({ uid: r.uid, sequence: r.sequence, action: JSON.parse(r.action) as Record<string, unknown> })),
  }

  readonly outbox = {
    enqueue: (event: OutboxRecord): void => {
      this.#db
        .prepare('insert or ignore into outbox (event_id, body) values (?, ?)')
        .run(event.eventId, JSON.stringify(event))
    },

    claim: (limit: number, holder: string, ttlMs: number): OutboxRecord[] =>
      this.transaction(() => {
        const now = this.#now().getTime()
        const rows = this.#db
          .prepare(
            `select seq, body from outbox where acked = 0 and (claimed_until is null or claimed_until <= ?)
             order by seq limit ?`,
          )
          .all(now, limit) as unknown as { seq: number; body: string }[]
        const upd = this.#db.prepare('update outbox set claimed_by = ?, claimed_until = ? where seq = ?')
        for (const r of rows) upd.run(holder, now + ttlMs, r.seq)
        return rows.map((r) => JSON.parse(r.body) as OutboxRecord)
      }),

    ack: (eventId: string): void => {
      this.#db.prepare('update outbox set acked = 1 where event_id = ?').run(eventId)
    },
  }

  readonly timers = {
    set: (uid: string, key: string, at: string): void => {
      this.#db
        .prepare('insert into timers (uid, key, at) values (?, ?, ?) on conflict (uid, key) do update set at = excluded.at')
        .run(uid, key, at)
    },
    clear: (uid: string, key: string): void => {
      this.#db.prepare('delete from timers where uid = ? and key = ?').run(uid, key)
    },
    due: (now: string): Timer[] =>
      this.#db.prepare('select uid, key, at from timers where at <= ? order by at, uid, key').all(now) as unknown as Timer[],
  }

  readonly leases = {
    acquire: (uid: string, holder: string, ttlMs: number): boolean =>
      this.transaction(() => {
        const now = this.#now().getTime()
        const r = this.#db
          .prepare(
            `insert into leases (uid, holder, until) values (?, ?, ?)
             on conflict (uid) do update set holder = excluded.holder, until = excluded.until
             where leases.holder = excluded.holder or leases.until <= ?`,
          )
          .run(uid, holder, now + ttlMs, now)
        return r.changes === 1
      }),
    renew: (uid: string, holder: string, ttlMs: number): boolean => {
      const now = this.#now().getTime()
      const r = this.#db
        .prepare('update leases set until = ? where uid = ? and holder = ? and until > ?')
        .run(now + ttlMs, uid, holder, now)
      return r.changes === 1
    },
    release: (uid: string, holder: string): void => {
      this.#db.prepare('delete from leases where uid = ? and holder = ?').run(uid, holder)
    },
  }

  readonly snapshots = {
    put: (bytes: Uint8Array): Addressed => {
      const hex = sha256(bytes)
      this.#db.prepare('insert or ignore into snapshots (digest, bytes) values (?, ?)').run(hex, bytes)
      return { uri: `snapshot://${hex}`, digest: `sha256:${hex}` }
    },
    get: (uri: string): Uint8Array | undefined => {
      const hex = uri.replace(/^snapshot:\/\//, '')
      const row = this.#db.prepare('select bytes from snapshots where digest = ?').get(hex) as { bytes: Uint8Array } | undefined
      return row?.bytes
    },
  }

  readonly tokens = {
    issue: (scope: Record<string, unknown>, expiresAt?: string): string => {
      const token = randomBytes(32).toString('hex')
      this.#db
        .prepare('insert into tokens (hash, scope, expires_at) values (?, ?, ?)')
        .run(sha256(Buffer.from(token)), JSON.stringify(scope), expiresAt ?? null)
      return token
    },
    verify: (token: string): Record<string, unknown> | undefined => {
      const row = this.#db
        .prepare('select scope, expires_at from tokens where hash = ?')
        .get(sha256(Buffer.from(token))) as { scope: string; expires_at: string | null } | undefined
      if (!row) return undefined
      if (row.expires_at && Date.parse(row.expires_at) <= this.#now().getTime()) return undefined
      return JSON.parse(row.scope) as Record<string, unknown>
    },
    revoke: (scope: Record<string, unknown>): void => {
      this.#db.prepare('delete from tokens where scope = ?').run(JSON.stringify(scope))
    },
  }

  readonly audit = {
    append: (record: AuditRecord): void => {
      this.#db.prepare('insert into audit (uid, body) values (?, ?)').run(record.uid, JSON.stringify(record))
    },
    read: (uid: string): AuditRecord[] =>
      (this.#db.prepare('select body from audit where uid = ? order by seq').all(uid) as { body: string }[]).map(
        (r) => JSON.parse(r.body) as AuditRecord,
      ),
  }
}

interface RunLogRow {
  uid: string
  sequence: number
  event: string
  deliveries: number
  applied_at: string | null
  result: string | null
}

function entryOf(r: RunLogRow): RunLogEntry {
  const entry: RunLogEntry = { event: { ...(JSON.parse(r.event) as RunLogEvent), sequence: r.sequence } }
  if (r.deliveries > 0) entry.deliveries = r.deliveries
  if (r.applied_at) entry.appliedAt = r.applied_at
  if (r.result) entry.result = JSON.parse(r.result) as RunLogResult
  return entry
}

function keyOf(r: Resource): ResourceKey {
  return { kind: r.kind, namespace: r.metadata.namespace, name: r.metadata.name }
}

function describe(k: ResourceKey): string {
  return `${k.kind} ${k.namespace ? k.namespace + '/' : ''}${k.name}`
}

/** Targets this Resource points at: ownerReferences plus every ObjectRef or RevisionRef inside spec. */
function referencesOf(r: Resource): ResourceKey[] {
  const out: ResourceKey[] = []
  for (const o of r.metadata.ownerReferences ?? []) out.push({ kind: o.kind, namespace: o.namespace, name: o.name })
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) return v.forEach(walk)
    const o = v as Record<string, unknown>
    if (typeof o.apiVersion === 'string' && typeof o.kind === 'string') {
      if (typeof o.name === 'string') out.push({ kind: o.kind, namespace: o.namespace as string | undefined, name: o.name })
      else if (typeof o.id === 'string' && typeof o.revision === 'number')
        out.push({ kind: o.kind, namespace: o.namespace as string, name: `${o.id}.r${o.revision}` })
      return
    }
    Object.values(o).forEach(walk)
  }
  walk(r.spec)
  return out
}

export type { ObjectRef }
