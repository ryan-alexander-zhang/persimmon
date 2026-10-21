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

const byOrder = (a: Context, b: Context) => a.order - b.order || a.id.localeCompare(b.id);

/** Room above a group's contexts for its header, and between groups; a box ends
 *  one context's footprint past its last column and row, not a full grid cell. */
export const GROUP_PAD = 48;
export const GROUP_GAP = 40;
const NODE_W = 220;
const NODE_H = 90;

/** One row of the map per subdomain (DSL 4.1 `contexts[].subdomain`): the Prd's
 *  problem space, drawn around the contexts that realise it. Groups order by their
 *  first context; contexts without a subdomain come last, under no header. Empty
 *  when no context names one, so a model without subdomains is a plain grid. */
export interface SubdomainGroup {
  subdomain?: string;
  contexts: Context[];
  /** Box in map space, the contexts' positions already inside it. */
  box: XY & { w: number; h: number };
}

export function contextMapGroups(contexts: Context[]): SubdomainGroup[] {
  if (!contexts.some((c) => c.subdomain)) return [];
  const bySub = new Map<string | undefined, Context[]>();
  for (const c of [...contexts].sort(byOrder)) {
    const list = bySub.get(c.subdomain) ?? [];
    list.push(c);
    bySub.set(c.subdomain, list);
  }
  const keys = [...bySub.keys()].sort((a, b) => (a === undefined ? 1 : b === undefined ? -1 : 0));
  let y = 0;
  return keys.map((subdomain) => {
    const list = bySub.get(subdomain)!;
    const cols = Math.min(list.length, PER_ROW);
    const rows = Math.ceil(list.length / PER_ROW);
    const h = GROUP_PAD + (rows - 1) * CONTEXT_ROW_H + NODE_H;
    const w = (cols - 1) * CONTEXT_COL_W + NODE_W;
    const g = { subdomain, contexts: list, box: { x: 0, y, w, h } };
    y += h + GROUP_GAP;
    return g;
  });
}

/** Grid position per Bounded Context, ordered by `order` (id as a tie-break so
 *  the layout is deterministic); rows per subdomain when any context names one. */
export function contextMapPositions(contexts: Context[]): Map<string, XY> {
  const groups = contextMapGroups(contexts);
  if (groups.length === 0) {
    return new Map(
      [...contexts]
        .sort(byOrder)
        .map((c, i) => [
          c.id,
          { x: (i % PER_ROW) * CONTEXT_COL_W, y: Math.floor(i / PER_ROW) * CONTEXT_ROW_H },
        ]),
    );
  }
  const pos = new Map<string, XY>();
  for (const g of groups) {
    g.contexts.forEach((c, i) => {
      pos.set(c.id, {
        x: g.box.x + (i % PER_ROW) * CONTEXT_COL_W,
        y: g.box.y + GROUP_PAD + Math.floor(i / PER_ROW) * CONTEXT_ROW_H,
      });
    });
  }
  return pos;
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
