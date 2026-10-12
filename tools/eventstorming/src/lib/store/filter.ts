// Search + filter over the board (spec-00006 / us-00018). View-only: these
// predicates never mutate the model and their state never enters the DSL. Pure —
// no store or React Flow dependency.

import type { ElementType } from "@/lib/eventstorming/elements";
import type { ESNode } from "./types";

export interface FilterState {
  /** Free-text search; empty = no search active (nothing highlighted). */
  query: string;
  /** Element types to show. Empty set = all types (no type filter). */
  types: Set<ElementType>;
  /** Bounded Contexts to show; `null` = Ungrouped. Empty set = all contexts. */
  contexts: Set<string | null>;
}

export const EMPTY_FILTER: FilterState = {
  query: "",
  types: new Set(),
  contexts: new Set(),
};

/** Does the node's label or description contain the (trimmed, case-insensitive)
 *  query? An empty query matches nothing, so no highlight shows until the modeller
 *  actually types. */
export function matchesQuery(node: ESNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const label = node.data.label?.toLowerCase() ?? "";
  const description = node.data.description?.toLowerCase() ?? "";
  return label.includes(q) || description.includes(q);
}

/** Is the node shown under the current type/context filter? An empty type set (or
 *  empty context set) means "no restriction on that axis". Ungrouped is `null`. */
export function isShownByFilter(
  node: ESNode,
  filter: Pick<FilterState, "types" | "contexts">,
): boolean {
  if (filter.types.size > 0 && !filter.types.has(node.type as ElementType)) return false;
  if (filter.contexts.size > 0 && !filter.contexts.has(node.data.context ?? null)) return false;
  return true;
}
