import { describe, expect, it } from "vitest";
import { isShownByFilter, matchesQuery } from "./filter";
import type { ESNode } from "./types";

const node = (over: Partial<ESNode> & { data?: Partial<ESNode["data"]> } = {}): ESNode =>
  ({
    id: "n1",
    type: "domainEvent",
    position: { x: 0, y: 0 },
    ...over,
    data: { label: "Order Placed", ...over.data },
  }) as ESNode;

describe("search matchesQuery [us-00018-FR-1]", () => {
  it("matches label case-insensitively", () => {
    expect(matchesQuery(node(), "order")).toBe(true);
    expect(matchesQuery(node(), "ORDER")).toBe(true);
    expect(matchesQuery(node(), "payment")).toBe(false);
  });

  it("matches the description too", () => {
    const n = node({ data: { label: "Order Placed", description: "customer checkout" } });
    expect(matchesQuery(n, "checkout")).toBe(true);
  });

  it("an empty or whitespace query matches nothing (no highlight until typing)", () => {
    expect(matchesQuery(node(), "")).toBe(false);
    expect(matchesQuery(node(), "   ")).toBe(false);
  });
});

describe("isShownByFilter [us-00018-FR-3/FR-4]", () => {
  it("empty filter shows everything", () => {
    expect(isShownByFilter(node(), { types: new Set(), contexts: new Set() })).toBe(true);
  });

  it("type filter hides non-matching types", () => {
    const f = { types: new Set(["domainEvent" as const]), contexts: new Set<string | null>() };
    expect(isShownByFilter(node({ type: "domainEvent" }), f)).toBe(true);
    expect(isShownByFilter(node({ type: "command" }), f)).toBe(false);
  });

  it("context filter hides non-matching contexts; Ungrouped is null", () => {
    const f = { types: new Set<never>(), contexts: new Set<string | null>(["ord"]) };
    expect(isShownByFilter(node({ data: { label: "x", context: "ord" } }), f)).toBe(true);
    expect(isShownByFilter(node({ data: { label: "x", context: "pay" } }), f)).toBe(false);
    expect(isShownByFilter(node({ data: { label: "x" } }), f)).toBe(false); // Ungrouped excluded

    const fUngrouped = { types: new Set<never>(), contexts: new Set<string | null>([null]) };
    expect(isShownByFilter(node({ data: { label: "x" } }), fUngrouped)).toBe(true);
  });

  it("type and context compose (both must pass)", () => {
    const f = {
      types: new Set(["domainEvent" as const]),
      contexts: new Set<string | null>(["ord"]),
    };
    expect(isShownByFilter(node({ type: "domainEvent", data: { label: "x", context: "ord" } }), f)).toBe(true);
    expect(isShownByFilter(node({ type: "domainEvent", data: { label: "x", context: "pay" } }), f)).toBe(false);
    expect(isShownByFilter(node({ type: "command", data: { label: "x", context: "ord" } }), f)).toBe(false);
  });
});
