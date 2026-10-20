# Reconcile

status: active · layer: 0 · schema: [`schemas/reconcile.yaml`](schemas/reconcile.yaml)

One Event in, one transaction out, per Resource, in order.

```text
Event ──append──▶ RunLog(uid) ──▶ dispatcher ──▶ lease(uid) ──▶ Handler.reconcile
                                                                     │
        ┌────────────────────── ONE transaction ─────────────────────┘
        │  statusPatch (statusSchema)   actions[]   outbox events   ack(uid, sequence)
        └─▶ terminal reached? ──▶ ChildFinished to owner   resource.finished to Outbox
```

## Events

| Event | When | Payload | dedupeKey |
|---|---|---|---|
| Created | Resource stored | none | `created` |
| SpecUpdated | `spec` changed on a SpecMutable kind | `{generation ≥ 2}` | `spec/<generation>` |
| ChildFinished | child reached a `terminal.values` value | `{ref (with uid), value}` | `child/<childUid>` |
| TimerFired | a timer this Handler set elapsed | `{key, at}` | `timer/<key>/<at>` |
| Signal | adapter `signal`, API `signal`, or Outbox subscription match | `{source, eventId, payload?}` | `signal/<eventId>` |
| CancelRequested | user or owner asked to cancel; once per Resource | `{reason?}` | `cancel` |
| AdapterFinished | a `callAdapter` returned, failed, or was outstanding at restart | `{idempotencyKey, state, result? \| error?, finishedAt?}`; `finishedAt` is when the answer arrived | `adapter/<idempotencyKey>` |

Delivery: at-least-once, per-Resource order. Duplicate `(uid, dedupeKey)` appends and
duplicate `(uid, sequence)` applications are no-ops. On start the engine redelivers every
unacked Event and delivers every outstanding `callAdapter` as `state: unknown`.

## Actions

| Action | Fields | Effect |
|---|---|---|
| `createResource` | `resource, snapshot?: inherit \| new, owned?: true` | store a Resource; `owned: true` sets `ownerReferences` = this Resource and routes ChildFinished; an existing name with equal `spec` is a no-op (`04-snapshot.md`) |
| `cancelResource` | `ref` | deliver CancelRequested to a child |
| `publishArtifact` | `kind: {apiVersion, kind}, id, content, inputs[]?, representations[]` | stage a revision; visible when this reconcile commits (`05-revisioned-kind.md`) |
| `commitScope` / `abandonScope` | `key` | make visible, or abandon, what an adapter staged under `callAdapter(idempotencyKey: key)` |
| `emitEvent` | `eventType (dotted, lowerCamel segments), payload` | append an Outbox event (`06-outbox.md`) |
| `setTimer` / `clearTimer` | `key (lowercase, `-` `_`), at` / `key` | schedule or cancel TimerFired; same key replaces |
| `callAdapter` | `adapterId, op, payload, idempotencyKey, deadline?, exclusive?` | invoke an Adapter operation; answer arrives as AdapterFinished; past `deadline` the call is `unknown` (`07-adapter.md`); with `exclusive` the engine first takes the Lease `exclusive/<name>` for the call and holds it until the answer, and a drain waits while another holds it |

`status` is written only through the result's `statusPatch` (`02-handler.md`).

## Lease

One lease per `uid`, acquired before `reconcile`, renewed while it runs, released at commit.
A lost lease refuses the commit.

## Commit

1. Apply `statusPatch` as a JSON merge patch (RFC 7386, arrays replaced whole); validate the
   result against `statusSchema`; refuse a change to `terminal.path` once it holds a terminal
   value.
2. In one store transaction: apply `statusPatch`, then every action in order, then every
   emitted Outbox event, then ack `(uid, sequence)`.
3. Failure anywhere discards everything; the Event is redelivered.
4. Kinds with `terminal` only: if `status.<terminal.path>` now holds a terminal value, append
   ChildFinished to the owner, emit `resource.finished`, abandon every publication scope
   of this Resource still open. A later AdapterFinished is still delivered; the Handler ignores it.

## callAdapter

```text
reconcile commits callAdapter ──▶ RunLog records the call ──▶ engine dispatches
                                                                  │
   AdapterFinished {state: succeeded, result}   ◀── ok ──────────┤
   AdapterFinished {state: failed, error}       ◀── error ───────┤
   AdapterFinished {state: unknown}             ◀── engine restarted with no recorded answer
```

An `exclusive` call is dispatched only under its Lease, renewed while the call runs and released
with the answer; a holder that dies lets it expire after `leaseTtl`. A drain does not return while
a call waits for one, so a local verb never exits with an undispatched call that its next start
would mark `unknown`.

The engine never re-issues a call and never treats `unknown` as success. What follows is the
Handler's decision. An `idempotencyKey` is single-use per Resource; a follow-up call takes a
new key.

## RunLog

Append-only per `uid`; the only log.

| Field | Rule |
|---|---|
| `event` | the Event, with its `sequence` and `dedupeKey` |
| `appliedAt` | set when acked |
| `deliveries` | reconcile calls made for this Event |
| `result` | `{statusPatch?, actions[]}` as committed |

## Failure

| Condition | Engine behaviour |
|---|---|
| Handler error or commit failure | retry with exponential backoff; counter per Event |
| `maxReconcileAttempts` (default 10) exhausted | set `metadata.stalled {attempts, lastError?}`, emit `resource.stalled` once, stop delivering |
| any new Event on a stalled Resource | clear `stalled`, resume from the undelivered Event |

## Error

`{code, message, retryable}`. `code` is lowercase snake_case. Layer 0 codes: `timeout`,
`rate_limit`, `transient_network`, `permission_denied`, `invalid_input`, `schema_violation`,
`unknown_result`. Layer 1 adds its own.

## Decisions

- Every Event has a fixed `dedupeKey`; the reference named the field without shapes.
- Signal always carries an `eventId`; API and adapter callers supply one.
- `callAdapter.adapterId` is the `Adapter.spec.id` string; the reference wrote `adapterRef`.
- `idempotencyKey` is single-use per Resource. A `query` after `unknown` takes a new key.
- CancelRequested is delivered once per Resource; a second request is a no-op.
- `createResource` accepts `owned: false` for ownerless Resources (Trigger-created runs) and
  is idempotent on an equal existing Resource.
- `setTimer` with an existing key replaces it.
- Stalled recovery is any new Event. Reference had no recovery path.
- `patchStatus` action removed (`02-handler.md`).
- The RunLog entry keeps the Signal's Actor and the `log` callback text beside the Event; neither
  is in the wire `RunLogEntry` shape. `context.actor` is read from the entry. Found in
  implementation.


## Examples

- [`examples/reconcile-events.yaml`](examples/reconcile-events.yaml): one of each Event;
  validates against `#/$defs/Event`
- [`examples/reconcile-actions.yaml`](examples/reconcile-actions.yaml): one of each Action;
  validates against `#/$defs/Action`
- [`examples/reconcile-runlog.yaml`](examples/reconcile-runlog.yaml): RunLog of one TaskRun
  from Created to Succeeded; validates against `#/$defs/RunLog`
