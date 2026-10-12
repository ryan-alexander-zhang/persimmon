import { describe, expect, it } from "vitest";
import {
  computeContextFocus,
  computeContextNeighborhood,
  computeFocus,
  computeNeighborhood,
  focusSource,
} from "./focus";
import type { ESEdge, ESNode } from "./types";

const edge = (id: string, source: string, target: string): ESEdge => ({
  id,
  source,
  target,
  data: { relation: "emits" },
});

const node = (id: string, context?: string): ESNode => ({
  id,
  type: "domainEvent",
  position: { x: 0, y: 0 },
  data: { label: id, context },
});

// a -> b -> c, plus an unrelated d -> e
const edges: ESEdge[] = [edge("ab", "a", "b"), edge("bc", "b", "c"), edge("de", "d", "e")];

describe("computeFocus (RA2)", () => {
  it("returns an inactive, empty set when nothing is focused", () => {
    for (const id of [null, undefined, ""]) {
      const f = computeFocus(id, edges);
      expect(f.active).toBe(false);
      expect(f.nodeIds.size).toBe(0);
      expect(f.edgeIds.size).toBe(0);
    }
  });

  it("includes the focused node, its neighbours, and incident edges", () => {
    const f = computeFocus("b", edges);
    expect(f.active).toBe(true);
    expect([...f.nodeIds].sort()).toEqual(["a", "b", "c"]);
    expect([...f.edgeIds].sort()).toEqual(["ab", "bc"]);
  });

  it("excludes unrelated nodes and edges", () => {
    const f = computeFocus("a", edges);
    expect([...f.nodeIds].sort()).toEqual(["a", "b"]);
    expect([...f.edgeIds]).toEqual(["ab"]);
    expect(f.nodeIds.has("d")).toBe(false);
    expect(f.edgeIds.has("de")).toBe(false);
  });

  it("handles a focused node with no edges (itself only)", () => {
    const f = computeFocus("lonely", edges);
    expect(f.active).toBe(true);
    expect([...f.nodeIds]).toEqual(["lonely"]);
    expect(f.edgeIds.size).toBe(0);
  });
});

describe("computeContextFocus (spec-00010)", () => {
  it("is inactive/empty when no context is given", () => {
    for (const id of [null, undefined, ""]) {
      const f = computeContextFocus(id, [node("a", "A")], []);
      expect(f.active).toBe(false);
      expect(f.nodeIds.size).toBe(0);
      expect(f.edgeIds.size).toBe(0);
    }
  });

  it("includes the context's members even with no edges", () => {
    const nodes = [node("a1", "A"), node("a2", "A"), node("b1", "B")];
    const f = computeContextFocus("A", nodes, []);
    expect(f.active).toBe(true);
    expect([...f.nodeIds].sort()).toEqual(["a1", "a2"]);
    expect(f.edgeIds.size).toBe(0);
  });

  it("pulls in an Ungrouped supporting element and its edge", () => {
    // cmd (Ungrouped) -> a1 (context A)
    const nodes = [node("a1", "A"), node("cmd")];
    const f = computeContextFocus("A", nodes, [edge("e1", "cmd", "a1")]);
    expect([...f.nodeIds].sort()).toEqual(["a1", "cmd"]);
    expect([...f.edgeIds]).toEqual(["e1"]);
  });

  it("keeps a cross-context seam edge on but leaves the other context's node dimmed", () => {
    // a1 (A) -> b1 (B): seam edge is in the set, b1 is not
    const nodes = [node("a1", "A"), node("b1", "B")];
    const f = computeContextFocus("A", nodes, [edge("seam", "a1", "b1")]);
    expect([...f.nodeIds]).toEqual(["a1"]);
    expect([...f.edgeIds]).toEqual(["seam"]);
    expect(f.nodeIds.has("b1")).toBe(false);
  });

  it("is active with empty sets for a context that has no members", () => {
    const f = computeContextFocus("Z", [node("a1", "A")], []);
    expect(f.active).toBe(true);
    expect(f.nodeIds.size).toBe(0);
    expect(f.edgeIds.size).toBe(0);
  });
});

describe("computeNeighborhood (TC1)", () => {
  // chain a -> b -> c -> d
  const chain: ESEdge[] = [edge("ab", "a", "b"), edge("bc", "b", "c"), edge("cd", "c", "d")];

  it("returns empty for a missing anchor", () => {
    const n = computeNeighborhood(null, chain, { depth: 3, direction: "both" });
    expect(n.nodeIds.size).toBe(0);
    expect(n.edgeIds.size).toBe(0);
  });

  it("walks downstream (source→target) to the given depth", () => {
    expect([...computeNeighborhood("b", chain, { depth: 1, direction: "down" }).nodeIds].sort()).toEqual(["b", "c"]);
    expect([...computeNeighborhood("b", chain, { depth: 2, direction: "down" }).nodeIds].sort()).toEqual(["b", "c", "d"]);
  });

  it("walks upstream (target→source) to the given depth", () => {
    expect([...computeNeighborhood("c", chain, { depth: 1, direction: "up" }).nodeIds].sort()).toEqual(["b", "c"]);
    expect([...computeNeighborhood("c", chain, { depth: 2, direction: "up" }).nodeIds].sort()).toEqual(["a", "b", "c"]);
  });

  it("both directions reach either side", () => {
    expect([...computeNeighborhood("b", chain, { depth: 1, direction: "both" }).nodeIds].sort()).toEqual(["a", "b", "c"]);
  });

  it("returns the induced edges among reached nodes", () => {
    const n = computeNeighborhood("a", chain, { depth: 3, direction: "down" });
    expect([...n.nodeIds].sort()).toEqual(["a", "b", "c", "d"]);
    expect([...n.edgeIds].sort()).toEqual(["ab", "bc", "cd"]);
  });

  it("an anchor with no edges is just itself", () => {
    const n = computeNeighborhood("lonely", chain, { depth: 3, direction: "both" });
    expect([...n.nodeIds]).toEqual(["lonely"]);
    expect(n.edgeIds.size).toBe(0);
  });
});

describe("focusSource (RA3)", () => {
  it("prefers the hovered node over the selected one", () => {
    expect(focusSource("h", "s")).toBe("h");
  });
  it("falls back to the selected node when nothing is hovered", () => {
    expect(focusSource(null, "s")).toBe("s");
  });
  it("is null when neither is set", () => {
    expect(focusSource(null, null)).toBe(null);
    expect(focusSource(undefined, undefined)).toBe(null);
  });
});

describe("computeContextNeighborhood (context isolate)", () => {
  // A: a1 -> a2, a1 -> u (Ungrouped support), a2 -> b1 (a seam into B); B: b1 -> b2
  const nodes = [
    node("a1", "A"),
    node("a2", "A"),
    node("u"),
    node("b1", "B"),
    node("b2", "B"),
  ];
  const es = [
    edge("a1a2", "a1", "a2"),
    edge("a1u", "a1", "u"),
    edge("a2b1", "a2", "b1"),
    edge("b1b2", "b1", "b2"),
  ];

  it("is empty when no context is given", () => {
    for (const id of [null, undefined, ""]) {
      expect(computeContextNeighborhood(id, nodes, es).size).toBe(0);
    }
  });

  it("keeps the members, their Ungrouped support, and the far side of a seam", () => {
    const ids = computeContextNeighborhood("A", nodes, es);
    expect([...ids].sort()).toEqual(["a1", "a2", "b1", "u"]);
    // b1 comes in as the seam's other endpoint; b2, a second hop into B, does not
    expect(ids.has("b2")).toBe(false);
  });

  it("keeps a member with no edges at all", () => {
    const ids = computeContextNeighborhood("B", [node("b9", "B")], []);
    expect([...ids]).toEqual(["b9"]);
  });

  it("is empty for a context no node belongs to", () => {
    expect(computeContextNeighborhood("nope", nodes, es).size).toBe(0);
  });
});
