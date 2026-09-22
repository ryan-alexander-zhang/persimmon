# Outbox

status: draft · layer: 0 · schema: [`schemas/outbox.yaml`](schemas/outbox.yaml)

The Outbox is a Store component; a write and the Outbox event it causes commit together.

```text
store write ────────── resource.created ──┐
reconcile commit ───── resource.finished ─┤
retry exhausted ────── resource.stalled ──┼─▶ Outbox ─poll─▶ subscriptions ─match─▶ Signal {source: outbox}
publish commit ─────── artifact.published ┤                                         to every live Resource of the kind
emitEvent action ───── <handler type> ────┘                                         in the subject's Namespace
                                                  causationChain longer than maxCausationDepth ─▶ event.suppressed
```

## Outbox event

| Field | Rule |
|---|---|
| `eventId` | `sha256:` over the canonical encoding (`04-snapshot.md`) of `{type, subject, time, producer?, ordinal}` |
| `type` | dotted string (`03-reconcile.md` `OutboxEventType`); `resource.*`, `artifact.*`, `event.*` reserved |
| `time` | commit time |
| `subject` | ObjectRef; RevisionRef for `artifact.published`; the reconciling Resource for `emitEvent` |
| `producer` | `{uid, sequence}` of the committing reconcile; absent for store writes and engine-emitted types |
| `ordinal` | position among the events of one transaction |
| `actor` | Actor of the committing write; `{kind: service, id: engine}` when none |
| `causationChain[]` | `eventId`s that led here, oldest first |
| `payload` | per type; a pointer, never content; subscribers read through Engine callbacks |

## Framework types

| Type | When | Payload |
|---|---|---|
| `resource.created` | Resource stored, in the storing transaction; not for revisions | `{}` |
| `resource.finished` | `status.<terminal.path>` reached a `terminal.values` value (`03-reconcile.md` commit step 4) | `{value}` |
| `resource.stalled` | `metadata.stalled` set | `{attempts, lastError?}` |
| `artifact.published` | a revision committed | `{contentDigest}` |
| `event.suppressed` | loop guard tripped; subject is the suppressed event's subject | `{suppressedEventId, suppressedType, causationChain}` |

## Causation

| Step | Chain |
|---|---|
| Signal reconciled | Signal's `eventId` appended to the receiver's chain |
| `createResource` | child starts with the creator's chain |
| ChildFinished reconciled | owner continues with the child's chain |
| event emitted | carries the emitting reconcile's chain |
| store write from the API | empty |

The engine keeps the chain per Resource in the RunLog; it is not in `metadata`.

## Subscription

`KindDefinition.spec.subscriptions[] = {eventType, filter?}` (`01-kind-definition.md`).

| Rule | Value |
|---|---|
| match | `type == eventType` and `filter` (CEL over `event` only) is true or absent |
| receivers | every Resource of the kind in the subject's Namespace, not at a terminal value; a Global subject reaches every Namespace |
| self | an ObjectRef subject never receives its own event |
| delivery | engine claims the event (`08-store.md`), appends Signal `{source: outbox, eventId, payload: event}` to each receiver's RunLog, then `ack(eventId)` |
| guarantee | at-least-once; `dedupeKey: signal/<eventId>` makes redelivery a no-op |
| loop guard | chain length > `maxCausationDepth` (engine config, default 32, `08-store.md`): not delivered, one `event.suppressed` per suppressed event |

## Rules

| Rule | Enforcer |
|---|---|
| Outbox event committed in the producing transaction | engine |
| reserved types not emitted by `emitEvent` | write path of the action |
| `filter` parses and type-checks against the Outbox event shape | static checker at KindDefinition admission |

## Decisions

- `resource.statusChanged` renamed `resource.finished` and fires only on reaching a terminal
  value. Reference did not say which status changes count.
- `eventId` includes `time` and `ordinal`, so two emits of one type in one reconcile stay
  distinct. Reference hashed `(eventKind, subjectRef)` only.
- Causation propagates through `createResource` and ChildFinished, so a publish → Trigger →
  run → publish loop is caught by the Layer 0 guard. Reference propagated through Signals only.
- Delivery is Namespace-scoped and skips terminal Resources. Reference fanned out to every
  Resource of the kind.
- Engine-emitted events carry `{kind: service, id: engine}`.
- A committed revision emits `artifact.published` only, not `resource.created`.
- `timer.fired` dropped; TimerFired is a reconcile Event, not a bus concern.

## Examples

- [`examples/outbox-events.yaml`](examples/outbox-events.yaml): one of each framework type
  and one handler type; validates against `#/$defs/OutboxEvent`
- [`examples/outbox-delivery.yaml`](examples/outbox-delivery.yaml): an `artifact.published`
  event matched by the Trigger kind's subscription and delivered as a Signal; validates
  against `#/$defs/Delivery`
