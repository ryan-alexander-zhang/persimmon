// Visual styling for semantic edges, by relation type. Two tiers let the eye
// follow a chain by weight and colour instead of untangling geometry: the
// causal chain (actor→command→…→event→policy) renders heavier and saturated;
// secondary relations (read-side updates/informs and hotspot annotations)
// render thinner and lighter. Pure data — no rendering here (design-00003 §3).

import type { RelationType } from "./relations";

export type RelationTier = "chain" | "secondary";

export interface RelationStyle {
  color: string;
  width: number;
  tier: RelationTier;
}

const CHAIN_W = 2;
const SECONDARY_W = 1.25;

/** Lift for the label of an emphasised edge, on either surface. React Flow stacks
 *  its viewport layers — edges, edge labels, nodes — by DOM order at `z-index: auto`,
 *  so a node paints over any label under it and swallows the pointer with it: the
 *  label carries the relation's picker and delete, which then cannot be clicked
 *  (issue-00034). It is carried by the label itself rather than by the layer, so a
 *  resting label still reads as *under* the board — on the Context Map every label is
 *  always visible, and lifting the layer floated all of them over the context cards
 *  (issue-00035). 1001 clears the 1000 React Flow gives a selected node. */
export const EDGE_LABEL_Z = 1001;

export const RELATION_STYLE: Record<RelationType, RelationStyle> = {
  issues: { tier: "chain", color: "#2563eb", width: CHAIN_W },
  produces: { tier: "chain", color: "#b45309", width: CHAIN_W },
  constrainedBy: { tier: "secondary", color: "#0d9488", width: SECONDARY_W },
  handledBy: { tier: "chain", color: "#7c3aed", width: CHAIN_W },
  emits: { tier: "chain", color: "#ea580c", width: CHAIN_W },
  triggers: { tier: "chain", color: "#9333ea", width: CHAIN_W },
  invokes: { tier: "chain", color: "#0891b2", width: CHAIN_W },
  updates: { tier: "secondary", color: "#16a34a", width: SECONDARY_W },
  informs: { tier: "secondary", color: "#65a30d", width: SECONDARY_W },
  annotates: { tier: "secondary", color: "#db2777", width: SECONDARY_W },
  highlights: { tier: "secondary", color: "#059669", width: SECONDARY_W },
};
