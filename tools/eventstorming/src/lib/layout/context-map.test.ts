import { describe, expect, it } from "vitest";
import type { Context } from "@/lib/eventstorming/grammar";
import { CONTEXT_COL_W, CONTEXT_ROW_H, contextEdgeHandles, contextMapPositions } from "./context-map";

const ctx = (id: string, order: number): Context => ({ id, name: id, order });

// The map's layout is its own graph (a grid by context order), pure like the
// board's computeLayout — free drag on top is view-only scratch (decision-00002).
describe("contextMapPositions", () => {
  it("lays contexts out left to right, wrapping after three per row", () => {
    const pos = contextMapPositions([ctx("a", 0), ctx("b", 1), ctx("c", 2), ctx("d", 3)]);
    expect(pos.get("a")).toEqual({ x: 0, y: 0 });
    expect(pos.get("b")).toEqual({ x: CONTEXT_COL_W, y: 0 });
    expect(pos.get("c")).toEqual({ x: 2 * CONTEXT_COL_W, y: 0 });
    expect(pos.get("d")).toEqual({ x: 0, y: CONTEXT_ROW_H });
  });

  it("orders by `order`, not by array position", () => {
    const pos = contextMapPositions([ctx("late", 5), ctx("early", 1)]);
    expect(pos.get("early")).toEqual({ x: 0, y: 0 });
    expect(pos.get("late")).toEqual({ x: CONTEXT_COL_W, y: 0 });
  });

  it("breaks an order tie by id so the layout is deterministic", () => {
    const forward = contextMapPositions([ctx("b", 0), ctx("a", 0)]);
    const reversed = contextMapPositions([ctx("a", 0), ctx("b", 0)]);
    expect(forward.get("a")).toEqual({ x: 0, y: 0 });
    expect(forward).toEqual(reversed);
  });
});

// issue-00012: Context Map edges must leave the source on the side facing the
// target and enter the target on the facing side — not always the left handle.
describe("contextEdgeHandles [issue-00012]", () => {
  it("routes to the right when the target is to the right", () => {
    expect(contextEdgeHandles({ x: 0, y: 0 }, { x: 300, y: 0 })).toEqual({
      sourceHandle: "s-right",
      targetHandle: "t-left",
    });
  });

  it("routes to the left when the target is to the left", () => {
    expect(contextEdgeHandles({ x: 300, y: 0 }, { x: 0, y: 0 })).toEqual({
      sourceHandle: "s-left",
      targetHandle: "t-right",
    });
  });

  it("routes down when the target is below (dominant vertical axis)", () => {
    expect(contextEdgeHandles({ x: 0, y: 0 }, { x: 10, y: 300 })).toEqual({
      sourceHandle: "s-bottom",
      targetHandle: "t-top",
    });
  });

  it("routes up when the target is above", () => {
    expect(contextEdgeHandles({ x: 0, y: 300 }, { x: 0, y: 0 })).toEqual({
      sourceHandle: "s-top",
      targetHandle: "t-bottom",
    });
  });
});
