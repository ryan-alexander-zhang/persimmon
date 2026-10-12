// Semantic relation types (canvas edge types) and the connection-rule table.
// A connection is valid only if some rule matches (source type, target type);
// the resolved rule also names the relation the edge carries.

import { elements, relations, type RelationType } from "./grammar";
import type { ElementType } from "./elements";

export type { RelationType };

export const RELATION_TYPES = relations.map((r) => r.relation);

export interface ConnectionRule {
  relation: RelationType;
  sources: ElementType[];
  targets: ElementType[];
}

// The grammar's table, with its `'*'` (any element type) expanded for the editor's
// per-pair lookup. The table itself is never restated here (24-eventstorming.md).
const expand = (names: string[]): ElementType[] =>
  names.includes("*") ? [...elements] : (names as ElementType[]);

export const CONNECTION_RULES: ConnectionRule[] = relations.map((r) => ({
  relation: r.relation,
  sources: expand(r.sources),
  targets: expand(r.targets),
}));

/** The relation an edge from `source` to `target` would carry, or null if the
 *  connection is not allowed. Rules are mutually exclusive on the (source,
 *  target) pair (a Command has several rules, one per target), so at most one
 *  matches. */
export function resolveRelation(
  source: ElementType,
  target: ElementType,
): RelationType | null {
  const rule = CONNECTION_RULES.find(
    (r) => r.sources.includes(source) && r.targets.includes(target),
  );
  return rule ? rule.relation : null;
}

export function isValidConnection(source: ElementType, target: ElementType): boolean {
  return resolveRelation(source, target) !== null;
}
