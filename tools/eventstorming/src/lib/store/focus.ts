// Focus set: given the node under attention (hover or selection), the nodes and
// edges that make up its immediate neighbourhood. The board dims everything
// outside this set so a large model is read one chain at a time (design-00003
// §2/§3 Tier A). Pure — no store or React Flow dependency.

import type { ESEdge, ESNode } from "./types";

export interface FocusSet {
  /** true when a node is focused; false means "show everything at full opacity". */
  active: boolean;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

const EMPTY: FocusSet = { active: false, nodeIds: new Set(), edgeIds: new Set() };

/** All a neighbourhood needs of an edge. Board relations and Context Map
 *  relationships both qualify, so `computeFocus` serves either graph. */
export interface FocusEdge {
  id: string;
  source: string;
  target: string;
}

/** The node that drives the focus set: a hovered node takes precedence over the
 *  selected one, so pointing at a node previews its chain without changing the
 *  selection. */
export function focusSource(
  hoveredId: string | null | undefined,
  selectedId: string | null | undefined,
): string | null {
  return hoveredId ?? selectedId ?? null;
}

export type IsolateDirection = "up" | "down" | "both";

/** The anchor node's N-hop neighbourhood as an induced subgraph, for isolate/focus
 *  mode (design-00003 §3 Tier C). `down` walks source→target (downstream causes),
 *  `up` walks target→source (upstream), `both` is undirected. Returns the reached
 *  nodes and every edge whose endpoints are both reached. */
export function computeNeighborhood(
  anchorId: string | null | undefined,
  edges: ESEdge[],
  opts: { depth: number; direction: IsolateDirection },
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  if (!anchorId) return { nodeIds, edgeIds };
  nodeIds.add(anchorId);
  const down = opts.direction !== "up";
  const up = opts.direction !== "down";
  let frontier = [anchorId];
  for (let d = 0; d < opts.depth && frontier.length; d++) {
    const fset = new Set(frontier);
    const next: string[] = [];
    for (const e of edges) {
      if (down && fset.has(e.source) && !nodeIds.has(e.target)) {
        nodeIds.add(e.target);
        next.push(e.target);
      }
      if (up && fset.has(e.target) && !nodeIds.has(e.source)) {
        nodeIds.add(e.source);
        next.push(e.source);
      }
    }
    frontier = next;
  }
  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) edgeIds.add(e.id);
  }
  return { nodeIds, edgeIds };
}

/** The Bounded Context's slice as an induced subgraph, for isolating a whole
 *  context: its members plus every element directly related to one of them. That
 *  pulls in the context's own and Ungrouped supporting elements *and* the element
 *  on the far side of a seam, so a cross-context relation still reads as a
 *  relation instead of vanishing with its endpoint. */
export function computeContextNeighborhood(
  contextId: string | null | undefined,
  nodes: ESNode[],
  edges: ESEdge[],
): Set<string> {
  const ids = new Set<string>();
  if (!contextId) return ids;
  const members = nodes.filter((n) => n.data.context === contextId).map((n) => n.id);
  for (const id of members) ids.add(id);
  const memberSet = new Set(members);
  for (const e of edges) {
    if (memberSet.has(e.source)) ids.add(e.target);
    if (memberSet.has(e.target)) ids.add(e.source);
  }
  return ids;
}

/** Bounded Context Focus (spec-00010): the same dim-others emphasis at context
 *  granularity. `nodeIds` = the context's member nodes plus their edge neighbours
 *  that are not in a *different* context (the slice's own/Ungrouped supporting
 *  elements). `edgeIds` = every edge incident to a member, so a relation to
 *  another context (a seam) is highlighted while that other context stays dimmed.
 *  An empty context is still active — everything else dims. */
export function computeContextFocus(
  contextId: string | null | undefined,
  nodes: ESNode[],
  edges: ESEdge[],
): FocusSet {
  if (!contextId) return EMPTY;
  const ctxOf = new Map(nodes.map((n) => [n.id, n.data.context]));
  const members = new Set(nodes.filter((n) => n.data.context === contextId).map((n) => n.id));
  const nodeIds = new Set(members);
  const edgeIds = new Set<string>();
  for (const e of edges) {
    const sMember = members.has(e.source);
    const tMember = members.has(e.target);
    if (!sMember && !tMember) continue;
    edgeIds.add(e.id);
    const neighbour = sMember ? e.target : e.source;
    const nctx = ctxOf.get(neighbour);
    if (nctx === undefined || nctx === contextId) nodeIds.add(neighbour);
  }
  return { active: true, nodeIds, edgeIds };
}

/** The focused node plus its direct neighbours, and the edges incident to it. */
export function computeFocus(focusId: string | null | undefined, edges: FocusEdge[]): FocusSet {
  if (!focusId) return EMPTY;
  const nodeIds = new Set<string>([focusId]);
  const edgeIds = new Set<string>();
  for (const e of edges) {
    if (e.source === focusId || e.target === focusId) {
      edgeIds.add(e.id);
      nodeIds.add(e.source);
      nodeIds.add(e.target);
    }
  }
  return { active: true, nodeIds, edgeIds };
}
