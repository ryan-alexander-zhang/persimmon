import { describe, expect, it } from "vitest";
import type { ElementType } from "./elements";
import { isVisibleAt, LEVELS, LEVEL_TYPES, typesForZoom } from "./levels";

describe("levels", () => {
  it("is cumulative: Big Picture ⊂ Process ⊂ Design", () => {
    expect(LEVEL_TYPES["big-picture"].every((t) => LEVEL_TYPES.process.includes(t))).toBe(true);
    expect(LEVEL_TYPES.process.every((t) => LEVEL_TYPES.design.includes(t))).toBe(true);
  });

  it("Big Picture shows only actors/systems, events, hotspots [us-00008-AC-1.1]", () => {
    const shown: ElementType[] = ["actor", "externalSystem", "domainEvent", "hotspot"];
    const hidden: ElementType[] = ["command", "aggregate", "policy", "readModel"];
    for (const t of shown) expect(isVisibleAt("big-picture", t)).toBe(true);
    for (const t of hidden) expect(isVisibleAt("big-picture", t)).toBe(false);
  });

  it("Process adds commands/policies/read models but not constraints/aggregates", () => {
    expect(isVisibleAt("process", "command")).toBe(true);
    expect(isVisibleAt("process", "policy")).toBe(true);
    expect(isVisibleAt("process", "readModel")).toBe(true);
    expect(isVisibleAt("process", "aggregate")).toBe(false);
    expect(isVisibleAt("process", "constraint")).toBe(false);
  });

  it("Design introduces both Constraint (input) and Aggregate (output)", () => {
    expect(isVisibleAt("design", "constraint")).toBe(true);
    expect(isVisibleAt("design", "aggregate")).toBe(true);
  });

  it("shows Opportunity at every level [us-00013-AC-3.1]", () => {
    for (const lv of LEVELS) expect(isVisibleAt(lv, "opportunity")).toBe(true);
  });
});

describe("semantic zoom (TC5)", () => {
  it("shows full Design detail when zoomed in", () => {
    expect(typesForZoom(1, "design")).toEqual(LEVEL_TYPES.design);
    expect(typesForZoom(1, "design")).toContain("aggregate");
  });

  it("keeps full detail at a small board's fit zoom (~0.5)", () => {
    expect(typesForZoom(0.5, "design")).toEqual(LEVEL_TYPES.design);
    expect(typesForZoom(0.5, "design")).toContain("aggregate");
  });

  it("drops to Process detail at mid zoom, backbone when far out", () => {
    expect(typesForZoom(0.35, "design")).toEqual(LEVEL_TYPES.process); // no aggregate
    expect(typesForZoom(0.35, "design")).not.toContain("aggregate");
    expect(typesForZoom(0.2, "design")).toEqual(LEVEL_TYPES["big-picture"]); // backbone only
    expect(typesForZoom(0.2, "design")).not.toContain("command");
  });

  it("never shows more than the current Level (bounded)", () => {
    // even zoomed all the way in, a Process board stays Process
    expect(typesForZoom(2, "process")).toEqual(LEVEL_TYPES.process);
    for (const zoom of [0.2, 0.5, 1, 2]) {
      const shown = typesForZoom(zoom, "process");
      expect(shown.every((t) => LEVEL_TYPES.process.includes(t))).toBe(true);
    }
  });
});
