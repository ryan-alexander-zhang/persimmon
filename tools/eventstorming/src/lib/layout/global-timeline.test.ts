import { describe, expect, it } from "vitest";
import type { Context } from "@/lib/eventstorming/grammar";
import { timelineOrder } from "@/lib/store/timeline";
import type { ESNode } from "@/lib/store/types";
import { computeLayout } from "./layout";

// issue-00010 / spec-00009 reproduction (design-00005 §5). Two contexts whose
// events, on one Event Storming timeline, are chronologically A < B < C.
const ev = (id: string, ctx: string, order: number): ESNode => ({
  id,
  type: "domainEvent",
  position: { x: 0, y: 0 },
  data: { label: id, context: ctx, order },
});

const contexts: Context[] = [
  { id: "ord", name: "Ordering", order: 0 },
  { id: "pay", name: "Payment", order: 1 },
];
const nodes = [ev("A", "ord", 0), ev("C", "ord", 1), ev("B", "pay", 0)];

const boardXOrder = () =>
  computeLayout(nodes, [], contexts, "design")
    .filter((n) => n.type === "domainEvent")
    .sort((a, b) => a.position.x - b.position.x)
    .map((n) => n.id);

describe("global timeline (issue-00010)", () => {
  // GREEN after plan-00011 Phase 1: one global `order` makes the board's
  // left→right order and the walkthrough order agree (issue-00010 resolved).
  it("board left→right order equals the walkthrough order [us-00015-AC-2.1]", () => {
    expect(boardXOrder()).toEqual(timelineOrder(nodes));
  });
});
