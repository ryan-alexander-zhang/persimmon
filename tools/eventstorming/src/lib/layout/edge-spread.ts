// Parallel-edge separation by corridor. The banded layout puts a whole slice in
// one column, so orthogonal edges that run along the same column (or the same
// row) land on one centreline and overlap — a fan-out, a convergence, or a long
// back-edge (informs / invokes / annotates) crossing the causal chain. We group
// edges into corridors (a column for vertical edges, a row for horizontal ones)
// and assign lanes so overlapping spans get a small side offset while the
// touching causal chain stays on the centre. Pure; needs node positions.
// (design-00003 §3 Tier B; generalises the earlier shared-handle version —
// issue-00003.)

// Only the endpoints are read, so both the board's semantic edges and the
// Context Map's relationship edges can be spread by this one function.
interface EdgeRef {
  id: string;
  source: string;
  target: string;
}

interface Pt {
  x: number;
  y: number;
  // Measured size; when present the corridor centreline is computed in the same
  // node-centre space the edges render in, so lane offsets clear the hit-zone even
  // when a corridor mixes node widths (issue-00005). Absent → treated as 0.
  w?: number;
  h?: number;
}

const GAP = 26; // px between lanes; stays well within a column

/** lane 0 = centre; higher lanes fan out symmetrically (+G, −G, +2G, −2G, …). */
function laneOffset(lane: number): number {
  if (lane === 0) return 0;
  const step = Math.ceil(lane / 2);
  return lane % 2 === 1 ? step * GAP : -step * GAP;
}

const overlaps = (a: { lo: number; hi: number }, b: { lo: number; hi: number }) =>
  !(a.hi <= b.lo || b.hi <= a.lo); // touching endpoints do not count as overlap

/** edgeId → centre offset (px), only for edges pushed off their corridor's
 *  centreline. Deterministic; shorter edges keep the centre so the causal chain
 *  stays straight and only long/crossing edges bow aside. */
export function computeEdgeOffsets(
  edges: readonly EdgeRef[],
  pos: Map<string, Pt>,
): Map<string, number> {
  const out = new Map<string, number>();
  const corridors = new Map<string, Array<{ id: string; lo: number; hi: number; mid: number }>>();
  for (const e of edges) {
    const s = pos.get(e.source);
    const t = pos.get(e.target);
    if (!s || !t) continue;
    const vertical = Math.abs(t.y - s.y) >= Math.abs(t.x - s.x);
    // A cross-column vertical edge runs its long segment out of the source handle,
    // down the *source's* column (getSmoothStepPath), not the endpoint midpoint —
    // so key the corridor by the source coordinate, or such an edge is mis-filed
    // into a phantom corridor and never separated from the column it overlaps
    // (issue-00004). Within-column edges are unaffected (s === midpoint).
    const key = vertical ? `V:${Math.round(s.x)}` : `H:${Math.round(s.y)}`;
    const [a, b] = vertical ? [s.y, t.y] : [s.x, t.x];
    // The edge renders from node centres; its jog anchors at the centre-midpoint
    // (offsetOrthogonalPath). Track that so offsets are computed in render space
    // and lanes clear the hit-zone across mixed node widths (issue-00005).
    const sc = vertical ? s.x + (s.w ?? 0) / 2 : s.y + (s.h ?? 0) / 2;
    const tc = vertical ? t.x + (t.w ?? 0) / 2 : t.y + (t.h ?? 0) / 2;
    const item = { id: e.id, lo: Math.min(a, b), hi: Math.max(a, b), mid: (sc + tc) / 2 };
    const arr = corridors.get(key);
    if (arr) arr.push(item);
    else corridors.set(key, [item]);
  }
  for (const items of corridors.values()) {
    if (items.length < 2) continue;
    // shorter edges claim the centre first; stable tie-break for determinism
    items.sort(
      (p, q) => p.hi - p.lo - (q.hi - q.lo) || p.lo - q.lo || p.id.localeCompare(q.id),
    );
    // Anchor every edge to one corridor centreline (the lane-0 edge's centre) so a
    // lane offset maps to the same absolute px regardless of each edge's own
    // centre-midpoint drift; offsetOrthogonalPath's `mid + offset` then lands on
    // `ref + laneOffset` for all of them.
    const ref = items[0].mid;
    const lanes: Array<Array<{ lo: number; hi: number }>> = [];
    for (const it of items) {
      let lane = lanes.findIndex((occ) => occ.every((o) => !overlaps(it, o)));
      if (lane === -1) {
        lane = lanes.length;
        lanes.push([]);
      }
      lanes[lane].push(it);
      const offset = ref + laneOffset(lane) - it.mid;
      if (offset !== 0) out.set(it.id, offset);
    }
  }
  return out;
}
