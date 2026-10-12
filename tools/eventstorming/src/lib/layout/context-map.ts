// Layout + geometry-based handle routing for the Context Map. Pure functions of
// the model, mirroring the board's lib/layout/layout.ts: the map is its own graph
// (a grid by context order, not the timeline engine), and free drag on top is
// view-only scratch — no hand positions in the model (decision-00002).

import type { Context } from "@/lib/eventstorming/grammar";

export interface XY {
  x: number;
  y: number;
}

// Generous spacing so adjacent nodes don't touch and the on-edge relationship
// label (type picker + delete) has clear room between them (issue-00012).
export const CONTEXT_COL_W = 440;
export const CONTEXT_ROW_H = 220;
const PER_ROW = 3;

/** Grid position per Bounded Context, ordered by `order` (id as a tie-break so
 *  the layout is deterministic). */
export function contextMapPositions(contexts: Context[]): Map<string, XY> {
  return new Map(
    [...contexts]
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((c, i) => [
        c.id,
        { x: (i % PER_ROW) * CONTEXT_COL_W, y: Math.floor(i / PER_ROW) * CONTEXT_ROW_H },
      ]),
  );
}

// Handle routing (issue-00012). An edge leaves the source on the side facing the
// target and enters the target on the facing side, so relationships read cleanly
// instead of always binding to the first (left) handle. Handle ids match
// ContextNode. Mirrors the board's routeHandles for element edges.
export function contextEdgeHandles(a: XY, b: XY): { sourceHandle: string; targetHandle: string } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0
      ? { sourceHandle: "s-bottom", targetHandle: "t-top" }
      : { sourceHandle: "s-top", targetHandle: "t-bottom" };
  }
  return dx >= 0
    ? { sourceHandle: "s-right", targetHandle: "t-left" }
    : { sourceHandle: "s-left", targetHandle: "t-right" };
}
