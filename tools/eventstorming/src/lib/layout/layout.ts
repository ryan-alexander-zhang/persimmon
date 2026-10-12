// Deterministic banded layout. Position is a pure function of the model:
//   y = band(type)   (fixed row per element type)
//   x = column(order) (ONE global timeline slot; a Domain Event's slice shares
//                      its column). Bounded Context is an attribute (tint/region),
//                      not part of x — decision-00005.
// The user never sets positions — this is what keeps the board readable.

import type { Context } from "@/lib/eventstorming/grammar";
import { BAND_ORDER, bandIndex } from "@/lib/eventstorming/elements";
import { type Level, LEVEL_TYPES } from "@/lib/eventstorming/levels";
import type { RelationType } from "@/lib/eventstorming/relations";
import type { ESEdge, ESNode } from "@/lib/store/types";

export const COL_W = 230;
export const BAND_H = 132;
// The stacking pitch is also the sticky's height ceiling: nodes sharing a cell sit
// one STACK_H apart, so a taller sticky covers the one below (issue-00036). The
// tallest sticky is a Hotspot — a two-line label (the card clamps it there) plus its
// kind/priority chips, measured at 92px — and the rest of the pitch is its gap.
export const STACK_H = 96;
export const NODE_W = 190;

interface Placement {
  col: number; // global column (timeline slot)
  ctx: string; // context id (attribute — tint/region only)
  lane: number; // parallel sub-lane within the slot (concurrent events)
}

function sourceOf(edges: ESEdge[], target: string, rel: RelationType): string | undefined {
  return edges.find((e) => e.target === target && e.data?.relation === rel)?.source;
}
function targetsOf(edges: ESEdge[], source: string, rel: RelationType): string[] {
  return edges.filter((e) => e.source === source && e.data?.relation === rel).map((e) => e.target);
}

interface Placed {
  place: Map<string, Placement>;
  ctxIds: string[];
}

// Assign every node a global column. Bounded Context is carried only as the
// node's own attribute (for tint/region), never as a column offset.
function computePlacement(nodes: ESNode[], edges: ESEdge[], contexts: Context[]): Placed {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ctxOf = (id: string) => byId.get(id)?.data.context ?? "__none";
  const place = new Map<string, Placement>();
  const set = (id: string | undefined, col: number, lane: number) => {
    if (id && byId.has(id) && !place.has(id)) place.set(id, { ctx: ctxOf(id), col, lane });
  };

  // 1. Domain Events on the single global timeline. Distinct orders → columns;
  //    events sharing an order are concurrent → same column, stacked in sub-lanes
  //    (across contexts too).
  const events = nodes.filter((n) => n.type === "domainEvent");
  const orders = [...new Set(events.map((e) => e.data.order ?? 0))].sort((a, b) => a - b);
  const colByOrder = new Map(orders.map((o, i) => [o, i]));
  const byOrder = new Map<number, ESNode[]>();
  for (const ev of events) {
    const o = ev.data.order ?? 0;
    (byOrder.get(o) ?? byOrder.set(o, []).get(o)!).push(ev);
  }
  for (const [o, group] of byOrder) {
    const col = colByOrder.get(o) ?? 0;
    group.sort((a, b) => a.id.localeCompare(b.id));
    group.forEach((ev, lane) => {
      set(ev.id, col, lane);
      // 2. propagate the event's slot + lane upstream across its slice. An event
      //    is produced directly by a Command (produces, Process) or via an
      //    Aggregate boundary (emits, Design); from the Command we also pull its
      //    Actor, Constraint, and Aggregate into the column.
      const agg = sourceOf(edges, ev.id, "emits");
      if (agg) set(agg, col, lane);
      const cmd = sourceOf(edges, ev.id, "produces") ?? (agg && sourceOf(edges, agg, "handledBy"));
      if (cmd) {
        set(cmd, col, lane);
        set(sourceOf(edges, cmd, "issues"), col, lane);
        set(sourceOf(edges, cmd, "constrainedBy"), col, lane);
        set(sourceOf(edges, cmd, "handledBy"), col, lane);
      }
      for (const p of targetsOf(edges, ev.id, "triggers")) set(p, col, lane);
      for (const rm of targetsOf(edges, ev.id, "updates")) set(rm, col, lane);
    });
  }

  // 3. hotspots take the slot + lane of the element they annotate
  for (const n of nodes) {
    if (n.type !== "hotspot") continue;
    const tgt = targetsOf(edges, n.id, "annotates")[0];
    const p = tgt ? place.get(tgt) : undefined;
    if (p) set(n.id, p.col, p.lane);
  }

  // 4. free (unplaced) nodes have no timeline slot; tile them per band, side by
  //    side in the lowest available columns (a shared column within a band would
  //    read as concurrency, which does not apply). Global per band — context no
  //    longer partitions the column space.
  const occupied = new Map<number, Set<number>>(); // band → placed columns
  for (const [id, p] of place) {
    const t = byId.get(id)?.type;
    if (!t) continue;
    const b = bandIndex(t);
    (occupied.get(b) ?? occupied.set(b, new Set()).get(b)!).add(p.col);
  }
  const nextFree = new Map<number, number>(); // band → next column to try
  for (const n of nodes) {
    if (place.has(n.id)) continue;
    const band = bandIndex(n.type);
    const taken = occupied.get(band);
    let col = nextFree.get(band) ?? 0;
    while (taken?.has(col)) col++;
    nextFree.set(band, col + 1);
    set(n.id, col, 0);
  }

  // 5. context ids (declared first, then any referenced-only) — for tint/region.
  const ordered = [...contexts].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const ctxIds = ordered.map((c) => c.id);
  for (const p of place.values()) if (!ctxIds.includes(p.ctx)) ctxIds.push(p.ctx);

  return { place, ctxIds };
}

interface Rows {
  subRow: Map<string, number>; // sub-row within the band (lane + collision stack)
  globalCol: Map<string, number>;
  bandTops: number[]; // y of each band's top, indexed by band-order row
}

// Resolve each node's sub-row within its band and, from the busiest band, the
// cumulative top y of every band. A band grows by STACK_H per extra sub-row so
// concurrent lanes never overflow into the band below (issue-00002). Bands
// hidden at `level` reserve no height, so the visible bands collapse adjacent
// (issue-00009) — layout is a function of (model, level), never of zoom. With
// `collapseAbsentBands` a band holding no node reserves no height either; that is
// the Isolate view only (issue-00021), where the neighbourhood is laid out as its
// own board — the full board keeps an empty band's space.
function computeRows(
  nodes: ESNode[],
  place: Placed["place"],
  level: Level,
  collapseAbsentBands = false,
): Rows {
  const visibleBand = new Set(LEVEL_TYPES[level].map((t) => bandIndex(t)));
  const cellCount = new Map<string, number>();
  const subRow = new Map<string, number>();
  const globalCol = new Map<string, number>();
  const maxSubRow = new Array(BAND_ORDER.length).fill(0);
  const present = new Set<number>();
  // A node's sub-row inside its band is its event's concurrency lane, so a subset
  // that keeps an event but hides what serves it leaves that lane empty in every
  // supporting band — and still pays its height. On the subset path the lanes each
  // (band, column) actually occupies are dense-ranked, keeping their order: the
  // reclaim the columns already do, on the lane axis (issue-00033). The Domain Events
  // band is untouched where every lane is occupied, as during a walkthrough.
  const laneRank = new Map<string, Map<number, number>>();
  if (collapseAbsentBands) {
    const lanes = new Map<string, Set<number>>();
    for (const n of nodes) {
      const p = place.get(n.id)!;
      const key = `${bandIndex(n.type)}:${p.col.toFixed(2)}`;
      (lanes.get(key) ?? lanes.set(key, new Set()).get(key)!).add(p.lane);
    }
    for (const [key, set] of lanes) {
      laneRank.set(key, new Map([...set].sort((a, b) => a - b).map((lane, i) => [lane, i])));
    }
  }
  for (const n of nodes) {
    const p = place.get(n.id)!; // computePlacement places every node
    const gcol = p.col; // one global timeline — no per-context offset
    const row = bandIndex(n.type);
    const lane = laneRank.get(`${row}:${gcol.toFixed(2)}`)?.get(p.lane) ?? p.lane;
    const cellKey = `${row}:${gcol.toFixed(2)}:${lane}`;
    const stack = cellCount.get(cellKey) ?? 0;
    cellCount.set(cellKey, stack + 1);
    const sr = lane + stack;
    subRow.set(n.id, sr);
    globalCol.set(n.id, gcol);
    present.add(row);
    if (sr > maxSubRow[row]) maxSubRow[row] = sr;
  }
  const bandTops = new Array(BAND_ORDER.length).fill(0);
  for (let r = 1; r < bandTops.length; r++) {
    const holds = visibleBand.has(r - 1) && (!collapseAbsentBands || present.has(r - 1));
    bandTops[r] = bandTops[r - 1] + (holds ? maxSubRow[r - 1] * STACK_H + BAND_H : 0);
  }
  return { subRow, globalCol, bandTops };
}

// Place each node from its resolved column and band row.
function positioned(nodes: ESNode[], rows: Rows): ESNode[] {
  return nodes.map((n) => ({
    ...n,
    position: {
      x: Math.round(rows.globalCol.get(n.id)! * COL_W),
      y: rows.bandTops[bandIndex(n.type)] + rows.subRow.get(n.id)! * STACK_H,
    },
  }));
}

/** Compute a new node array with positions derived from the model. Pure and
 *  deterministic: the same (nodes, edges, contexts, level) always yields the same
 *  layout. Bands hidden at `level` collapse so the visible ones sit adjacent. */
export function computeLayout(
  nodes: ESNode[],
  edges: ESEdge[],
  contexts: Context[],
  level: Level = "design",
): ESNode[] {
  const { place } = computePlacement(nodes, edges, contexts);
  return positioned(nodes, computeRows(nodes, place, level));
}

/** Positions for the **Isolate** view (issue-00021): the `keep` neighbourhood laid
 *  out as its own board, so the columns and bands the hidden elements vacated are
 *  reclaimed instead of being left as empty space. Nodes hidden at `level` drop
 *  out with them. Returns the surviving nodes and their band tops together, so the
 *  board and the band rail cannot disagree. Positions stay a function of
 *  (model, level, neighbourhood) — never of zoom or of the search filter. */
export function computeIsolateLayout(
  nodes: ESNode[],
  edges: ESEdge[],
  contexts: Context[],
  level: Level,
  keep: ReadonlySet<string>,
): { nodes: ESNode[]; bandTops: number[] } {
  const types = new Set<string>(LEVEL_TYPES[level]);
  const kept = nodes.filter((n) => keep.has(n.id) && types.has(n.type));
  const ids = new Set(kept.map((n) => n.id));
  const keptEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const { place } = computePlacement(kept, keptEdges, contexts);
  const rows = computeRows(kept, place, level, true);
  return { nodes: positioned(kept, rows), bandTops: rows.bandTops };
}

/** The y of each band's top (indexed by band-order row), for the band rail so it
 *  tracks the variable band heights. Same inputs as computeLayout. */
export function computeBandTops(
  nodes: ESNode[],
  edges: ESEdge[],
  contexts: Context[],
  level: Level = "design",
): number[] {
  const { place } = computePlacement(nodes, edges, contexts);
  return computeRows(nodes, place, level).bandTops;
}
