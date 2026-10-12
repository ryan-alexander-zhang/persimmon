// Bounded Context is shown as a sticky colour (decision-00005): a deterministic
// tint per context id, so a context keeps its colour across renames. Shared by
// the element sticky (a left stripe) and the context legend. Ungrouped (no
// context) has no tint.

const CONTEXT_TINTS = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#eab308",
  "#a855f7",
  "#f97316",
  "#14b8a6",
  "#ec4899",
];

export function contextTint(ctx?: string): string | undefined {
  if (!ctx) return undefined;
  let h = 0;
  for (let i = 0; i < ctx.length; i++) h = (h * 31 + ctx.charCodeAt(i)) >>> 0;
  return CONTEXT_TINTS[h % CONTEXT_TINTS.length];
}

// Strategic subdomain classification (spec-00004 FR4). A label + badge colour per
// type — independent of the identity tint above. Core is the strong/invest colour.
export type Subdomain = "core" | "supporting" | "generic";

export const SUBDOMAIN_STYLE: Record<Subdomain, { label: string; color: string }> = {
  core: { label: "Core", color: "#7c3aed" },
  supporting: { label: "Supporting", color: "#0891b2" },
  generic: { label: "Generic", color: "#6b7280" },
};

// Evans's Big Ball of Mud: a designation of one context, not a relationship
// (decision-00015). Orthogonal to the subdomain classification.
export const MUD_STYLE = { label: "Big Ball of Mud", color: "#8d6e63" } as const;
