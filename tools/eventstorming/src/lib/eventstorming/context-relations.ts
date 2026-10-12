// Strategic context-mapping relationship types (spec-00004 FR5). The full
// canonical DDD context-map set (Eric Evans; ddd-crew) — decision-00007. Every
// relationship is directed source → target, read as upstream → downstream;
// symmetric patterns ignore the arrow's meaning. Pure data — no rendering here
// (parallels edge-style.ts for element relations).

import { contextRelations, type ContextRelationType } from "./grammar";

export const CONTEXT_RELATION_TYPES = contextRelations;
export type { ContextRelationType };

export interface ContextRelationStyle {
  /** Short label shown on the map edge. */
  label: string;
  color: string;
  /** Symmetric patterns (arrow direction is not meaningful). */
  symmetric: boolean;
}

export const CONTEXT_RELATION_STYLE: Record<ContextRelationType, ContextRelationStyle> = {
  partnership: { label: "Partnership", color: "#0891b2", symmetric: true },
  sharedKernel: { label: "Shared Kernel", color: "#7c3aed", symmetric: true },
  customerSupplier: { label: "Supplier ▶ Customer", color: "#2563eb", symmetric: false },
  conformist: { label: "Conformist", color: "#b45309", symmetric: false },
  acl: { label: "Anticorruption Layer", color: "#dc2626", symmetric: false },
  openHostService: { label: "Open Host Service", color: "#15803d", symmetric: false },
  publishedLanguage: { label: "Published Language", color: "#db2777", symmetric: false },
  separateWays: { label: "Separate Ways", color: "#6b7280", symmetric: true },
};

/** The default type for a freshly drawn relationship (us-00020-FR-2). */
export const DEFAULT_CONTEXT_RELATION: ContextRelationType = "customerSupplier";
