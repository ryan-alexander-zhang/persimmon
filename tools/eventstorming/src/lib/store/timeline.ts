// Timeline order helpers for Domain Events. The board has ONE global timeline
// (decision-00005): the sorted distinct global `order` values of all Domain
// Events are its column slots; events sharing a value are a concurrency group
// stacked in that slot. Edits write a (possibly fractional) target order, then
// normalize back to contiguous 0..k-1 — so "slot index i" always means
// "order === i". Bounded Context is an attribute, not part of the ordering.

import type { ESNode } from "./types";

const isEvent = (n: ESNode) => n.type === "domainEvent";
const orderOf = (n: ESNode) => n.data.order ?? 0;

/** Sorted distinct global orders of all Domain Events = the timeline's slots. */
export function slotOrders(nodes: ESNode[]): number[] {
  const orders = nodes.filter(isEvent).map(orderOf);
  return [...new Set(orders)].sort((a, b) => a - b);
}

/** The slot index (0-based) of an event on the global timeline, or -1. */
export function eventSlotIndex(nodes: ESNode[], eventId: string): number {
  const ev = nodes.find((n) => n.id === eventId);
  if (!ev || !isEvent(ev)) return -1;
  return slotOrders(nodes).indexOf(orderOf(ev));
}

/** All Domain Event ids in global timeline order — sorted by (order, id). The
 *  board's left→right order and the narrative walkthrough (spec-00005) both use
 *  this; concurrent events (equal order) become adjacent by id. */
export function timelineOrder(nodes: ESNode[]): string[] {
  return nodes
    .filter(isEvent)
    .sort((a, b) => orderOf(a) - orderOf(b) || a.id.localeCompare(b.id))
    .map((n) => n.id);
}

/** An order value that lands an event at gap `index` (0..slotCount): before the
 *  first slot, between two slots (midpoint), or after the last. Normalization
 *  then collapses the fractional value back to an integer. */
export function gapOrder(orders: number[], index: number): number {
  if (orders.length === 0) return 0;
  if (index <= 0) return orders[0] - 1;
  if (index >= orders.length) return orders[orders.length - 1] + 1;
  return (orders[index - 1] + orders[index]) / 2;
}

/** Remap all Domain Events' global orders to contiguous 0..k-1, preserving
 *  concurrency groups (equal orders stay equal). Other nodes are untouched. */
export function normalizeOrders(nodes: ESNode[]): ESNode[] {
  const rank = new Map(slotOrders(nodes).map((o, i) => [o, i]));
  return nodes.map((n) =>
    isEvent(n) ? { ...n, data: { ...n.data, order: rank.get(orderOf(n)) ?? 0 } } : n,
  );
}

/** One timeline column: its `order` value and flow-space x anchor (a member
 *  node's position.x). Slots are passed sorted left→right. */
export interface TimelineSlot {
  order: number;
  x: number;
}

export type DropTarget = { kind: "gap"; index: number } | { kind: "onto"; order: number };

/** Resolve a drag's flow-space `x` against the timeline's slots into a drop
 *  target: within `ontoBand` of a slot's anchor → make concurrent with it (onto,
 *  drawn as a column highlight); otherwise insert at the gap boundary the x falls
 *  into (0..slotCount, drawn as an insertion line). */
export function dropTarget(slots: TimelineSlot[], x: number, ontoBand: number): DropTarget {
  if (slots.length === 0) return { kind: "gap", index: 0 };
  for (const s of slots) {
    if (Math.abs(x - s.x) <= ontoBand) return { kind: "onto", order: s.order };
  }
  let index = 0;
  while (index < slots.length && x > slots[index].x) index++;
  return { kind: "gap", index };
}

/** The order to commit when a Domain Event is dropped at flow-space `x` on the
 *  single global timeline (decision-00005): `onto` → the target slot's order
 *  (concurrent); a gap → an insertion order between/beyond slots. The event's
 *  Bounded Context is unaffected by the drag (us-00015). */
export function dropOrder(
  slots: TimelineSlot[],
  orders: number[],
  x: number,
  ontoBand: number,
): number {
  const t = dropTarget(slots, x, ontoBand);
  return t.kind === "onto" ? t.order : gapOrder(orders, t.index);
}
