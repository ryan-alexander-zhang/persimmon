import { describe, expect, it } from "vitest";
import { RELATION_STYLE, type RelationTier } from "./edge-style";
import { RELATION_TYPES } from "./relations";

describe("relation edge styling (RA1)", () => {
  it("styles every relation type with a valid colour and positive width", () => {
    for (const r of RELATION_TYPES) {
      const s = RELATION_STYLE[r];
      expect(s, r).toBeDefined();
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.width).toBeGreaterThan(0);
    }
  });

  it("has no styles for relations that do not exist", () => {
    expect(Object.keys(RELATION_STYLE).sort()).toEqual([...RELATION_TYPES].sort());
  });

  it("partitions relations into the two tiers (no gap, no overlap)", () => {
    const byTier = (t: RelationTier) =>
      RELATION_TYPES.filter((r) => RELATION_STYLE[r].tier === t);
    const chain = byTier("chain");
    const secondary = byTier("secondary");
    expect([...chain, ...secondary].sort()).toEqual([...RELATION_TYPES].sort());
    expect(chain.filter((r) => secondary.includes(r))).toEqual([]);
    expect(chain).toEqual(["issues", "produces", "handledBy", "emits", "triggers", "invokes"]);
    expect(secondary).toEqual(["constrainedBy", "updates", "informs", "annotates", "highlights"]);
  });

  it("draws the causal chain at least as heavy as secondary relations", () => {
    const chainW = RELATION_TYPES.filter((r) => RELATION_STYLE[r].tier === "chain").map(
      (r) => RELATION_STYLE[r].width,
    );
    const secW = RELATION_TYPES.filter((r) => RELATION_STYLE[r].tier === "secondary").map(
      (r) => RELATION_STYLE[r].width,
    );
    expect(Math.min(...chainW)).toBeGreaterThanOrEqual(Math.max(...secW));
  });
});
